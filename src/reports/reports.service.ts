import { Injectable, NotFoundException } from '@nestjs/common';
import { PermissionCode, Prisma, ReportStatus, ReportType, Role } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import PDFDocument = require('pdfkit');
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  private async pdfBuffer(lines: string[]) {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    doc.fontSize(18).text('Online PreCheck / OutCheck Report');
    doc.moveDown();
    lines.forEach((line) => doc.fontSize(10).text(line));
    doc.end();
    return done;
  }

  private async excelBuffer(title: string, rows: Record<string, unknown>[]) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(title);
    const keys = rows[0] ? Object.keys(rows[0]) : ['message'];
    sheet.columns = keys.map((key) => ({ header: key, key, width: 28 }));
    rows.length ? sheet.addRows(rows) : sheet.addRow({ message: 'No data' });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async generateSessionFinalReport(sessionId: string, generatedById?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        company: true,
        createdBy: true,
        counters: { include: { counter: true } },
        preChecks: { include: { signedBy: true, results: { include: { checkItem: true, counter: true, device: true, issue: true } } } },
        outChecks: { include: { signedBy: true, results: { include: { checkItem: true, counter: true, device: true, issue: true } } } },
        issues: { include: { counter: true, device: true, checkItem: true, resolvedBy: true } },
        approvals: { include: { approvedBy: true } },
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    try {
      const lines = [
        `Session: ${session.id}`,
        `Company: ${session.company.name} (${session.company.code})`,
        `Status: ${session.status}`,
        `Planned: ${session.plannedStartAt.toISOString()} - ${session.plannedEndAt.toISOString()}`,
        `Assigned by: ${session.createdBy.fullName}`,
        `Counters: ${session.counters.map((row) => `${row.counter.code}:${row.counter.status}`).join(', ')}`,
        `PreCheck signed by: ${session.preChecks.at(-1)?.signedBy?.fullName ?? 'N/A'}`,
        `OutCheck signed by: ${session.outChecks.at(-1)?.signedBy?.fullName ?? 'N/A'}`,
        `Approval: ${session.approvals.at(-1)?.decision ?? 'N/A'} by ${session.approvals.at(-1)?.approvedBy.fullName ?? 'N/A'}`,
        `Issues: ${session.issues.map((issue) => `${issue.title} [${issue.status}] ${issue.resolutionNote ?? ''}`).join(' | ') || 'None'}`,
      ];
      const pdfPath = await this.storage.save(`reports/session/${session.id}.pdf`, await this.pdfBuffer(lines));
      const rows = [
        { section: 'Session', id: session.id, company: session.company.name, status: session.status },
        ...session.issues.map((issue) => ({ section: 'Issue', id: issue.id, title: issue.title, status: issue.status, resolution: issue.resolutionNote ?? '' })),
      ];
      const excelPath = await this.storage.save(`reports/session/${session.id}.xlsx`, await this.excelBuffer('Session Final', rows));
      const report = await this.prisma.report.create({
        data: { sessionId, type: ReportType.SESSION_FINAL, status: ReportStatus.GENERATED, pdfPath, excelPath, generatedById },
      });
      await this.audit.record({ user: generatedById ? { id: generatedById } : null, action: 'GENERATE_REPORT', entityType: 'Report', entityId: report.id });
      return report;
    } catch (error) {
      return this.prisma.report.create({ data: { sessionId, type: ReportType.SESSION_FINAL, status: ReportStatus.FAILED, generatedById } });
    }
  }

  async generateDailyPdfBackup(date: string | Date) {
    const day = new Date(date);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    const sessions = await this.prisma.session.findMany({ where: { plannedStartAt: { gte: day, lt: next } }, include: { company: true, counters: { include: { counter: true } } } });
    const lines = sessions.map((session) => `${session.id} | ${session.company.name} | ${session.status} | ${session.counters.map((row) => row.counter.code).join(', ')}`);
    const pdfPath = await this.storage.save(`reports/daily/${day.toISOString().slice(0, 10)}.pdf`, await this.pdfBuffer(lines));
    return this.prisma.report.create({ data: { type: ReportType.DAILY_BACKUP, status: ReportStatus.GENERATED, pdfPath } });
  }

  async generateWeeklyExcelBackup(weekStartDate: string | Date) {
    const start = new Date(weekStartDate);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const workbook = new ExcelJS.Workbook();
    const sessions = await this.prisma.session.findMany({ where: { plannedStartAt: { gte: start, lt: end } }, include: { company: true, counters: { include: { counter: true } }, issues: true, approvals: true } });
    for (const name of ['Summary', 'Sessions', 'Counters', 'PreCheck Details', 'OutCheck Details', 'Issues', 'Approvals', 'Unavailable Counters', 'Audit Logs']) {
      workbook.addWorksheet(name);
    }
    const sessionsSheet = workbook.getWorksheet('Sessions')!;
    sessionsSheet.columns = ['id', 'company', 'status', 'plannedStartAt', 'plannedEndAt'].map((key) => ({ header: key, key, width: 28 }));
    sessionsSheet.addRows(sessions.map((s) => ({ id: s.id, company: s.company.name, status: s.status, plannedStartAt: s.plannedStartAt, plannedEndAt: s.plannedEndAt })));
    const excelPath = await this.storage.save(`reports/weekly/${start.toISOString().slice(0, 10)}.xlsx`, Buffer.from(await workbook.xlsx.writeBuffer()));
    return this.prisma.report.create({ data: { type: ReportType.WEEKLY_BACKUP, status: ReportStatus.GENERATED, excelPath } });
  }

  async list(query: PaginationDto & { type?: ReportType; status?: ReportStatus }) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.ReportWhereInput = { type: query.type, status: query.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({ where, include: { session: true }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.report.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async downloadReport(id: string) {
    const report = await this.find(id);
    const relativePath = report.pdfPath ?? report.excelPath;
    if (!relativePath) throw new NotFoundException('Report file not found');
    return { report, filename: relativePath.split(/[\\/]/).pop()!, data: await this.storage.read(relativePath) };
  }

  async emailReport(id: string, recipients: string[], user?: AuthUser) {
    const report = await this.find(id);
    const attachments = [report.pdfPath, report.excelPath]
      .filter(Boolean)
      .map((path) => ({ filename: path!.split(/[\\/]/).pop()!, path: this.storage.resolve(path!) }));
    const sent = await this.mailer.send({
      to: recipients,
      subject: `PreCheck report ${report.id}`,
      body: 'Attached report generated by Online PreCheck / OutCheck.',
      attachments,
      relatedEntityType: 'Report',
      relatedEntityId: id,
    });
    await this.audit.record({ user, permissionUsed: PermissionCode.CAN_SEND_REPORT_EMAILS, action: 'SEND_REPORT_EMAIL', entityType: 'Report', entityId: id });
    return sent;
  }

  async emailFinalReportToAdmins(reportId: string) {
    const admins = await this.prisma.user.findMany({ where: { isActive: true, role: { in: [Role.ADMIN, Role.SUPER_ADMIN] } } });
    if (admins.length) await this.emailReport(reportId, admins.map((admin) => admin.email));
  }
}
