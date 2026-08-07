import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import {
  CounterReservationStatus, DailyFlightOutCheckSubmissionStatus, OperationalReportFormat,
  OperationalReportGenerationType, OperationalReportJobStatus, OperationalReportStatus,
  PermissionCode, Role,
} from '@prisma/client';
import { DailyFlightOutCheckReviewsService } from '../src/session-flights/outcheck/reviews/daily-flight-outcheck-reviews.service';
import { OperationalReportJobsProcessor } from '../src/operational-reports/operational-report-jobs.processor';
import { OperationalReportJobsService } from '../src/operational-reports/operational-report-jobs.service';
import { OperationalReportJobsController } from '../src/operational-reports/operational-report-jobs.controller';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';

const now = new Date('2026-08-07T12:00:00Z');
const baseJob: any = {
  id: 'job-1', dailySessionFlightId: 'flight-1', format: OperationalReportFormat.PDF,
  generationType: OperationalReportGenerationType.AUTOMATIC_FINAL_CLOSE, templateVersion: '1.0',
  status: OperationalReportJobStatus.PROCESSING, attempts: 1, maxAttempts: 5,
  nextAttemptAt: now, lockedAt: now, lockedBy: 'worker', lastError: null,
  completedAt: null, createdAt: now, updatedAt: now,
};
const actor: any = { id: 'admin-1', email: 'a@test', fullName: 'Admin', role: Role.ADMIN,
  companyId: null, permissions: [PermissionCode.CAN_EXPORT_REPORTS] };

async function run() {
  const jobKeys = new Set<string>();
  const auditEvents: any[] = [];
  const tx: any = {
    dailyFlightOutCheckReview: { create: async ({ data }: any) => ({ ...data, reviewedAt: now }) },
    dailyFlightOutCheckSubmission: { updateMany: async () => ({ count: 1 }) },
    dailyFlightOutCheck: { update: async () => ({}) },
    counterReservation: { updateMany: async () => ({ count: 1 }) },
    dailySessionFlight: { update: async () => ({ status: 'CLOSED' }) },
    dailyFlightOperationalIssue: { count: async () => 0 },
    operationalReportJob: { upsert: async ({ create }: any) => {
      const key = `${create.dailySessionFlightId}:${create.format}:${create.generationType}:${create.templateVersion}`;
      jobKeys.add(key);
      return { id: `job-${create.format}`, ...create };
    } },
    auditLog: { create: async () => ({}) },
  };
  const audit: any = { record: async (event: any) => { auditEvents.push(event); return event; } };
  const reviews = new DailyFlightOutCheckReviewsService({} as any, audit);
  const commit = () => (reviews as any).commitApproval(tx, 'approved', { id: 'reviewer', fullName: 'Reviewer' },
    'flight-1', 'outcheck-1', { id: 'attempt-1', attemptNumber: 1, submittedById: actor.id }, ['reservation-1'], actor);
  await commit();
  await commit();
  assert.equal(jobKeys.size, 2);
  assert.ok(jobKeys.has(`flight-1:${OperationalReportFormat.PDF}:${OperationalReportGenerationType.AUTOMATIC_FINAL_CLOSE}:1.0`));
  assert.ok(jobKeys.has(`flight-1:${OperationalReportFormat.EXCEL}:${OperationalReportGenerationType.AUTOMATIC_FINAL_CLOSE}:1.0`));
  assert.equal(auditEvents.filter((event) => event.action === 'ENQUEUE_OPERATIONAL_REPORT_JOB').length, 4);

  let queryCalls = 0;
  const updates: any[] = [];
  const processorPrisma: any = {
    $queryRaw: async () => (++queryCalls === 1 ? [baseJob] : []),
    operationalReportJob: {
      findMany: async () => [],
      updateMany: async ({ data }: any) => { updates.push(data); return { count: 1 }; },
    },
    dailySessionFlight: { findUnique: async () => ({ createdBy: actor }) },
  };
  const processor = new OperationalReportJobsProcessor(processorPrisma, {
    generateAutomaticFlight: async () => ({ id: 'report-1', status: OperationalReportStatus.GENERATED }),
  } as any, audit, { get: (_key: string, fallback: unknown) => fallback } as any);
  assert.equal((await processor.claimBatch()).length, 1);
  assert.equal((await processor.claimBatch()).length, 0);
  await processor.process(baseJob);
  assert.ok(updates.some((data) => data.status === OperationalReportJobStatus.COMPLETED));

  const retryUpdates: any[] = [];
  const failing = new OperationalReportJobsProcessor({
    ...processorPrisma,
    operationalReportJob: { findMany: async () => [], updateMany: async ({ data }: any) => { retryUpdates.push(data); return { count: 1 }; } },
  } as any, { generateAutomaticFlight: async () => { throw new Error('font unavailable\nstack hidden'); } } as any,
  audit, { get: (key: string, fallback: unknown) => key === 'OPERATIONAL_REPORT_JOB_RETRY_BASE_MS' ? 1000 : fallback } as any);
  await failing.process(baseJob);
  const retry = retryUpdates.find((data) => data.status === OperationalReportJobStatus.FAILED);
  assert.equal(retry.lastError, 'font unavailable stack hidden');
  assert.ok(retry.nextAttemptAt.getTime() > Date.now());
  await failing.process({ ...baseJob, attempts: 5, maxAttempts: 5, format: OperationalReportFormat.EXCEL });
  assert.ok(auditEvents.some((event) => event.action === 'EXHAUST_OPERATIONAL_REPORT_JOB'));

  let staleRecovered = false;
  const staleProcessor = new OperationalReportJobsProcessor({
    operationalReportJob: {
      findMany: async () => [{ ...baseJob, lockedAt: new Date('2020-01-01') }],
      updateMany: async () => { staleRecovered = true; return { count: 1 }; },
    },
  } as any, {} as any, audit, { get: (_key: string, fallback: unknown) => fallback } as any);
  assert.equal(await staleProcessor.recoverStaleJobs(now), 1);
  assert.equal(staleRecovered, true);
  assert.ok(auditEvents.some((event) => event.action === 'RECOVER_STALE_OPERATIONAL_REPORT_JOB'));

  let retryData: any;
  const jobsService = new OperationalReportJobsService({ operationalReportJob: {
    findUnique: async () => ({ ...baseJob, status: OperationalReportJobStatus.FAILED, attempts: 5, maxAttempts: 5 }),
    updateMany: async ({ data }: any) => { retryData = data; return { count: 1 }; },
    findUniqueOrThrow: async () => ({}),
  } } as any, audit);
  (jobsService as any).find = async () => ({ id: baseJob.id, status: OperationalReportJobStatus.PENDING });
  await jobsService.retry(baseJob.id, actor);
  assert.equal(retryData.status, OperationalReportJobStatus.PENDING);
  assert.equal(retryData.maxAttempts, 6);
  await assert.rejects(
    () => new OperationalReportJobsService({ operationalReportJob: { findUnique: async () => ({ ...baseJob, status: OperationalReportJobStatus.COMPLETED }) } } as any, audit).retry(baseJob.id, actor),
    (error: unknown) => error instanceof ConflictException,
  );

  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, OperationalReportJobsController), [Role.ADMIN, Role.SUPER_ADMIN]);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, OperationalReportJobsController), [PermissionCode.CAN_EXPORT_REPORTS]);
  assert.equal(jobKeys.size, 2, 'rendering failures must not alter the durable closure jobs');
  console.log('Operational report job tests passed: transactional enqueue/idempotency, independent formats, atomic claim, success/failure/backoff/exhaustion, stale recovery, persistence, admin retry and role gating.');
}

void run().catch((error) => { console.error(error); process.exitCode = 1; });
