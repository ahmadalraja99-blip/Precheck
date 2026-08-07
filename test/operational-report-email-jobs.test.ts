import * as assert from 'node:assert/strict';
import { OperationalReportEmailPolicyService } from '../src/operational-reports/operational-report-email-policy.service';

const values: Record<string, unknown> = {
  OPERATIONAL_REPORT_EMAIL_ENABLED: 'true', OPERATIONAL_REPORT_EMAIL_INCLUDE_PDF: 'true',
  OPERATIONAL_REPORT_EMAIL_INCLUDE_EXCEL: 'false', OPERATIONAL_REPORT_EMAIL_TO_ADMINS: 'true',
  OPERATIONAL_REPORT_EMAIL_TO_COMPANY: 'true', OPERATIONAL_REPORT_EMAIL_CC: 'COPY@example.com, invalid',
  OPERATIONAL_REPORT_EMAIL_BCC: 'copy@example.com; hidden@example.com',
};
const config = { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as any;
const prisma = { user: { findMany: async () => [{ email: 'ADMIN@example.com' }, { email: 'admin@example.com' },
  { email: 'company@example.com' }, { email: 'not-an-email' }] } } as any;
const policy = new OperationalReportEmailPolicyService(config, prisma);

async function run() {
  assert.equal(policy.enabled(), true);
  assert.deepEqual(policy.requiredFormats(), ['PDF']);
  const recipients = await policy.recipients('company-id');
  assert.deepEqual(recipients.to, ['admin@example.com', 'company@example.com']);
  assert.deepEqual(recipients.cc, ['copy@example.com']);
  assert.deepEqual(recipients.bcc, ['hidden@example.com']);
  console.log('operational report email policy tests passed');
}
void run();
