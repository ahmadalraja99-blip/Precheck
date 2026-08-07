import { ConflictException, Injectable } from '@nestjs/common';
import { CounterStatus, NotificationType, PrismaClient, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway, REALTIME_EVENTS } from '../notifications/notifications.gateway';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class CounterStatusService {
  private readonly allowedTransitions: Record<CounterStatus, CounterStatus[]> = {
    AVAILABLE: [CounterStatus.RESERVED, CounterStatus.UNAVAILABLE, CounterStatus.OUT_OF_SERVICE],
    RESERVED: [CounterStatus.IN_USE, CounterStatus.AVAILABLE, CounterStatus.UNAVAILABLE, CounterStatus.OUT_OF_SERVICE],
    IN_USE: [CounterStatus.PENDING_OUTCHECK_APPROVAL, CounterStatus.UNAVAILABLE, CounterStatus.OUT_OF_SERVICE],
    PENDING_OUTCHECK_APPROVAL: [CounterStatus.AVAILABLE, CounterStatus.UNAVAILABLE, CounterStatus.OUT_OF_SERVICE],
    UNAVAILABLE: [CounterStatus.AVAILABLE, CounterStatus.OUT_OF_SERVICE],
    OUT_OF_SERVICE: [CounterStatus.AVAILABLE, CounterStatus.UNAVAILABLE],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: NotificationsGateway,
  ) {}

  async assertAvailable(counterIds: string[], tx: Tx = this.prisma) {
    const counters = await tx.counter.findMany({ where: { id: { in: counterIds } } });
    const unavailable = counters.filter((counter) => !counter.isActive || counter.status !== CounterStatus.AVAILABLE);
    if (counters.length !== counterIds.length || unavailable.length) {
      throw new ConflictException('Only AVAILABLE counters can be assigned');
    }
  }

  async transitionMany(counterIds: string[], status: CounterStatus, actor?: AuthUser, note?: string, tx: Tx = this.prisma) {
    const uniqueCounterIds = [...new Set(counterIds)];
    if (!uniqueCounterIds.length) return;

    const counters = await tx.counter.findMany({ where: { id: { in: uniqueCounterIds } } });
    if (counters.length !== uniqueCounterIds.length) throw new ConflictException('One or more counters were not found');

    const invalid = counters.find((counter) => counter.status !== status && !this.allowedTransitions[counter.status].includes(status));
    if (invalid) {
      throw new ConflictException(`Invalid counter status transition from ${invalid.status} to ${status}`);
    }

    await tx.counter.updateMany({ where: { id: { in: uniqueCounterIds } }, data: { status } });
    const history = counters.filter(({ status: previous }) => previous !== status).map((counter) => ({
      counterId: counter.id, fromStatus: counter.status, toStatus: status, reason: note?.trim() || null, changedById: actor?.id,
    }));
    if (history.length) await tx.counterStatusHistory.createMany({ data: history });
    await this.audit.record({
      user: actor,
      action: 'CHANGE_COUNTER_STATUS',
      entityType: 'Counter',
      result: 'SUCCESS',
      note: note ?? `Counters changed to ${status}`,
      metadata: { counterIds: uniqueCounterIds, status },
    }, tx);
  }

  async publishCommitted(counterIds: string[], status: CounterStatus) {
    this.realtime.emitScoped(REALTIME_EVENTS.COUNTER_STATUS_CHANGED, { resourceId: counterIds[0] ?? 'counter-batch',
      status, updatedAt: new Date().toISOString(), display: { counterCount: counterIds.length } },
    { role: Role.MOVEMENT_SUPERVISOR, admins: true });
    if (([CounterStatus.UNAVAILABLE, CounterStatus.AVAILABLE] as CounterStatus[]).includes(status)) {
      await this.notifications.create({
        title: status === CounterStatus.AVAILABLE ? 'Counter became available' : 'Counter became unavailable',
        message: `${new Set(counterIds).size} counter(s) changed to ${status}`,
        type: status === CounterStatus.AVAILABLE ? NotificationType.COUNTER_AVAILABLE : NotificationType.COUNTER_UNAVAILABLE,
        targetRole: Role.MOVEMENT_SUPERVISOR,
      });
    }
  }
}
