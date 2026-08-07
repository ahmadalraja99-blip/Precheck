import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access } from 'fs/promises';
import PDFDocument = require('pdfkit');
import { StorageService } from '../storage/storage.service';
import type { OperationalFlightReportData } from './operational-flight-report-data.service';
import { OPERATIONAL_REPORT_TEMPLATE_VERSION, OPERATIONAL_REPORT_TIME_ZONE } from './operational-report.constants';

const TEMPLATE_VERSION = OPERATIONAL_REPORT_TEMPLATE_VERSION;
const TIME_ZONE = OPERATIONAL_REPORT_TIME_ZONE;

@Injectable()
export class OperationalFlightPdfService {
  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  templateVersion() {
    return TEMPLATE_VERSION;
  }

  private format(value: Date | null) {
    if (!value) return 'N/A';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(value);
  }

  private async fonts() {
    const regular = this.config.get<string>('REPORT_FONT_REGULAR_PATH')?.trim();
    const bold = this.config.get<string>('REPORT_FONT_BOLD_PATH')?.trim();
    if (!regular || !bold) {
      throw new Error('Arabic report fonts are not configured (REPORT_FONT_REGULAR_PATH and REPORT_FONT_BOLD_PATH are required)');
    }
    await Promise.all([access(regular), access(bold)]).catch(() => {
      throw new Error('Configured Arabic report font file is not readable');
    });
    return { regular, bold };
  }

  async render(data: OperationalFlightReportData, generatedAt: Date) {
    const fonts = await this.fonts();
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    const completed = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    doc.registerFont('ReportRegular', fonts.regular);
    doc.registerFont('ReportBold', fonts.bold);

    const ensure = (height = 45) => {
      if (doc.y + height > doc.page.height - 55) doc.addPage();
    };
    const title = (value: string) => {
      ensure(42);
      doc.moveDown(0.5).font('ReportBold').fontSize(13).fillColor('#123a63').text(value);
      doc.moveDown(0.25).strokeColor('#b8c7d9').moveTo(42, doc.y).lineTo(553, doc.y).stroke();
      doc.moveDown(0.45).fillColor('#111827');
    };
    const line = (label: string, value: unknown) => {
      ensure(20);
      doc.font('ReportBold').fontSize(9).text(`${label}: `, { continued: true });
      doc.font('ReportRegular').text(String(value ?? 'N/A'));
    };
    const table = (headers: string[], rows: string[][], widths: number[]) => {
      const rowHeight = 24;
      const drawRow = (cells: string[], header = false) => {
        ensure(rowHeight + 4);
        const y = doc.y;
        let x = 42;
        cells.forEach((cell, index) => {
          doc.rect(x, y, widths[index], rowHeight).fillAndStroke(header ? '#dce8f4' : '#ffffff', '#b8c7d9');
          doc.fillColor('#111827').font(header ? 'ReportBold' : 'ReportRegular').fontSize(7.5)
            .text(cell || '—', x + 4, y + 5, { width: widths[index] - 8, height: rowHeight - 8, ellipsis: true });
          x += widths[index];
        });
        doc.y = y + rowHeight;
      };
      drawRow(headers, true);
      rows.forEach((row) => drawRow(row));
      doc.moveDown(0.4);
    };

    doc.font('ReportBold').fontSize(20).fillColor('#123a63').text('Online PreCheck / OutCheck System');
    doc.fontSize(15).text('Operational Flight Report');
    doc.moveDown(0.5);
    const logoPath = data.company.logoPath;
    if (logoPath) {
      try {
        const logo = await this.storage.assertFile(logoPath);
        doc.image(logo.fullPath, 455, 42, { fit: [95, 55], align: 'right' });
      } catch {
        // An absent or unsafe optional logo never weakens report generation.
      }
    }
    line('Airline', `${data.company.name} (${data.company.code})`);
    line('Flight', data.flight.flightNumber);
    line('Generated', `${this.format(generatedAt)} (${TIME_ZONE})`);
    line('Template version', TEMPLATE_VERSION);

    title('Flight summary');
    line('Route', `${data.flight.origin ?? 'N/A'} → ${data.flight.destination ?? 'N/A'}`);
    line('Aircraft', data.flight.aircraftType ?? 'N/A');
    line('Scheduled departure', this.format(data.flight.scheduledDepartureAt));
    line('Check-in window', `${this.format(data.flight.checkInStartsAt)} – ${this.format(data.flight.checkInEndsAt)}`);
    line('Operational status', data.flight.status);
    line('Carry-over', data.flight.isCarryOver ? `Yes (${data.flight.handoverStatus})` : 'No');
    line('Notes', data.flight.notes ?? 'None');

    title('Duty and Company Session');
    line('Daily Duty ID', data.duty.id);
    line('Company Session ID', data.duty.companySessionId);
    line('Movement category', `${data.duty.movementCategoryName} (${data.duty.movementCategoryCode})`);
    line('Duty period', `${this.format(data.duty.activatedAt)} – ${this.format(data.duty.expiresAt)}`);

    title('Reserved counters');
    table(['Code', 'Counter', 'Reserved from', 'Reserved to', 'Status'], data.reservations.map((row) => [
      row.counterCode, row.counterName, this.format(row.reservedFrom), this.format(row.reservedTo), row.status,
    ]), [48, 112, 125, 125, 101]);

    title('PreCheck summary');
    if (!data.preCheck) line('PreCheck', 'Not available');
    else {
      line('Status', data.preCheck.status);
      line('Started', `${this.format(data.preCheck.startedAt)} by ${data.preCheck.startedBy}`);
      line('Submitted', `${this.format(data.preCheck.submittedAt)} by ${data.preCheck.submittedBy ?? 'N/A'}`);
      title('PreCheck detailed items');
      table(['Counter', 'Category', 'Check item', 'Result', 'Notes'], data.preCheck.items.map((item) => [
        item.counterCode, item.category, item.checkItemName, item.result ?? 'UNANSWERED', item.note ?? '',
      ]), [55, 95, 190, 70, 101]);
    }

    title('OutCheck summary and attempts');
    if (!data.outCheck) line('OutCheck', 'Not available');
    else {
      line('Status', data.outCheck.status);
      line('Started', `${this.format(data.outCheck.startedAt)} by ${data.outCheck.startedBy}`);
      for (const attempt of data.outCheck.attempts) {
        title(`OutCheck attempt ${attempt.attemptNumber}`);
        line('Status', attempt.status);
        line('Submitted', `${this.format(attempt.submittedAt)} by ${attempt.submittedBy ?? 'N/A'}`);
        line('Totals', `Pass ${attempt.totals.pass}; Fail ${attempt.totals.fail}; N/A ${attempt.totals.notApplicable}; Total ${attempt.totals.total}`);
        if (attempt.review) {
          line('Review', `${attempt.review.decision} by ${attempt.review.reviewedBy} at ${this.format(attempt.review.reviewedAt)}`);
          line('Approval comment', attempt.review.approvalComment ?? 'None');
          line('Rejection reason', attempt.review.rejectionReason ?? 'None');
        } else line('Review', 'Pending');
        table(['Counter', 'Category', 'Check item', 'Result', 'Notes'], attempt.items.map((item) => [
          item.counterCode, item.category, item.checkItemName, item.result, item.note ?? '',
        ]), [55, 95, 190, 70, 101]);
      }
    }

    title('Operational issues and corrective action');
    if (!data.operationalIssues.length) line('Issues', 'None');
    for (const issue of data.operationalIssues) {
      line(`${issue.counterCode} / ${issue.checkItemName}`, `${issue.status}; attempt ${issue.attemptNumber ?? 'PreCheck'}`);
      line('Failure', issue.failureNote); line('Rejection', issue.rejectionReason ?? 'None');
      line('Reported', `${this.format(issue.reportedAt)} by ${issue.reportedBy}`);
      line('Resolution', issue.resolutionNote ?? 'Open');
      if (issue.resolvedAt) line('Resolved', `${this.format(issue.resolvedAt)} by ${issue.resolvedBy ?? 'N/A'}`);
    }

    title('Final lifecycle');
    line('Final status', data.lifecycle.finalStatus);
    line('Closed timestamp', this.format(data.lifecycle.closedAt));
    line('Timestamp basis', data.lifecycle.closedAtBasis);

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      doc.font('ReportRegular').fontSize(8).fillColor('#64748b')
        .text(`Page ${index + 1} of ${range.count}`, 42, doc.page.height - 35, { width: 511, align: 'center' });
    }
    doc.end();
    return completed;
  }
}
