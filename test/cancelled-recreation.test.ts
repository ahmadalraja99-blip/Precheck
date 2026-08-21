import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import {
  DailyCompanySessionStatus,
  DailySessionFlightStatus,
  Role,
} from '@prisma/client';
import { DailyCompanySessionsService } from '../src/daily-company-sessions/daily-company-sessions.service';
import { SessionFlightsService } from '../src/session-flights/session-flights.service';

const currentUser = {
  id: 'supervisor-id',
  email: 'supervisor@example.com',
  role: Role.MOVEMENT_SUPERVISOR,
  permissions: [],
} as any;

async function plannedCountMustBePositive() {
  const service = new DailyCompanySessionsService({} as any, {} as any, {} as any);
  await assert.rejects(
    service.create({ plannedFlightsCount: 0 } as any, currentUser),
    BadRequestException,
  );
}

async function cancelledSessionIsRecreatedAndPreserved() {
  const cancelled = { id: 'cancelled-session', status: DailyCompanySessionStatus.CANCELLED };
  const replacement = {
    id: 'replacement-session',
    dailyDutyId: 'duty-id',
    companyId: 'company-id',
    movementCategoryId: 'category-id',
    plannedFlightsCount: 2,
    status: DailyCompanySessionStatus.SCHEDULED,
    updatedAt: new Date(),
  };
  let activeLookupWhere: any;
  let deleteCalled = false;
  const prisma = {
    company: {
      findUnique: async () => ({ id: 'company-id', isActive: true }),
      delete: async () => { deleteCalled = true; },
    },
    dailyCompanySession: {
      findFirst: async ({ where }: any) => {
        activeLookupWhere = where;
        return undefined;
      },
      create: async () => replacement,
      findUnique: async () => cancelled,
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({ ...cancelled, updatedAt: new Date() }),
    },
  } as any;
  const access = {
    assertCompanyScope: () => undefined,
    assertActiveDuty: async () => ({ id: 'duty-id', movementCategoryId: 'category-id' }),
    assertCanModifySession: async () => undefined,
  } as any;
  const service = new DailyCompanySessionsService(
    prisma,
    access,
    { record: async () => undefined } as any,
  );

  const result = await service.getOrCreate({
    dailyDutyId: 'duty-id',
    companyId: 'company-id',
    date: '2026-08-20',
    plannedFlightsCount: 2,
  }, currentUser);
  assert.equal(result.created, true);
  assert.deepEqual(activeLookupWhere.status, { not: DailyCompanySessionStatus.CANCELLED });

  await service.changeStatus(
    cancelled.id,
    DailyCompanySessionStatus.CANCELLED,
    currentUser,
  );
  assert.equal(deleteCalled, false, 'cancelling a session must never delete its company');
  assert.equal(cancelled.status, DailyCompanySessionStatus.CANCELLED,
    'the historical cancelled session remains available');
}

async function cancelledFlightCanBeRecreated() {
  let duplicateWhere: any;
  const session = {
    id: 'session-id', companyId: 'company-id', movementCategoryId: 'category-id',
    dailyDutyId: 'duty-id', dailyDuty: { expiresAt: new Date('2026-08-21T00:00:00Z') },
  };
  const created = { id: 'replacement-flight' };
  const tx = {
    flight: { findUnique: async () => ({ id: 'flight-id', companyId: 'company-id' }) },
    dailySessionFlight: {
      findFirst: async ({ where }: any) => { duplicateWhere = where; return undefined; },
      create: async () => created,
    },
  };
  const prisma = {
    $transaction: async (callback: any) => callback(tx),
    dailySessionFlight: { findUnique: async () => null },
  } as any;
  const service = new SessionFlightsService(
    prisma,
    { assertCanModifySession: async () => session } as any,
    { record: async () => undefined } as any,
  );
  await service.add('session-id', {
    flightId: 'flight-id',
    checkInStartsAt: '2026-08-20T10:00:00Z',
    checkInEndsAt: '2026-08-20T11:00:00Z',
  } as any, currentUser);
  assert.deepEqual(duplicateWhere.status, { not: DailySessionFlightStatus.CANCELLED });
}

async function run() {
  await plannedCountMustBePositive();
  await cancelledSessionIsRecreatedAndPreserved();
  await cancelledFlightCanBeRecreated();
  console.log('Cancelled recreation regression tests passed');
}

void run();
