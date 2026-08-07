import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { CounterStatus, DeviceStatus, Prisma, Role } from '@prisma/client';
import { CounterStatusService } from '../src/counters/counter-status.service';
import { CountersService } from '../src/counters/counters.service';
import { DevicesService } from '../src/devices/devices.service';
import { CheckItemsService } from '../src/check-items/check-items.service';

const superAdmin = { id: 'super-id', email: 'super@example.com', fullName: 'Super', role: Role.SUPER_ADMIN,
  companyId: null, permissions: [] } as any;

async function reservationEligibilityTests() {
  for (const counter of [
    { id: 'inactive', isActive: false, status: CounterStatus.AVAILABLE },
    { id: 'unavailable', isActive: true, status: CounterStatus.UNAVAILABLE },
    { id: 'out', isActive: true, status: CounterStatus.OUT_OF_SERVICE },
  ]) {
    const service = new CounterStatusService({ counter: { findMany: async () => [counter] } } as any, {} as any, {} as any);
    await assert.rejects(service.assertAvailable([counter.id]), ConflictException);
  }
}

async function duplicateCounterTest() {
  const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' });
  const service = new CountersService({ counter: { create: async () => { throw duplicate; } } } as any, {} as any, {} as any);
  await assert.rejects(service.create({ code: 'C01', name: 'Counter 1' }, superAdmin), ConflictException);
}

async function inactiveDeviceAssignmentTest() {
  const tx = { counter: { findUnique: async () => ({ id: 'counter', isActive: false }) } };
  const prisma = { $transaction: async (callback: any) => callback(tx) } as any;
  const service = new DevicesService(prisma, {} as any);
  await assert.rejects(service.create({ counterId: '00000000-0000-4000-8000-000000000001', name: 'Scanner', type: 'SCANNER' }, superAdmin), ConflictException);
}

async function duplicateDeviceIdentifierTest() {
  const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' });
  const tx = { counter: { findUnique: async () => ({ id: 'counter', isActive: true }) },
    device: { create: async () => { throw duplicate; } } };
  const service = new DevicesService({ $transaction: async (callback: any) => callback(tx) } as any, {} as any);
  await assert.rejects(service.create({ counterId: '00000000-0000-4000-8000-000000000001', name: 'Scanner', type: 'SCANNER', assetTag: 'A-1' }, superAdmin), ConflictException);
}

async function checkItemAuditAndLockTest() {
  let locked = false; let auditAction = '';
  const existing = { id: 'item', name: 'Old', description: null, category: 'DEVICE', order: 1,
    isRequired: true, allowsNotApplicable: false, isActive: true };
  const tx = { $queryRaw: async () => { locked = true; return [{ id: 'item' }]; },
    checkItem: { findUnique: async () => existing, update: async ({ data }: any) => ({ ...existing, ...data }) } };
  const service = new CheckItemsService({ $transaction: async (callback: any) => callback(tx) } as any,
    { record: async ({ action }: any) => { auditAction = action; } } as any);
  const updated = await service.update('item', { name: 'New', isActive: false }, superAdmin);
  assert.equal(locked, true, 'concurrent updates lock the configuration row');
  assert.equal(updated.name, 'New');
  assert.equal(auditAction, 'DEACTIVATE_CHECK_ITEM');
  assert.equal(existing.name, 'Old', 'configuration updates do not rewrite prior snapshot data');
}

async function run() {
  await reservationEligibilityTests();
  await duplicateCounterTest();
  await inactiveDeviceAssignmentTest();
  await duplicateDeviceIdentifierTest();
  await checkItemAuditAndLockTest();
  assert.equal(DeviceStatus.INACTIVE, 'INACTIVE');
  console.log('configuration management tests passed');
}
void run();
