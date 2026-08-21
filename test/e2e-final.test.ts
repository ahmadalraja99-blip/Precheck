import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DailySessionFlightStatus } from '@prisma/client';
import {
  assertDailySessionFlightTransitionAllowed,
  canTransitionDailySessionFlightStatus,
} from '../src/session-flights/daily-session-flight-status-machine';

const successPath = [
  DailySessionFlightStatus.SCHEDULED,
  DailySessionFlightStatus.PRECHECK_PENDING,
  DailySessionFlightStatus.PRECHECK_DONE,
  DailySessionFlightStatus.OPERATION,
  DailySessionFlightStatus.OUTCHECK_PENDING,
  DailySessionFlightStatus.CLOSED,
];

for (let index = 0; index < successPath.length - 1; index += 1) {
  assert.equal(canTransitionDailySessionFlightStatus(successPath[index], successPath[index + 1]), true);
  assert.doesNotThrow(() =>
    assertDailySessionFlightTransitionAllowed(successPath[index], successPath[index + 1]),
  );
}
assert.equal(
  canTransitionDailySessionFlightStatus(
    DailySessionFlightStatus.OUTCHECK_PENDING,
    DailySessionFlightStatus.OPERATION,
  ),
  false,
);
assert.equal(
  canTransitionDailySessionFlightStatus(
    DailySessionFlightStatus.CLOSED,
    DailySessionFlightStatus.OUTCHECK_PENDING,
  ),
  false,
);

const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
for (const constraint of [
  '@@unique([outCheckId, attemptNumber])',
  '@@unique([dailySessionFlightId, format, generationType, templateVersion])',
  '@@unique([dailySessionFlightId, generationType, emailPurpose, templateVersion, deliveryNumber])',
]) {
  assert.match(schema, new RegExp(constraint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
const cancelledHistoryMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260820000000_preserve_cancelled_operation_history',
    'migration.sql',
  ),
  'utf8',
);
assert.match(cancelledHistoryMigration, /DailyCompanySession_active_dailyDutyId_companyId_key/);
assert.match(cancelledHistoryMigration, /DailySessionFlight_active_sessionId_flightId_key/);
assert.match(cancelledHistoryMigration, /WHERE "status" <> 'CANCELLED'/);

const main = readFileSync(join(process.cwd(), 'src', 'main.ts'), 'utf8');
assert.match(main, /enableShutdownHooks\(\)/);
assert.match(main, /FRONTEND_ORIGIN/);
assert.doesNotMatch(main, /enableCors\(\s*\)/);

const health = readFileSync(join(process.cwd(), 'src', 'health', 'health.controller.ts'), 'utf8');
assert.match(health, /SELECT 1/);
assert.doesNotMatch(health, /DATABASE_URL|connectionString|credentials/);

const frontendApi = readFileSync(
  join(process.cwd(), '..', 'Precheck-Frontend', 'src', 'features', 'operations', 'api', 'daily-session-flights-api.ts'),
  'utf8',
);
for (const route of ['/session-flights', '/daily-company-sessions']) {
  assert.match(frontendApi, new RegExp(route.replaceAll('/', '\\/')));
}

console.log(
  'final E2E contract tests passed: success state machine, illegal transitions, immutable/idempotent constraints, production bootstrap, health safety, and frontend operational route alignment',
);
