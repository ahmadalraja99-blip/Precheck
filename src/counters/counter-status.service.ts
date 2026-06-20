import { ConflictException, Injectable } from '@nestjs/common';
import { CounterStatus, NotificationType, PrismaClient, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class CounterStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async assertAvailable(counterIds: string[], tx: Tx = this.prisma) {
    const counters = await tx.counter.findMany({ where: { id: { in: counterIds } } });
    const unavailable = counters.filter((counter) => counter.status !== CounterStatus.AVAILABLE);
    if (counters.length !== counterIds.length || unavailable.length) {
      throw new ConflictException('Only AVAILABLE counters can be assigned');
    }
  }

  async transitionMany(counterIds: string[], status: CounterStatus, actor?: AuthUser, note?: string, tx: Tx = this.prisma) {
    await tx.counter.updateMany({ where: { id: { in: counterIds } }, data: { status } });
    await this.audit.record({
      user: actor,
      action: 'CHANGE_COUNTER_STATUS',
      entityType: 'Counter',
      result: 'SUCCESS',
      note: note ?? `Counters changed to ${status}`,
      metadata: { counterIds, status },
    });
    if (([CounterStatus.UNAVAILABLE, CounterStatus.AVAILABLE] as CounterStatus[]).includes(status)) {
      await this.notifications.create({
        title: status === CounterStatus.AVAILABLE ? 'Counter became available' : 'Counter became unavailable',
        message: `${counterIds.length} counter(s) changed to ${status}`,
        type: status === CounterStatus.AVAILABLE ? NotificationType.COUNTER_AVAILABLE : NotificationType.COUNTER_UNAVAILABLE,
        targetRole: Role.MOVEMENT_SUPERVISOR,
      });
    }
  }
}
