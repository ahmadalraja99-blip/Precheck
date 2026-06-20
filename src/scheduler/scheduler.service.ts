import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class SchedulerService {
  constructor(
    private readonly config: ConfigService,
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  @Cron(process.env.DAILY_BACKUP_CRON || '0 1 * * *')
  async dailyPdfBackup() {
    const report = await this.reports.generateDailyPdfBackup(new Date());
    await this.emailSuperAdmins('Daily PDF backup', 'Attached daily PreCheck / OutCheck backup.', report.pdfPath ? [{ filename: 'daily-backup.pdf', path: this.storage.resolve(report.pdfPath) }] : []);
    await this.audit.record({ action: 'DAILY_PDF_BACKUP', entityType: 'Report', entityId: report.id });
  }

  @Cron(process.env.WEEKLY_BACKUP_CRON || '0 2 * * 1')
  async weeklyExcelBackup() {
    const report = await this.reports.generateWeeklyExcelBackup(new Date());
    await this.emailSuperAdmins('Weekly Excel backup', 'Attached weekly PreCheck / OutCheck backup.', report.excelPath ? [{ filename: 'weekly-backup.xlsx', path: this.storage.resolve(report.excelPath) }] : []);
    await this.audit.record({ action: 'WEEKLY_EXCEL_BACKUP', entityType: 'Report', entityId: report.id });
  }

  async backupPostgresqlPlaceholder() {
    return { message: 'PostgreSQL backup placeholder. Implement with approved infrastructure tooling, not shell commands from the app process.' };
  }

  async backupReportFilesPlaceholder() {
    return { message: 'Report files backup placeholder. Copy STORAGE_ROOT to object storage or managed backup storage in production.' };
  }

  private async emailSuperAdmins(subject: string, body: string, attachments: { filename: string; path: string }[]) {
    const superAdmins = await this.prisma.user.findMany({ where: { role: Role.SUPER_ADMIN, isActive: true } });
    if (!superAdmins.length) return;
    await this.mailer.send({ to: superAdmins.map((user) => user.email), subject, body, attachments, relatedEntityType: 'Report' });
  }
}
