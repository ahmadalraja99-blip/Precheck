import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { CheckResultValue, CounterStatus, NotificationType, Role, SessionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user.type';
import { CounterStatusService } from '../counters/counter-status.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { SubmitPreCheckDto } from '../precheck/dto/precheck.dto';

@Injectable()
export class OutcheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly counterStatus: CounterStatusService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async start(sessionId: string, user: AuthUser) {
    const session = await this.sessions.find(sessionId, user);
    if (user.role !== Role.COMPANY_USER) throw new ForbiddenException('Only company users can start OutCheck');
    if (session.status !== SessionStatus.OPERATING) throw new BadRequestException('OutCheck requires OPERATING session');
    const outCheck = await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: sessionId }, data: { status: SessionStatus.OUTCHECK_IN_PROGRESS, actualOutCheckStartAt: new Date() } });
      return tx.outCheck.create({ data: { sessionId } });
    });
    await this.audit.record({ user, action: 'START_OUTCHECK', entityType: 'Session', entityId: sessionId });
    return outCheck;
  }

  async submit(sessionId: string, dto: SubmitPreCheckDto, user: AuthUser) {
    const session = await this.sessions.find(sessionId, user);
    if (user.role !== Role.COMPANY_USER) throw new ForbiddenException('Only company users can submit OutCheck');
    if (session.status !== SessionStatus.OUTCHECK_IN_PROGRESS) throw new BadRequestException('OutCheck is not in progress');
    const checkItems = await this.prisma.checkItem.findMany({ where: { id: { in: dto.results.map((r) => r.checkItemId) }, isActive: true } });
    const itemMap = new Map(checkItems.map((item) => [item.id, item]));
    for (const result of dto.results) {
      const item = itemMap.get(result.checkItemId);
      if (!item) throw new BadRequestException(`Invalid check item ${result.checkItemId}`);
      if (item.isRequired && result.value === CheckResultValue.N_A) throw new BadRequestException(`Required item ${item.name} cannot be N_A`);
    }
    const counterIds = session.counters.map((row) => row.counterId);
    const results = await this.prisma.$transaction(async (tx) => {
      const outCheck = (await tx.outCheck.findFirst({ where: { sessionId }, orderBy: { createdAt: 'desc' } })) ?? (await tx.outCheck.create({ data: { sessionId } }));
      const created: unknown[] = [];
      for (const result of dto.results) {
        created.push(await tx.outCheckItemResult.create({ data: { ...result, outCheckId: outCheck.id } }));
      }
      await tx.outCheck.update({ where: { id: outCheck.id }, data: { signedById: user.id, signedAt: new Date() } });
      await tx.session.update({ where: { id: sessionId }, data: { status: SessionStatus.OUTCHECK_PENDING_APPROVAL } });
      await this.counterStatus.transitionMany(counterIds, CounterStatus.PENDING_OUTCHECK_APPROVAL, user, 'OutCheck submitted', tx);
      return created;
    });
    await this.audit.record({ user, action: 'SUBMIT_OUTCHECK', entityType: 'Session', entityId: sessionId });
    await this.notifications.create({ title: 'OutCheck submitted', message: 'OutCheck is pending approval', type: NotificationType.OUTCHECK_SUBMITTED, targetRole: Role.ADMIN, entityType: 'Session', entityId: sessionId });
    return { status: SessionStatus.OUTCHECK_PENDING_APPROVAL, results };
  }

  get(sessionId: string, user: AuthUser) {
    return this.sessions.find(sessionId, user).then((session) => session.outChecks);
  }
}
