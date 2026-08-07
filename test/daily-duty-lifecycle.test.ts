import * as assert from 'node:assert/strict';
import { DailySessionFlightStatus, HandoverStatus, Role } from '@prisma/client';
import { DailyDutiesService } from '../src/daily-duties/daily-duties.service';
import { DutyExpirationService } from '../src/operations/duty-expiration.service';

async function run() {
  const actor:any={id:'supervisor-1',role:Role.ADMIN,permissions:[],companyId:null}; let creates=0;
  let stored:any; const dutyPrisma:any={ movementCategory:{findUnique:async()=>({id:'cat-1',isActive:true})}, dailyDuty:{
    findFirst:async()=>null, create:async({data}:any)=>{creates++;stored={id:'duty-1',...data};return stored;},
    findUnique:async()=>stored,
  }, $transaction:async(fn:any)=>fn(dutyPrisma) };
  const duties=new DailyDutiesService(dutyPrisma,{expireDueDuties:async()=>({expired:0})} as any,{} as any,{record:async()=>{}} as any);
  const activated:any=await duties.activate({movementCategoryId:'cat-1'},actor);
  assert.equal(activated.expiresAt.getTime()-activated.activatedAt.getTime(),24*60*60*1000); assert.equal(creates,1);

  let flightUpdate:any; let reservationUpdate:any; let sessionCarry=0;
  const tx:any={dailySessionFlight:{findMany:async({select}:any)=>select.id&&Object.keys(select).length===1?[{id:'flight-1'}]:[{id:'flight-1',status:DailySessionFlightStatus.OPERATION}],
    update:async({data}:any)=>{flightUpdate=data;}},counterReservation:{updateMany:async({data}:any)=>{reservationUpdate=data;}},
    dailyCompanySession:{updateMany:async({data}:any)=>{if(data.status==='CARRY_OVER')sessionCarry++;return{count:1};}},
    notification:{create:async()=>({})},$queryRaw:async()=>[{id:'flight-1'}]};
  const expiration=new DutyExpirationService({} as any,{record:async()=>{}} as any);
  await (expiration as any).markCarryOverTx(tx,'duty-1',new Date('2026-01-02T00:00:00Z'),'expired');
  assert.equal(flightUpdate.status,undefined); assert.equal(flightUpdate.carryOverStatusSnapshot,DailySessionFlightStatus.OPERATION);
  assert.equal(flightUpdate.handoverStatus,HandoverStatus.PENDING); assert.equal(reservationUpdate.isCarryOver,true); assert.equal(sessionCarry,1);
  console.log('daily duty lifecycle tests passed: exact 24h activation, carry-over preserves workflow status/reservations, pending handover');
}
void run();
