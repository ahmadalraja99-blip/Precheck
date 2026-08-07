import * as assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OperationalReportFormat, OperationalReportGenerationType, OperationalReportStatus, PermissionCode, Role } from '@prisma/client';
import { StorageService } from '../src/storage/storage.service';
import { OperationalFlightReportDataService } from '../src/operational-reports/operational-flight-report-data.service';
import { OperationalFlightPdfService } from '../src/operational-reports/operational-flight-pdf.service';
import { OperationalFlightExcelService, formatOperationalReportDamascusTime } from '../src/operational-reports/operational-flight-excel.service';
import * as ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { OperationalReportsService } from '../src/operational-reports/operational-reports.service';
import { OperationalReportsController } from '../src/operational-reports/operational-reports.controller';

async function rejectsWith(action: () => Promise<unknown>, type: new (...args: any[]) => Error) {
  await assert.rejects(action, (error: unknown) => error instanceof type);
}

async function run() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'precheck-report-test-'));
  try {
    const storage = new StorageService(new ConfigService({ STORAGE_ROOT: tempRoot }));
    await storage.saveAtomic('reports/flight/test.pdf', Buffer.from('%PDF-test'));
    assert.equal((await storage.read('reports/flight/test.pdf')).toString(), '%PDF-test');
    assert.throws(() => storage.resolve('../escape.pdf'), /escapes STORAGE_ROOT/);
    assert.throws(() => storage.resolve(tempRoot), /must be relative/);

    const record = {
      id: 'flight-1', company: { name: 'Airline', code: 'AL', logoPath: null, logoUrl: null },
      flight: { flightNumber: 'AL1', origin: 'DAM', destination: 'DXB', aircraftType: 'A320', scheduledDepartureAt: new Date() },
      movementCategory: { code: 'MC', name: 'Movement' }, status: 'CLOSED', isCarryOver: false,
      handoverStatus: 'NONE', notes: null, checkInStartsAt: new Date(), checkInEndsAt: new Date(),
      dailyCompanySession: { id: 'session-1', dailyDuty: { id: 'duty-1', activatedAt: new Date(), expiresAt: new Date() } },
      counterReservations: [], preCheck: null, outCheck: null, operationalIssues: [],
    };
    const assembler = new OperationalFlightReportDataService({
      dailySessionFlight: { findUnique: async () => record },
    } as any);
    const assembled = await assembler.assemble('flight-1');
    assert.equal(assembled.flight.flightNumber, 'AL1');
    assert.equal(assembled.lifecycle.closedAt, null);

    const pdf = new OperationalFlightPdfService(new ConfigService({ STORAGE_ROOT: tempRoot }), storage);
    await assert.rejects(() => pdf.render(assembled, new Date()), /Arabic report fonts are not configured/);

    const pending = {
      id: 'report-1', dailySessionFlightId: 'flight-1', companyId: 'company-1', movementCategoryId: 'movement-1',
      generatedById: 'admin-1', format: OperationalReportFormat.PDF,
      generationType: OperationalReportGenerationType.MANUAL, status: OperationalReportStatus.PENDING,
      filePath: null, metadata: null, templateVersion: '1.0', createdAt: new Date(), updatedAt: new Date(),
    };
    const prisma = {
      dailySessionFlight: { findUnique: async () => ({ id: 'flight-1', status: 'CLOSED', companyId: 'company-1', movementCategoryId: 'movement-1' }) },
      flightReport: { findUnique: async () => pending },
    };
    const access = {
      assertCanModifySessionFlight: async () => undefined,
      assertCompanyScope: (companyId: string, user: { role: Role; companyId: string | null }) => {
        if (user.role === Role.COMPANY_USER && user.companyId !== companyId) throw new ForbiddenException();
      },
    };
    const excel = new OperationalFlightExcelService();
    const richData: any = {
      ...assembled,
      company: { ...assembled.company, name: 'الخطوط التجريبية' },
      preCheck: {
        status: 'SUBMITTED', startedAt: new Date('2026-01-01T21:00:00Z'), submittedAt: new Date('2026-01-01T21:05:00Z'),
        startedBy: 'Operator', submittedBy: 'Operator', items: [{ counterCode: 'C01', counterName: 'كاونتر 1',
          checkItemName: 'Network', checkItemDescription: 'Arabic العربية', category: 'IT', required: true, order: 1,
          result: 'PASS', note: 'سليم', updatedAt: new Date('2026-01-01T21:04:00Z') }],
      },
      outCheck: { status: 'APPROVED', startedAt: new Date('2026-01-01T22:00:00Z'), startedBy: 'Operator', attempts: [{
        attemptNumber: 1, status: 'APPROVED', submittedAt: new Date('2026-01-01T22:05:00Z'), submittedBy: 'Operator',
        totals: { total: 1, pass: 1, fail: 0, notApplicable: 0 },
        items: [{ counterCode: 'C01', counterName: 'كاونتر 1', checkItemName: 'Network', checkItemDescription: null,
          category: 'IT', required: true, order: 1, result: 'PASS', note: 'جيد', submittedAt: new Date('2026-01-01T22:05:00Z') }],
        review: { decision: 'APPROVED', reviewedBy: 'Reviewer', reviewedAt: new Date('2026-01-01T22:10:00Z'),
          approvalComment: 'مقبول', rejectionReason: null },
      }] },
    };
    const excelBuffer = await excel.render(richData, { reportId: 'report-excel', generatedBy: 'Admin',
      generatedAt: new Date('2026-01-01T21:00:00Z'), generationType: OperationalReportGenerationType.MANUAL });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelBuffer);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
      'Flight Summary', 'Counter Reservations', 'PreCheck', 'OutCheck Attempts',
      'OutCheck Details', 'Review History', 'Operational Issues', 'Audit Metadata',
    ]);
    assert.equal(workbook.getWorksheet('Flight Summary')!.getCell('B5').value, 'الخطوط التجريبية');
    assert.equal(workbook.getWorksheet('PreCheck')!.getCell('A11').value, 'C01');
    assert.equal(workbook.getWorksheet('OutCheck Attempts')!.getCell('A2').value, 1);
    assert.equal(workbook.getWorksheet('OutCheck Details')!.getCell('A2').value, 1);
    assert.equal(workbook.getWorksheet('Review History')!.getCell('B2').value, 'APPROVED');
    assert.equal(workbook.getWorksheet('PreCheck')!.getCell('F11').value, 'سليم');
    assert.match(formatOperationalReportDamascusTime(new Date('2026-01-01T21:00:00Z')), /02\/01\/2026, 00:00:00/);
    const excelPath = 'reports/flight/report-excel.xlsx';
    await storage.saveAtomic(excelPath, excelBuffer);

    const reports = new OperationalReportsService(prisma as any, access as any, assembler, { templateVersion: () => '1.0' } as any, excel, storage, { record: async () => undefined } as any);
    const admin = { id: 'admin-1', role: Role.ADMIN, companyId: null, permissions: [PermissionCode.CAN_EXPORT_REPORTS] } as any;
    await rejectsWith(() => reports.generateFlight('flight-1', { format: OperationalReportFormat.PDF }, admin), ConflictException);

    const generatedPrisma = {
      dailySessionFlight: prisma.dailySessionFlight,
      flightReport: {
        findUnique: async () => null,
        create: async ({ data }: any) => ({ ...pending, ...data, id: 'generated-report' }),
        update: async ({ data }: any) => ({ ...pending, ...data, id: 'generated-report', filePath: data.filePath ?? null }),
      },
    };
    const generatedService = new OperationalReportsService(
      generatedPrisma as any, access as any, assembler,
      { templateVersion: () => '1.0', render: async () => Buffer.from('%PDF-generated') } as any,
      excel, storage, { record: async () => undefined } as any,
    );
    const generated = await generatedService.generateFlight('flight-1', { format: OperationalReportFormat.PDF }, admin);
    assert.equal(generated.status, OperationalReportStatus.GENERATED);
    assert.equal('filePath' in generated, false);
    assert.match(String(generated.checksum), /^[a-f0-9]{64}$/);

    let failedState: any;
    const failedPrisma = {
      dailySessionFlight: prisma.dailySessionFlight,
      flightReport: {
        findUnique: async () => null,
        create: async ({ data }: any) => ({ ...pending, ...data, id: 'failed-report' }),
        update: async ({ data }: any) => { failedState = { ...pending, ...data, id: 'failed-report' }; return failedState; },
        findUniqueOrThrow: async () => failedState,
      },
    };
    const failedService = new OperationalReportsService(
      failedPrisma as any, access as any, assembler,
      { templateVersion: () => '1.0', render: async () => { throw new Error('controlled renderer failure'); } } as any,
      excel, storage, { record: async () => undefined } as any,
    );
    const failed = await failedService.generateFlight('flight-1', { format: OperationalReportFormat.PDF }, admin);
    assert.equal(failed.status, OperationalReportStatus.FAILED);
    assert.equal(failed.errorMessage, 'controlled renderer failure');

    await rejectsWith(
      () => (reports as any).assertCanReadFlightReport({ companyId: 'other', movementCategoryId: 'm', dailySessionFlight: { isCarryOver: false, dailyCompanySession: { dailyDuty: { movementSupervisorId: 'x' } } } }, { ...admin, role: Role.COMPANY_USER, companyId: 'mine' }),
      ForbiddenException,
    );
    await (reports as any).assertCanReadFlightReport(
      { companyId: 'mine', movementCategoryId: 'm', dailySessionFlight: { isCarryOver: false, dailyCompanySession: { dailyDuty: { movementSupervisorId: 'x' } } } },
      { ...admin, role: Role.COMPANY_USER, companyId: 'mine' },
    );

    let foundDownloadReport = true;
    const downloadPrisma = {
      flightReport: { findFirst: async () => foundDownloadReport ? ({
        ...pending, id: 'report-excel', companyId: 'mine', format: OperationalReportFormat.EXCEL,
        status: OperationalReportStatus.GENERATED, filePath: excelPath,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: createHash('sha256').update(excelBuffer).digest('hex'),
        dailySessionFlight: { isCarryOver: false, flight: { flightNumber: 'RB9001' },
          dailyCompanySession: { dailyDuty: { movementSupervisorId: 'x' } } },
      }) : null },
    };
    const downloadService = new OperationalReportsService(
      downloadPrisma as any, access as any, assembler, { templateVersion: () => '1.0' } as any,
      excel, storage, { record: async () => undefined } as any,
    );
    const companyUser = { ...admin, role: Role.COMPANY_USER, companyId: 'mine' };
    const excelDownload = await downloadService.downloadFlightReport('flight-1', 'report-excel', companyUser);
    assert.equal(excelDownload.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(excelDownload.filename, 'RB9001-flight-report.xlsx');
    await rejectsWith(
      () => downloadService.downloadFlightReport('flight-1', 'report-excel', { ...companyUser, companyId: 'other' }),
      ForbiddenException,
    );
    foundDownloadReport = false;
    await rejectsWith(() => downloadService.downloadFlightReport('wrong-flight', 'report-excel', companyUser), NotFoundException);

    const controller = new OperationalReportsController({
      downloadFlightReport: async () => ({ data: Buffer.from('%PDF'), mimeType: 'application/pdf', filename: 'RB9001-flight-report.pdf' }),
    } as any);
    const headers = new Map<string, unknown>();
    let body: Buffer | undefined;
    await controller.downloadFlightReport('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', admin, {
      setHeader: (name: string, value: unknown) => headers.set(name, value),
      end: (value: Buffer) => { body = value; },
    } as any);
    assert.equal(headers.get('Content-Type'), 'application/pdf');
    assert.match(String(headers.get('Content-Disposition')), /RB9001-flight-report\.pdf/);
    assert.equal(body?.toString(), '%PDF');

    console.log('Operational flight report tests passed: assembler, PDF/Excel lifecycle, workbook structure/content/Arabic/timezone, storage/checksum, idempotency, ownership/mismatch denial, dynamic download MIME/filenames.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
