import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { CheckResultValue, CounterStatus, IssueSeverity, IssueType, NotificationType, Role, SessionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user.type';
import { CounterStatusService } from '../counters/counter-status.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { SubmitPreCheckDto } from './dto/precheck.dto';

@Injectable()
export class PrecheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly counterStatus: CounterStatusService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private validateResultTargets(
    results: SubmitPreCheckDto['results'],
    sessionCounters: { counterId: string; counter: { devices: { id: string; counterId: string }[] } }[],
  ) {
    const counterIds = new Set(sessionCounters.map((row) => row.counterId));
    const deviceCounterIds = new Map<string, string>();
    for (const row of sessionCounters) {
      for (const device of row.counter.devices) {
        deviceCounterIds.set(device.id, device.counterId);
      }
    }

    for (const result of results) {
      if (!counterIds.has(result.counterId)) {
        throw new BadRequestException(`Counter ${result.counterId} is not assigned to this session`);
      }
      if (result.deviceId) {
        const deviceCounterId = deviceCounterIds.get(result.deviceId);
        if (!deviceCounterId) throw new BadRequestException(`Device ${result.deviceId} is not assigned to this session`);
        if (deviceCounterId !== result.counterId) throw new BadRequestException(`Device ${result.deviceId} is not linked to counter ${result.counterId}`);
      }
    }
  }

  async start(sessionId: string, user: AuthUser) {
    const session = await this.sessions.find(sessionId, user);
    if (!([Role.COMPANY_USER, Role.SUPER_ADMIN] as Role[]).includes(user.role)) throw new ForbiddenException('Only company users can start PreCheck');
    if (!([SessionStatus.SCHEDULED, SessionStatus.PRECHECK_BLOCKED] as SessionStatus[]).includes(session.status)) {
      throw new BadRequestException('PreCheck can only start from SCHEDULED or PRECHECK_BLOCKED');
    }
    const preCheck = await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: sessionId }, data: { status: SessionStatus.PRECHECK_IN_PROGRESS, actualPreCheckStartAt: new Date() } });
      return tx.preCheck.create({ data: { sessionId } });
    });
    await this.audit.record({ user, action: 'START_PRECHECK', entityType: 'Session', entityId: sessionId });
    await this.notifications.create({ title: 'PreCheck started', message: 'Company user started PreCheck', type: NotificationType.PRECHECK_STARTED, targetRole: Role.ADMIN, entityType: 'Session', entityId: sessionId });
    return preCheck;
  }

  async submit(sessionId: string, dto: SubmitPreCheckDto, user: AuthUser) {
    const session = await this.sessions.find(sessionId, user);
    if (!([Role.COMPANY_USER, Role.SUPER_ADMIN] as Role[]).includes(user.role)) throw new ForbiddenException('Only company users can submit PreCheck');
    if (session.status !== SessionStatus.PRECHECK_IN_PROGRESS) throw new BadRequestException('PreCheck is not in progress');
    const counterIds = session.counters.map((row) => row.counterId);
    this.validateResultTargets(dto.results, session.counters);
    const checkItems = await this.prisma.checkItem.findMany({ where: { id: { in: dto.results.map((r) => r.checkItemId) }, isActive: true } });
    const itemMap = new Map(checkItems.map((item) => [item.id, item]));
    for (const result of dto.results) {
      const item = itemMap.get(result.checkItemId);
      if (!item) throw new BadRequestException(`Invalid check item ${result.checkItemId}`);
      if (item.isRequired && result.value === CheckResultValue.N_A) throw new BadRequestException(`Required item ${item.name} cannot be N_A`);
    }
    const requiredIds = checkItems.filter((item) => item.isRequired).map((item) => item.id);
    for (const requiredId of requiredIds) {
      for (const counterId of counterIds) {
        if (!dto.results.some((r) => r.counterId === counterId && r.checkItemId === requiredId)) {
          throw new BadRequestException('All required check items must be submitted for each session counter');
        }
      }
    }
    const problemValues = [CheckResultValue.FAULTY, CheckResultValue.MISSING] as CheckResultValue[];
    const hasProblems = dto.results.some((r) => problemValues.includes(r.value));
    const issueIds: string[] = [];
    const saved = await this.prisma.$transaction(async (tx) => {
      const preCheck = await tx.preCheck.findFirst({ where: { sessionId }, orderBy: { createdAt: 'desc' } });
      const current = preCheck ?? (await tx.preCheck.create({ data: { sessionId } }));
      const createdResults: unknown[] = [];
      for (const result of dto.results) {
        let issueId: string | undefined;
        if (problemValues.includes(result.value)) {
          const issue = await tx.issue.create({
            data: {
              sessionId,
              counterId: result.counterId,
              deviceId: result.deviceId,
              checkItemId: result.checkItemId,
              type: IssueType.PRECHECK,
              severity: IssueSeverity.HIGH,
              title: `PreCheck ${result.value}`,
              description: result.note ?? `PreCheck item ${result.checkItemId} is ${result.value}`,
              createdById: user.id,
            },
          });
          issueId = issue.id;
          issueIds.push(issue.id);
        }
        createdResults.push(await tx.preCheckItemResult.create({ data: { ...result, preCheckId: current.id, issueId } }));
      }
      await tx.preCheck.update({ where: { id: current.id }, data: { signedById: user.id, signedAt: new Date() } });
      await tx.session.update({
        where: { id: sessionId },
        data: {
          status: hasProblems ? SessionStatus.PRECHECK_BLOCKED : SessionStatus.OPERATING,
          actualOperationStartAt: hasProblems ? undefined : new Date(),
        },
      });
      if (!hasProblems) await this.counterStatus.transitionMany(counterIds, CounterStatus.IN_USE, user, 'PreCheck clean', tx);
      return createdResults;
    });
    for (const issueId of issueIds) {
      await this.audit.record({ user, action: 'CREATE_ISSUE', entityType: 'Issue', entityId: issueId });
    }
    await this.audit.record({ user, action: 'SUBMIT_PRECHECK', entityType: 'Session', entityId: sessionId, metadata: { hasProblems } });
    await this.notifications.create({ title: 'PreCheck completed', message: hasProblems ? 'PreCheck blocked with issues' : 'PreCheck passed', type: hasProblems ? NotificationType.PRECHECK_ISSUE_CREATED : NotificationType.PRECHECK_COMPLETED, targetRole: Role.ADMIN, entityType: 'Session', entityId: sessionId });
    return { status: hasProblems ? SessionStatus.PRECHECK_BLOCKED : SessionStatus.OPERATING, results: saved };
  }

  get(sessionId: string, user: AuthUser) {
    return this.sessions.find(sessionId, user).then((session) => session.preChecks);
  }
}
