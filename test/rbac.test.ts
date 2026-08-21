import * as assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PermissionCode, Role } from '@prisma/client';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { NotificationsService } from '../src/notifications/notifications.service';
import { DailyFlightOperationalIssuesService } from '../src/session-flights/operational-issues/daily-flight-operational-issues.service';
import { OperationAccessService } from '../src/operations/operation-access.service';
import { DailyCompanySessionsService } from '../src/daily-company-sessions/daily-company-sessions.service';
import { DailyCompanySessionsController } from '../src/daily-company-sessions/daily-company-sessions.controller';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';

const user = (role: Role, permissions: PermissionCode[] = [], companyId?: string) =>
  ({ id: `${role}-id`, email: 'test@example.com', role, permissions, companyId } as any);

function permissionGuardTests() {
  const reflector = { getAllAndOverride: () => [PermissionCode.CAN_EXPORT_REPORTS] } as any;
  const guard = new PermissionsGuard(reflector);
  const context = (currentUser?: any) => ({ getHandler: () => ({}), getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user: currentUser }) }) }) as any;
  assert.equal(guard.canActivate(context()), false, 'unauthenticated users are denied');
  assert.equal(guard.canActivate(context(user(Role.SUPER_ADMIN))), true, 'Super Admin bypasses permission lookup');
  assert.equal(guard.canActivate(context(user(Role.ADMIN))), false, 'role names do not bypass permissions');
  assert.equal(guard.canActivate(context(user(Role.MOVEMENT_SUPERVISOR))), false, 'Movement Supervisor needs explicit permission');
  assert.equal(guard.canActivate(context(user(Role.COMPANY_USER, [PermissionCode.CAN_EXPORT_REPORTS], 'rb'))), true,
    'explicit permission is honored independently of role');
}

async function notificationScopeTests() {
  let capturedWhere: any;
  const prisma = { notification: {
    findFirst: async ({ where }: any) => { capturedWhere = where; return null; },
    update: async () => { throw new Error('must not update'); },
  } } as any;
  const service = new NotificationsService(prisma, { emitNotification: () => undefined } as any);
  await assert.rejects(service.markRead('guessed-id', user(Role.COMPANY_USER, [], 'rb')), NotFoundException);
  assert.ok(capturedWhere.OR.some((entry: any) => entry.targetCompanyId === 'rb'));
  assert.ok(!capturedWhere.OR.some((entry: any) => Object.keys(entry).length === 0), 'scope must never contain a global wildcard');
}

async function operationalIssueScopeTests() {
  const flight = { companyId: 'xh', isCarryOver: false, handoverStatus: 'NONE', carriedToDailyDutyId: null,
    dailyCompanySession: { dailyDuty: { movementSupervisorId: 'supervisor-b' } } };
  const prisma = { dailySessionFlight: { findUnique: async () => flight }, dailyDuty: { findFirst: async () => null },
    dailyFlightOperationalIssue: { findMany: async () => [] } } as any;
  const service = new DailyFlightOperationalIssuesService(prisma, {} as any);
  await assert.rejects(service.listForFlight('xh-flight', user(Role.COMPANY_USER, [], 'rb')), ForbiddenException);
  await assert.rejects(service.listForFlight('other-duty-flight',
    { ...user(Role.MOVEMENT_SUPERVISOR), id: 'supervisor-a' }), ForbiddenException);
}

function dailyCompanySessionRouteRoleTests() {
  const createRoles = Reflect.getMetadata(
    ROLES_KEY,
    DailyCompanySessionsController.prototype.create,
  ) as Role[];
  const getOrCreateRoles = Reflect.getMetadata(
    ROLES_KEY,
    DailyCompanySessionsController.prototype.getOrCreate,
  ) as Role[];
  const expected = [Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN];
  assert.deepEqual(createRoles, expected);
  assert.deepEqual(getOrCreateRoles, expected);
  assert.equal(createRoles.includes(Role.COMPANY_USER), false);
}

async function companyDutyBootstrapTests() {
  let capturedQuery: any;
  const activeDuty = { id: 'duty-cat-a', status: 'OPEN' };
  const prisma = { dailyDuty: { findFirst: async (query: any) => { capturedQuery = query; return activeDuty; } } } as any;
  const access = new OperationAccessService(prisma, { expireDueDuties: async () => ({ expired: 0 }) } as any);

  const result = await access.activeDutyForUser(user(Role.COMPANY_USER, [], 'e2e-company'));
  assert.equal(result, activeDuty, 'company users can discover the global active duty before creating a session');
  assert.deepEqual(capturedQuery.where.status, 'OPEN');
  assert.ok(capturedQuery.where.expiresAt.gt instanceof Date);
  assert.equal(capturedQuery.where.dailyCompanySessions, undefined,
    'active duty lookup must not depend on an existing company session');
  assert.equal(capturedQuery.include.dailyCompanySessions, undefined,
    'active duty payload must not expose any company sessions or operational children');
}

async function companySessionBootstrapScopeTests() {
  const access = {
    assertCompanyScope: (companyId: string, currentUser: any) => {
      if (companyId !== currentUser.companyId) throw new ForbiddenException('Resource belongs to another company');
    },
    assertActiveDuty: async () => ({ id: 'duty-cat-a', movementCategoryId: 'cat-a' }),
  } as any;
  const prisma = { company: { findUnique: async () => ({ id: 'e2e-company', isActive: true }) } } as any;
  const service = new DailyCompanySessionsService(prisma, access, { record: async () => undefined } as any);

  await assert.rejects(service.create({ dailyDutyId: 'duty-cat-a', companyId: 'other-company',
    date: '2026-08-20', plannedFlightsCount: 1 } as any, user(Role.COMPANY_USER, [], 'e2e-company')),
  ForbiddenException);
  await assert.rejects(service.getOrCreate({ dailyDutyId: 'duty-cat-a', companyId: 'other-company',
    date: '2026-08-20', plannedFlightsCount: 1 } as any, user(Role.COMPANY_USER, [], 'e2e-company')),
  ForbiddenException);
}

async function run() {
  permissionGuardTests();
  dailyCompanySessionRouteRoleTests();
  await notificationScopeTests();
  await operationalIssueScopeTests();
  await companyDutyBootstrapTests();
  await companySessionBootstrapScopeTests();
  console.log('RBAC regression tests passed');
}
void run();
