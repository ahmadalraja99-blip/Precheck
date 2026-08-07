import { Injectable } from '@nestjs/common';
import { OperationalReportFormat, OperationalReportGenerationType } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import type { OperationalFlightReportData } from './operational-flight-report-data.service';
import { OPERATIONAL_REPORT_TEMPLATE_VERSION, OPERATIONAL_REPORT_TIME_ZONE } from './operational-report.constants';

const TEMPLATE_VERSION = OPERATIONAL_REPORT_TEMPLATE_VERSION;
const TIME_ZONE = OPERATIONAL_REPORT_TIME_ZONE;
const SYSTEM_IDENTIFIER = 'PRECHECK_DAILY_SESSION_FLIGHT';
const WORKBOOK_THEME = Object.freeze({
  header: 'FF1F4E78',
  section: 'FFD9EAF7',
  headerText: 'FFFFFFFF',
  border: 'FF9EADBA',
});

export function formatOperationalReportDamascusTime(value: Date | null) {
  if (!value) return 'N/A';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(value);
}

export interface OperationalExcelRenderContext {
  reportId: string;
  generatedBy: string;
  generatedAt: Date;
  generationType: OperationalReportGenerationType;
}

@Injectable()
export class OperationalFlightExcelService {
  templateVersion() {
    return TEMPLATE_VERSION;
  }

  async render(data: OperationalFlightReportData, context: OperationalExcelRenderContext) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Online PreCheck / OutCheck System';
    workbook.created = context.generatedAt;
    workbook.modified = context.generatedAt;
    workbook.properties.date1904 = false;

    const arabic = this.hasArabic(data);
    const addSheet = (name: string) => {
      const sheet = workbook.addWorksheet(name, {
        views: [{ state: 'frozen', ySplit: 1, rightToLeft: arabic }],
        pageSetup: {
          orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
          margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
        },
      });
      sheet.pageSetup.printTitlesRow = '1:1';
      return sheet;
    };
    const styleHeader = (sheet: ExcelJS.Worksheet) => {
      const row = sheet.getRow(1);
      row.font = { bold: true, color: { argb: WORKBOOK_THEME.headerText } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WORKBOOK_THEME.header } };
      row.alignment = { vertical: 'middle', wrapText: true };
      row.height = 28;
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
      sheet.eachRow((current) => current.eachCell((cell) => {
        cell.alignment = { ...cell.alignment, vertical: 'top', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: WORKBOOK_THEME.border } },
          left: { style: 'thin', color: { argb: WORKBOOK_THEME.border } },
          bottom: { style: 'thin', color: { argb: WORKBOOK_THEME.border } },
          right: { style: 'thin', color: { argb: WORKBOOK_THEME.border } },
        };
      }));
    };
    const keyValueSheet = (name: string, rows: Array<[string, string | number]>) => {
      const sheet = addSheet(name);
      sheet.columns = [{ header: 'Field', key: 'field', width: 34 }, { header: 'Value', key: 'value', width: 72 }];
      rows.forEach(([field, value]) => sheet.addRow({ field, value }));
      styleHeader(sheet);
      return sheet;
    };

    keyValueSheet('Flight Summary', [
      ['Report ID', context.reportId], ['Report / Template Version', TEMPLATE_VERSION],
      ['Generated At (Asia/Damascus)', formatOperationalReportDamascusTime(context.generatedAt)],
      ['Airline Name', data.company.name], ['Airline Code', data.company.code],
      ['Flight Number', data.flight.flightNumber], ['Origin', data.flight.origin ?? 'N/A'],
      ['Destination', data.flight.destination ?? 'N/A'], ['Aircraft Type', data.flight.aircraftType ?? 'N/A'],
      ['Scheduled Departure', formatOperationalReportDamascusTime(data.flight.scheduledDepartureAt)],
      ['Check-in Start', formatOperationalReportDamascusTime(data.flight.checkInStartsAt)],
      ['Check-in End', formatOperationalReportDamascusTime(data.flight.checkInEndsAt)],
      ['Flight Status', data.flight.status],
      ['Carry-over State', data.flight.isCarryOver ? `Yes (${data.flight.handoverStatus})` : 'No'],
      ['Movement Category', `${data.duty.movementCategoryName} (${data.duty.movementCategoryCode})`],
      ['Daily Duty ID', data.duty.id], ['Company Session ID', data.duty.companySessionId],
      ['Notes', data.flight.notes ?? 'None'],
      ['Authoritative Closure Timestamp', formatOperationalReportDamascusTime(data.lifecycle.closedAt)],
      ['Closure Timestamp Basis / Limitation', data.lifecycle.closedAtBasis],
    ]);

    const reservations = addSheet('Counter Reservations');
    reservations.columns = [
      { header: 'Counter Code', key: 'counterCode', width: 16 }, { header: 'Counter Name', key: 'counterName', width: 28 },
      { header: 'Reserved From', key: 'reservedFrom', width: 24 }, { header: 'Reserved To', key: 'reservedTo', width: 24 },
      { header: 'Reservation Status', key: 'status', width: 22 },
    ];
    data.reservations.forEach((item) => reservations.addRow({ ...item,
      reservedFrom: formatOperationalReportDamascusTime(item.reservedFrom),
      reservedTo: formatOperationalReportDamascusTime(item.reservedTo),
    }));
    styleHeader(reservations);

    const preCheck = addSheet('PreCheck');
    preCheck.columns = [
      { header: 'Counter Code', key: 'counterCode', width: 16 }, { header: 'Counter Name', key: 'counterName', width: 26 },
      { header: 'Check Item', key: 'checkItemName', width: 34 }, { header: 'Category', key: 'category', width: 22 },
      { header: 'Result', key: 'result', width: 18 }, { header: 'Notes', key: 'note', width: 32 },
      { header: 'Snapshot Description', key: 'description', width: 42 }, { header: 'Updated At', key: 'updatedAt', width: 24 },
    ];
    if (data.preCheck) {
      const totals = this.preCheckTotals(data.preCheck.items);
      const summary = [
        ['Status', data.preCheck.status], ['Started At', formatOperationalReportDamascusTime(data.preCheck.startedAt)],
        ['Submitted At', formatOperationalReportDamascusTime(data.preCheck.submittedAt)],
        ['Performed By', data.preCheck.submittedBy ?? data.preCheck.startedBy], ['Total', totals.total],
        ['Passed', totals.passed], ['Failed', totals.failed], ['Not Applicable', totals.notApplicable], ['Unanswered', totals.unanswered],
      ];
      summary.forEach(([label, value]) => {
        const row = preCheck.addRow({ counterCode: label, counterName: value });
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WORKBOOK_THEME.section } };
        row.font = { bold: true };
      });
      data.preCheck.items.forEach((item) => preCheck.addRow({
        ...item, description: item.checkItemDescription ?? '',
        result: item.result ?? 'UNANSWERED', updatedAt: formatOperationalReportDamascusTime(item.updatedAt),
      }));
    }
    styleHeader(preCheck);

    const attempts = addSheet('OutCheck Attempts');
    attempts.columns = [
      { header: 'Attempt Number', key: 'attemptNumber', width: 16 }, { header: 'Submitted By', key: 'submittedBy', width: 28 },
      { header: 'Submitted At', key: 'submittedAt', width: 24 }, { header: 'Total', key: 'total', width: 12 },
      { header: 'Passed', key: 'pass', width: 12 }, { header: 'Failed', key: 'fail', width: 12 },
      { header: 'Not Applicable', key: 'notApplicable', width: 16 }, { header: 'Review Decision', key: 'decision', width: 20 },
      { header: 'Reviewed By', key: 'reviewedBy', width: 28 }, { header: 'Reviewed At', key: 'reviewedAt', width: 24 },
      { header: 'Approval Comment', key: 'approvalComment', width: 38 }, { header: 'Rejection Reason', key: 'rejectionReason', width: 38 },
    ];
    data.outCheck?.attempts.forEach((item) => attempts.addRow({
      attemptNumber: item.attemptNumber, submittedBy: item.submittedBy ?? 'N/A',
      submittedAt: formatOperationalReportDamascusTime(item.submittedAt), ...item.totals,
      decision: item.review?.decision ?? 'PENDING', reviewedBy: item.review?.reviewedBy ?? 'N/A',
      reviewedAt: formatOperationalReportDamascusTime(item.review?.reviewedAt ?? null),
      approvalComment: item.review?.approvalComment ?? '', rejectionReason: item.review?.rejectionReason ?? '',
    }));
    styleHeader(attempts);

    const details = addSheet('OutCheck Details');
    details.columns = [
      { header: 'Attempt Number', key: 'attemptNumber', width: 16 }, { header: 'Counter Code', key: 'counterCode', width: 16 },
      { header: 'Counter Name', key: 'counterName', width: 26 }, { header: 'Check Item', key: 'checkItemName', width: 34 },
      { header: 'Category', key: 'category', width: 22 }, { header: 'Result', key: 'result', width: 18 },
      { header: 'Notes', key: 'note', width: 34 }, { header: 'Submitted At', key: 'submittedAt', width: 24 },
    ];
    data.outCheck?.attempts.forEach((attempt) => attempt.items.forEach((item) => details.addRow({
      attemptNumber: attempt.attemptNumber, ...item,
      submittedAt: formatOperationalReportDamascusTime(item.submittedAt),
    })));
    styleHeader(details);

    const reviews = addSheet('Review History');
    reviews.columns = [
      { header: 'Attempt Number', key: 'attemptNumber', width: 16 }, { header: 'Decision', key: 'decision', width: 20 },
      { header: 'Reviewer', key: 'reviewer', width: 30 }, { header: 'Reviewed At', key: 'reviewedAt', width: 24 },
      { header: 'Approval Comment', key: 'approvalComment', width: 44 }, { header: 'Rejection Reason', key: 'rejectionReason', width: 44 },
    ];
    data.outCheck?.attempts.filter((item) => item.review).forEach((item) => reviews.addRow({
      attemptNumber: item.attemptNumber, decision: item.review!.decision, reviewer: item.review!.reviewedBy,
      reviewedAt: formatOperationalReportDamascusTime(item.review!.reviewedAt),
      approvalComment: item.review!.approvalComment ?? '', rejectionReason: item.review!.rejectionReason ?? '',
    }));
    styleHeader(reviews);

    const issues = addSheet('Operational Issues');
    issues.columns = [
      { header: 'Counter', key: 'counterCode', width: 14 }, { header: 'Attempt', key: 'attemptNumber', width: 12 },
      { header: 'Check Item', key: 'checkItemName', width: 34 }, { header: 'Status', key: 'status', width: 16 },
      { header: 'Failure Note', key: 'failureNote', width: 42 }, { header: 'Rejection Reason', key: 'rejectionReason', width: 42 },
      { header: 'Reported By', key: 'reportedBy', width: 28 }, { header: 'Reported At', key: 'reportedAt', width: 24 },
      { header: 'Resolution', key: 'resolutionNote', width: 42 }, { header: 'Resolved By', key: 'resolvedBy', width: 28 },
      { header: 'Resolved At', key: 'resolvedAt', width: 24 },
    ];
    data.operationalIssues.forEach((item) => issues.addRow({ ...item,
      reportedAt: formatOperationalReportDamascusTime(item.reportedAt),
      resolvedAt: formatOperationalReportDamascusTime(item.resolvedAt) }));
    styleHeader(issues);

    keyValueSheet('Audit Metadata', [
      ['Report Generation Type', context.generationType], ['Report Format', OperationalReportFormat.EXCEL],
      ['Template Version', TEMPLATE_VERSION], ['Checksum', 'CALCULATED_AFTER_WORKBOOK_FINALIZATION'],
      ['Source Flight ID', data.flight.id], ['Company ID', data.company.id], ['Generated By', context.generatedBy],
      ['Generated At', formatOperationalReportDamascusTime(context.generatedAt)], ['Timezone', TIME_ZONE],
      ['System Identifier', SYSTEM_IDENTIFIER],
    ]);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private preCheckTotals(items: NonNullable<OperationalFlightReportData['preCheck']>['items']) {
    return {
      total: items.length,
      passed: items.filter((item) => item.result === 'PASS').length,
      failed: items.filter((item) => item.result === 'FAIL').length,
      notApplicable: items.filter((item) => item.result === 'NOT_APPLICABLE').length,
      unanswered: items.filter((item) => item.result === null).length,
    };
  }

  private hasArabic(data: OperationalFlightReportData) {
    return /[\u0600-\u06ff]/.test(JSON.stringify(data));
  }
}
