import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  DailySessionFlightStatus,
  OperationalReportGenerationType,
  OperationalReportFormat,
  OperationalReportStatus,
  PermissionCode,
  Prisma,
  Role,
} from '@prisma/client';
import { createHash } from 'crypto';
import { AuthUser } from '../common/types/auth-user.type';
import { safeUserSelect } from '../common/utils/sanitize-user';
import { OperationAccessService } from '../operations/operation-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { GenerateDailyCompanyReportDto } from './dto/generate-daily-company-report.dto';
import { GenerateFlightReportDto } from './dto/generate-flight-report.dto';
import { OperationalReportQueryDto } from './dto/operational-report-query.dto';
import { paginate } from '../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { OperationalFlightReportDataService } from './operational-flight-report-data.service';
import { OperationalFlightPdfService } from './operational-flight-pdf.service';
import { OperationalFlightExcelService } from './operational-flight-excel.service';
import { OperationalReportEmailJobsService } from './operational-report-email-jobs.service';

@Injectable()
export class OperationalReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OperationAccessService,
    private readonly dataAssembler: OperationalFlightReportDataService,
    private readonly pdf: OperationalFlightPdfService,
    private readonly excel: OperationalFlightExcelService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Optional() private readonly emailJobs?: OperationalReportEmailJobsService,
  ) {}

  private withoutFilePath<T extends { filePath: string | null }>(report: T): Omit<T, 'filePath'> {
    const { filePath: _filePath, ...publicReport } = report;
    return publicReport;
  }

  async generateFlight(sessionFlightId: string, dto: GenerateFlightReportDto, user: AuthUser) {
    this.assertReportPermission(user);
    if (user.role === Role.MOVEMENT_SUPERVISOR) {
      await this.access.assertCanModifySessionFlight(sessionFlightId, user);
    }
    if (dto.force && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can force report regeneration');
    }
    return this.generateFlightReport(
      sessionFlightId,
      dto.format,
      OperationalReportGenerationType.MANUAL,
      user,
      Boolean(dto.force),
      false,
    );
  }

  async generateAutomaticFlight(
    sessionFlightId: string,
    format: OperationalReportFormat,
    generatedBy: AuthUser,
  ) {
    return this.generateFlightReport(
      sessionFlightId,
      format,
      OperationalReportGenerationType.AUTOMATIC_FINAL_CLOSE,
      generatedBy,
      false,
      true,
    );
  }

  private async generateFlightReport(
    sessionFlightId: string,
    format: OperationalReportFormat,
    generationType: OperationalReportGenerationType,
    user: AuthUser,
    force: boolean,
    acceptExistingGenerated: boolean,
  ) {
    const full = await this.prisma.dailySessionFlight.findUnique({ where: { id: sessionFlightId } });
    if (!full) throw new NotFoundException('Session flight not found');
    if (full.status !== DailySessionFlightStatus.CLOSED) {
      throw new ConflictException('Flight report can only be generated after the Flight is closed');
    }
    const renderer = format === OperationalReportFormat.PDF ? this.pdf : this.excel;
    const templateVersion = renderer.templateVersion();
    const key = {
      dailySessionFlightId: sessionFlightId,
      format,
      generationType,
      templateVersion,
    };
    let report = await this.prisma.flightReport.findUnique({
      where: { dailySessionFlightId_format_generationType_templateVersion: key },
    });
    if (!report) {
      try {
        report = await this.prisma.flightReport.create({
          data: {
            ...key,
            companyId: full.companyId,
            movementCategoryId: full.movementCategoryId,
            generatedById: user.id,
            status: OperationalReportStatus.PENDING,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Flight report generation is already in progress');
        }
        throw error;
      }
    } else {
      if (report.status === OperationalReportStatus.PENDING) {
        throw new ConflictException('Flight report generation is already in progress');
      }
      if (report.status === OperationalReportStatus.GENERATED && acceptExistingGenerated) {
        await this.tryEnqueueEmail(sessionFlightId, generationType, templateVersion, report.id);
        return this.withoutFilePath(report);
      }
      if (report.status === OperationalReportStatus.GENERATED && !force) {
        throw new ConflictException('Flight report already exists');
      }
      const claimed = await this.prisma.flightReport.updateMany({
        where: { id: report.id, status: report.status },
        data: {
          status: OperationalReportStatus.PENDING,
          generatedById: user.id,
          errorMessage: null,
          filePath: null,
          mimeType: null,
          fileSize: null,
          checksum: null,
          generatedAt: null,
        },
      });
      if (claimed.count !== 1) throw new ConflictException('Flight report generation is already in progress');
    }

    try {
      const assembled = await this.dataAssembler.assemble(sessionFlightId);
      const generatedAt = new Date();
      const isPdf = format === OperationalReportFormat.PDF;
      const extension = isPdf ? 'pdf' : 'xlsx';
      const mimeType = isPdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const buffer = isPdf
        ? await this.pdf.render(assembled, generatedAt)
        : await this.excel.render(assembled, {
            reportId: report.id,
            generatedBy: user.fullName ?? user.id,
            generatedAt,
            generationType,
          });
      const filePath = `reports/operational/flights/${sessionFlightId}/${report.id}.${extension}`;
      const stored = await this.storage.saveAtomic(filePath, buffer);
      const checksum = createHash('sha256').update(buffer).digest('hex');
      const updated = await this.prisma.flightReport.update({
        where: { id: report.id },
        data: {
          status: OperationalReportStatus.GENERATED,
          filePath: stored.relativePath,
          mimeType,
          fileSize: stored.size,
          checksum,
          generatedAt,
          metadata: {
            flightNumber: assembled.flight.flightNumber,
            companyCode: assembled.company.code,
            finalStatus: assembled.lifecycle.finalStatus,
            closedAt: assembled.lifecycle.closedAt?.toISOString() ?? null,
          },
        },
        include: { company: true, movementCategory: true, generatedBy: { select: safeUserSelect } },
      });
      await this.audit.record({
        user,
        permissionUsed: PermissionCode.CAN_EXPORT_REPORTS,
        action: 'GENERATE_OPERATIONAL_FLIGHT_REPORT',
        entityType: 'FlightReport',
        entityId: report.id,
        metadata: { sessionFlightId, templateVersion, format, generationType, checksum },
      });
      await this.tryEnqueueEmail(sessionFlightId, generationType, templateVersion, report.id);
      return this.withoutFilePath(updated);
    } catch (error) {
      const message = this.sanitizeGenerationError(error);
      await this.prisma.flightReport.update({
        where: { id: report.id },
        data: { status: OperationalReportStatus.FAILED, errorMessage: message },
      });
      await this.audit.record({
        user,
        permissionUsed: PermissionCode.CAN_EXPORT_REPORTS,
        action: 'GENERATE_OPERATIONAL_FLIGHT_REPORT',
        entityType: 'FlightReport',
        entityId: report.id,
        result: 'FAILED',
        note: message,
        metadata: { sessionFlightId, templateVersion, format, generationType },
      });
      const failed = await this.prisma.flightReport.findUniqueOrThrow({
        where: { id: report.id },
        include: { company: true, movementCategory: true, generatedBy: { select: safeUserSelect } },
      });
      return this.withoutFilePath(failed);
    }
  }

  private sanitizeGenerationError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Operational report generation failed';
    return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
  }

  private async tryEnqueueEmail(sessionFlightId: string, generationType: OperationalReportGenerationType,
    templateVersion: string, reportId: string) {
    try { await this.emailJobs?.enqueueIfReady(sessionFlightId, generationType, templateVersion); }
    catch (error) { await this.audit.record({ action: 'ENQUEUE_OPERATIONAL_REPORT_EMAIL_JOB',
      entityType: 'FlightReport', entityId: reportId, result: 'FAILED', note: this.sanitizeGenerationError(error),
      metadata: { sessionFlightId, generationType, templateVersion } }); }
  }

  async flightReports(sessionFlightId: string, user: AuthUser) {
    const item = await this.prisma.dailySessionFlight.findUnique({ where: { id: sessionFlightId } });
    if (!item) throw new NotFoundException('Session flight not found');
    this.access.assertCompanyScope(item.companyId, user);
    const reports = await this.prisma.flightReport.findMany({
      where: { dailySessionFlightId: sessionFlightId },
      include: { company: true, movementCategory: true, generatedBy: { select: safeUserSelect } },
      orderBy: { createdAt: 'desc' },
    });
    return reports.map((report) => this.withoutFilePath(report));
  }

  async downloadFlightReport(sessionFlightId: string, reportId: string, user: AuthUser) {
    try {
      this.assertReportPermission(user);
      const report = await this.prisma.flightReport.findFirst({
        where: { id: reportId, dailySessionFlightId: sessionFlightId },
        include: {
          dailySessionFlight: {
            include: { flight: true, dailyCompanySession: { include: { dailyDuty: true } } },
          },
        },
      });
      if (!report) throw new NotFoundException('Flight report not found');
      await this.assertCanReadFlightReport(report, user);
      if (report.status !== OperationalReportStatus.GENERATED || !report.filePath) {
        throw new ConflictException('Flight report is not ready for download');
      }
      const downloadType = this.downloadType(report.format);
      if (report.mimeType !== downloadType.mimeType) throw new ConflictException('Flight report MIME type is inconsistent');
      if (!report.filePath.toLowerCase().endsWith(`.${downloadType.extension}`)) {
        throw new ConflictException('Flight report file extension is inconsistent');
      }
      const stored = await this.storage.assertFile(report.filePath);
      const data = await this.storage.read(report.filePath);
      const checksum = createHash('sha256').update(data).digest('hex');
      if (report.checksum && checksum !== report.checksum) {
        throw new ConflictException('Flight report integrity verification failed');
      }
      await this.audit.record({
        user,
        permissionUsed: PermissionCode.CAN_EXPORT_REPORTS,
        action: 'DOWNLOAD_OPERATIONAL_FLIGHT_REPORT',
        entityType: 'FlightReport',
        entityId: report.id,
        metadata: { sessionFlightId, fileSize: stored.size },
      });
      const safeFlightNumber = report.dailySessionFlight.flight.flightNumber.replace(/[^A-Za-z0-9_-]/g, '-');
      return {
        data,
        mimeType: downloadType.mimeType,
        filename: `${safeFlightNumber}-flight-report.${downloadType.extension}`,
      };
    } catch (error) {
      await this.audit.record({
        user,
        permissionUsed: PermissionCode.CAN_EXPORT_REPORTS,
        action: 'DOWNLOAD_OPERATIONAL_FLIGHT_REPORT',
        entityType: 'FlightReport',
        entityId: reportId,
        result: 'FAILED',
        note: error instanceof Error ? error.message.slice(0, 500) : 'Download failed',
        metadata: { sessionFlightId },
      });
      throw error;
    }
  }

  private downloadType(format: OperationalReportFormat) {
    if (format === OperationalReportFormat.PDF) {
      return { mimeType: 'application/pdf', extension: 'pdf' } as const;
    }
    return {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    } as const;
  }

  private assertReportPermission(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && !user.permissions.includes(PermissionCode.CAN_EXPORT_REPORTS)) {
      throw new ForbiddenException('CAN_EXPORT_REPORTS permission is required');
    }
  }

  private async assertCanReadFlightReport(
    report: {
      companyId: string;
      movementCategoryId: string;
      dailySessionFlight: {
        isCarryOver: boolean;
        dailyCompanySession: { dailyDuty: { movementSupervisorId: string } };
      };
    },
    user: AuthUser,
  ) {
    this.access.assertCompanyScope(report.companyId, user);
    if (user.role !== Role.MOVEMENT_SUPERVISOR) return;
    const assigned = await this.prisma.movementCategoryAssignment.count({
      where: { userId: user.id, movementCategoryId: report.movementCategoryId, isActive: true },
    });
    const ownsDuty = report.dailySessionFlight.dailyCompanySession.dailyDuty.movementSupervisorId === user.id;
    if (!assigned && !ownsDuty && !report.dailySessionFlight.isCarryOver) {
      throw new ForbiddenException('Flight report is outside the Movement Supervisor scope');
    }
  }

  async generateDaily(sessionId: string, dto: GenerateDailyCompanyReportDto, user: AuthUser) {
    await this.access.assertCanModifySession(sessionId, user);
    if (dto.force && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can force duplicate report generation');
    }
    const existing = await this.prisma.dailyCompanyReport.findFirst({
      where: {
        dailyCompanySessionId: sessionId,
        format: dto.format,
        generationType: OperationalReportGenerationType.MANUAL,
      },
    });
    if (existing && !dto.force) throw new ConflictException('Daily company report already exists');
    const session = await this.prisma.dailyCompanySession.findUnique({
      where: { id: sessionId },
      include: {
        company: true,
        movementCategory: true,
        dailyDuty: { include: { movementSupervisor: true } },
        sessionFlights: {
          include: {
            flight: true,
            counterReservations: { include: { counter: true } },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Daily company session not found');
    const closedFlights = session.sessionFlights.filter(
      (item) => item.status === DailySessionFlightStatus.CLOSED,
    ).length;
    const metadata: Prisma.InputJsonObject = {
      company: session.company.name,
      date: session.date.toISOString(),
      movementCategory: session.movementCategory.code,
      movementSupervisor: session.dailyDuty.movementSupervisor.fullName,
      totalFlights: session.sessionFlights.length,
      closedFlights,
      openFlights: session.sessionFlights.length - closedFlights,
      carryOverFlights: session.sessionFlights.filter((item) => item.isCarryOver).length,
      flightNumbers: session.sessionFlights.map((item) => item.flight.flightNumber),
      countersUsed: [
        ...new Set(
          session.sessionFlights.flatMap((item) =>
            item.counterReservations.map((reservation) => reservation.counter.code),
          ),
        ),
      ],
      sessionStatus: session.status,
      generatedAutomatically: false,
    };
    return this.prisma.dailyCompanyReport.create({
      data: {
        dailyCompanySessionId: session.id,
        companyId: session.companyId,
        movementCategoryId: session.movementCategoryId,
        generatedById: user.id,
        totalFlights: session.sessionFlights.length,
        format: dto.format,
        metadata,
      },
      include: {
        company: true,
        movementCategory: true,
        generatedBy: { select: safeUserSelect },
      },
    });
  }

  async dailyReports(sessionId: string, user: AuthUser) {
    const session = await this.prisma.dailyCompanySession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Daily company session not found');
    this.access.assertCompanyScope(session.companyId, user);
    return this.prisma.dailyCompanyReport.findMany({
      where: { dailyCompanySessionId: sessionId },
      include: { company: true, movementCategory: true, generatedBy: { select: safeUserSelect } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listFlightReports(query: OperationalReportQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const where: Prisma.FlightReportWhereInput = {
      companyId: user.role === Role.COMPANY_USER ? user.companyId ?? '__unlinked__' : query.companyId,
      movementCategoryId: query.movementCategoryId,
      createdAt: day ? { gte: day, lt: nextDay } : undefined,
      dailySessionFlight:
        user.role === Role.MOVEMENT_SUPERVISOR
          ? {
              OR: [
                { dailyCompanySession: { dailyDuty: { movementSupervisorId: user.id } } },
                { isCarryOver: true },
              ],
            }
          : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.flightReport.findMany({
        where,
        include: {
          company: true,
          movementCategory: true,
          generatedBy: { select: safeUserSelect },
          dailySessionFlight: { include: { flight: true } },
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.flightReport.count({ where }),
    ]);
    return { items: items.map((item) => this.withoutFilePath(item)), meta: { total, page, limit } };
  }

  async listDailyReports(query: OperationalReportQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const where: Prisma.DailyCompanyReportWhereInput = {
      companyId: user.role === Role.COMPANY_USER ? user.companyId ?? '__unlinked__' : query.companyId,
      movementCategoryId: query.movementCategoryId,
      createdAt: day ? { gte: day, lt: nextDay } : undefined,
      dailyCompanySession:
        user.role === Role.MOVEMENT_SUPERVISOR
          ? {
              OR: [
                { dailyDuty: { movementSupervisorId: user.id } },
                { sessionFlights: { some: { isCarryOver: true } } },
              ],
            }
          : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dailyCompanyReport.findMany({
        where,
        include: {
          company: true,
          movementCategory: true,
          generatedBy: { select: safeUserSelect },
          dailyCompanySession: true,
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dailyCompanyReport.count({ where }),
    ]);
    return { items: items.map((item) => this.withoutFilePath(item)), meta: { total, page, limit } };
  }
}
