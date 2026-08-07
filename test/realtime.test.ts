import * as assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { NotificationsGateway, REALTIME_EVENTS } from '../src/notifications/notifications.gateway';
import { NotificationsService } from '../src/notifications/notifications.service';

function socket(token?: string) {
  const joined: string[] = []; const emitted: Array<[string, unknown]> = [];
  return { handshake: { auth: token ? { token } : {}, headers: {} }, data: {}, active: true,
    join: async (rooms: string[]) => joined.push(...rooms), emit: (event: string, payload: unknown) => emitted.push([event, payload]),
    disconnect: function () { this.disconnected = true; }, disconnected: false, joined, emitted } as any;
}

function gatewayFor(user: any, options?: { assignments?: string[]; duties?: string[] }) {
  return new NotificationsGateway({ verifyAsync: async () => ({ sub: user?.id ?? 'missing' }) } as any,
    { get: () => 'secret' } as any, { user: { findUnique: async () => user },
      movementCategoryAssignment: { findMany: async () => (options?.assignments ?? []).map((movementCategoryId) => ({ movementCategoryId })) },
      dailyDuty: { findMany: async () => (options?.duties ?? []).map((id) => ({ id })) } } as any,
    { getUserPermissionCodes: async () => [] } as any);
}

async function authenticationAndRoomTests() {
  const missing = socket(); await gatewayFor(null).handleConnection(missing); assert.equal(missing.disconnected, true);
  const inactive = socket('token'); await gatewayFor({ id: 'inactive', isActive: false, role: Role.ADMIN }).handleConnection(inactive);
  assert.equal(inactive.disconnected, true);
  const inactiveCompany = socket('token'); await gatewayFor({ id: 'rb', isActive: true, role: Role.COMPANY_USER,
    companyId: 'rb-company', company: { isActive: false } }).handleConnection(inactiveCompany);
  assert.equal(inactiveCompany.disconnected, true);
  const rb = socket('token'); await gatewayFor({ id: 'rb-user', isActive: true, role: Role.COMPANY_USER,
    companyId: 'rb-company', company: { isActive: true } }).handleConnection(rb);
  assert.ok(rb.joined.includes('company:rb-company')); assert.ok(!rb.joined.includes('company:xh-company'));
  assert.ok(!rb.joined.includes('admins'));
  const movement = socket('token'); await gatewayFor({ id: 'movement-a', isActive: true, role: Role.MOVEMENT_SUPERVISOR,
    companyId: null }, { assignments: ['category-a'], duties: ['duty-a'] }).handleConnection(movement);
  assert.ok(movement.joined.includes('duty:duty-a')); assert.ok(!movement.joined.includes('duty:duty-b'));
  const admin = socket('token'); await gatewayFor({ id: 'admin', isActive: true, role: Role.ADMIN, companyId: null }).handleConnection(admin);
  assert.ok(admin.joined.includes('admins'));
}

function scopeAndPayloadTests() {
  const gateway = gatewayFor(null); const deliveries: Array<{ room: string; event: string; payload: any }> = [];
  (gateway as any).server = { to: (rooms: string | string[]) => ({ emit: (event: string, payload: any) =>
    deliveries.push({ room: Array.isArray(rooms) ? rooms.join(',') : rooms, event, payload }) }) };
  gateway.emitScoped(REALTIME_EVENTS.FLIGHT_UPDATED, { resourceId: 'xh-flight', companyId: 'xh-company',
    status: 'OPERATING', updatedAt: new Date().toISOString() }, { companyId: 'xh-company' });
  assert.deepEqual(deliveries.map(({ room }) => room), ['company:xh-company']);
  assert.ok(!JSON.stringify(deliveries).match(/password|jwt|filePath|lockedBy|smtp/i));
  gateway.emitScoped(REALTIME_EVENTS.COUNTER_STATUS_CHANGED, { resourceId: 'counter', status: 'UNAVAILABLE',
    updatedAt: new Date().toISOString() }, { role: Role.MOVEMENT_SUPERVISOR, admins: true });
  assert.equal(deliveries.filter(({ event }) => event === REALTIME_EVENTS.COUNTER_STATUS_CHANGED).length, 1,
    'one union broadcast prevents duplicate delivery to users in multiple target rooms');
}

async function notificationCommitAndOwnershipTests() {
  const order: string[] = []; let scope: any;
  const persisted = { id: 'notification', type: 'OUTCHECK_REJECTED', title: 'Rejected', message: 'Correct and resubmit',
    targetCompanyId: 'rb-company', targetUserId: null, targetRole: null, entityType: 'DailySessionFlight', entityId: 'flight',
    createdAt: new Date(), readAt: null };
  const prisma = { notification: { create: async () => { order.push('persist'); return persisted; },
    findFirst: async () => persisted, update: async () => ({ ...persisted, readAt: new Date() }) } } as any;
  const gateway = { emitNotification: () => order.push('emit'), emitScoped: (_event: string, _payload: unknown, target: unknown) => { scope = target; } } as any;
  const service = new NotificationsService(prisma, gateway);
  await service.create({ title: persisted.title, message: persisted.message, type: 'OUTCHECK_REJECTED' as any,
    targetCompanyId: 'rb-company' });
  assert.deepEqual(order, ['persist', 'emit'], 'notification is emitted only after persistence');
  await service.markRead('notification', { id: 'rb-user', role: Role.COMPANY_USER, companyId: 'rb-company' } as any);
  assert.deepEqual(scope, { userId: 'rb-user' });
}

async function run() {
  await authenticationAndRoomTests(); scopeAndPayloadTests(); await notificationCommitAndOwnershipTests();
  console.log('realtime tests passed');
}
void run();
