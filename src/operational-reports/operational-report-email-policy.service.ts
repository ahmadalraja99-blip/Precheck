import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OperationalReportFormat, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OperationalReportEmailPolicyService {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  enabled() { return this.bool('OPERATIONAL_REPORT_EMAIL_ENABLED', false); }
  autoSend() { return this.bool('OPERATIONAL_REPORT_EMAIL_AUTO_SEND', true); }
  locale(): 'en' | 'ar' { return this.config.get('OPERATIONAL_REPORT_EMAIL_LOCALE') === 'ar' ? 'ar' : 'en'; }
  maxAttempts() { return this.positiveInt('OPERATIONAL_REPORT_EMAIL_MAX_ATTEMPTS', 5); }
  retryBaseMs() { return this.positiveInt('OPERATIONAL_REPORT_EMAIL_RETRY_BASE_MS', 60000); }
  batchSize() { return this.positiveInt('OPERATIONAL_REPORT_EMAIL_BATCH_SIZE', 10); }
  staleLockMs() { return this.positiveInt('OPERATIONAL_REPORT_EMAIL_STALE_LOCK_MS', 600000); }

  requiredFormats() {
    const formats: OperationalReportFormat[] = [];
    if (this.bool('OPERATIONAL_REPORT_EMAIL_INCLUDE_PDF', true)) formats.push(OperationalReportFormat.PDF);
    if (this.bool('OPERATIONAL_REPORT_EMAIL_INCLUDE_EXCEL', true)) formats.push(OperationalReportFormat.EXCEL);
    return formats;
  }

  async recipients(companyId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          ...(this.bool('OPERATIONAL_REPORT_EMAIL_TO_ADMINS', true)
            ? [{ role: { in: [Role.ADMIN, Role.SUPER_ADMIN] } }] : []),
          ...(this.bool('OPERATIONAL_REPORT_EMAIL_TO_COMPANY', true)
            ? [{ role: Role.COMPANY_USER, companyId }] : []),
        ],
      },
      select: { email: true },
    });
    return this.dedupe({
      to: users.map((item) => item.email),
      cc: this.list('OPERATIONAL_REPORT_EMAIL_CC'),
      bcc: this.list('OPERATIONAL_REPORT_EMAIL_BCC'),
    });
  }

  private dedupe(groups: { to: string[]; cc: string[]; bcc: string[] }) {
    const seen = new Set<string>();
    const clean = (values: string[]) => values.map((value) => value.trim().toLowerCase())
      .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      .filter((value) => !seen.has(value) && Boolean(seen.add(value)));
    return { to: clean(groups.to), cc: clean(groups.cc), bcc: clean(groups.bcc) };
  }

  private list(key: string) {
    return String(this.config.get(key, '')).split(/[;,]/).map((value) => value.trim()).filter(Boolean);
  }

  private bool(key: string, fallback: boolean) {
    const value = String(this.config.get(key, fallback)).toLowerCase();
    return ['true', '1', 'yes'].includes(value);
  }

  private positiveInt(key: string, fallback: number) {
    const value = Number(this.config.get(key, fallback));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
