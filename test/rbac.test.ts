import * as assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PermissionCode, Role } from '@prisma/client';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { NotificationsService } from '../src/notifications/notifications.service';
import { DailyFlightOperationalIssuesService } from '../src/session-flights/operational-issues/daily-flight-operational-issues.service';

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

async function run() {
  permissionGuardTests();
  await notificationScopeTests();
  await operationalIssueScopeTests();
  console.log('RBAC regression tests passed');
}
void run();
