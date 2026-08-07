import * as assert from 'node:assert/strict';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CounterStatus, IssueStatus, PermissionCode, Role } from '@prisma/client';
import { DailyFlightOperationalIssuesService } from '../src/session-flights/operational-issues/daily-flight-operational-issues.service';

async function run() {
  let status: IssueStatus = IssueStatus.OPEN; let counterStatus = CounterStatus.UNAVAILABLE; let auditCount = 0;
  const issue = { id: 'issue-1', dailySessionFlightId: 'flight-1', counterId: 'counter-1', status };
  const tx: any = { $queryRaw: async()=>[], dailyFlightOperationalIssue: {
    findUnique: async()=>({ ...issue, status }), update: async({data}:any)=>{status=data.status;return {...issue,...data};},
    count: async()=>0 }, counter: { updateMany: async({data}:any)=>{counterStatus=data.status;return {count:1};} } };
  const prisma:any = { $transaction: async(fn:any)=>fn(tx) };
  const service = new DailyFlightOperationalIssuesService(prisma, {record:async()=>{auditCount+=1;}} as any);
  const unauthorized:any={id:'company',role:Role.COMPANY_USER,permissions:[]};
  await assert.rejects(()=>service.resolve('issue-1',{resolutionNote:'Printer repaired'},unauthorized), ForbiddenException);
  const admin:any={id:'admin',role:Role.ADMIN,permissions:[PermissionCode.CAN_RESOLVE_ISSUES]};
  const resolved=await service.resolve('issue-1',{resolutionNote:'Printer repaired',verificationNote:'Test passed'},admin);
  assert.equal(resolved.status,IssueStatus.RESOLVED); assert.equal(counterStatus,CounterStatus.AVAILABLE); assert.equal(auditCount,1);
  await assert.rejects(()=>service.resolve('issue-1',{resolutionNote:'Again'},admin),ConflictException);
  assert.equal(auditCount,1);
  console.log('outcheck failure workflow tests passed: authorization, durable resolution, counter restore, double-resolution protection');
}
void run();
