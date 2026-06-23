import { Injectable, NotFoundException } from '@nestjs/common';
import { CounterStatus, IssueStatus, NotificationType, Prisma, Role, SessionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { CounterStatusService } from '../counters/counter-status.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateIssueDto, ResolveIssueDto } from './dto/issue.dto';

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counterStatus: CounterStatusService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(dto: CreateIssueDto, user: AuthUser) {
    const issue = await this.prisma.issue.create({ data: { ...dto, createdById: user.id } });
    await this.audit.record({ user, action: 'CREATE_ISSUE', entityType: 'Issue', entityId: issue.id });
    await this.notifications.create({
      title: 'Issue created',
      message: issue.title,
      type: dto.type === 'PRECHECK' ? NotificationType.PRECHECK_ISSUE_CREATED : NotificationType.COUNTER_UNAVAILABLE,
      targetRole: Role.ADMIN,
      entityType: 'Issue',
      entityId: issue.id,
    });
    return issue;
  }

  async list(query: PaginationDto & { status?: IssueStatus; sessionId?: string; counterId?: string }) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.IssueWhereInput = {
      status: query.status,
      sessionId: query.sessionId,
      counterId: query.counterId,
      OR: query.search ? [{ title: { contains: query.search, mode: 'insensitive' } }, { description: { contains: query.search, mode: 'insensitive' } }] : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.issue.findMany({ where, include: { session: true, counter: true, device: true, checkItem: true }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.issue.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id }, include: { session: true, counter: true, device: true, checkItem: true } });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  async setInProgress(id: string, user: AuthUser, note?: string) {
    await this.find(id);
    const issue = await this.prisma.issue.update({ where: { id }, data: { status: IssueStatus.IN_PROGRESS, resolutionNote: note } });
    await this.audit.record({ user, action: 'ASSIGN_ISSUE', entityType: 'Issue', entityId: id, note });
    return issue;
  }

  async resolve(id: string, dto: ResolveIssueDto, user: AuthUser) {
    const issue = await this.find(id);
    const resolved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.issue.update({
        where: { id },
        data: { status: IssueStatus.RESOLVED, resolutionNote: dto.resolutionNote, resolvedById: user.id, resolvedAt: new Date() },
      });
      if (issue.counterId) {
        const openCount = await tx.issue.count({
          where: { counterId: issue.counterId, status: { in: [IssueStatus.OPEN, IssueStatus.IN_PROGRESS] } },
        });
        const activeSessionCounter = await tx.sessionCounter.findFirst({
          where: {
            counterId: issue.counterId,
            session: {
              status: {
                in: [
                  SessionStatus.SCHEDULED,
                  SessionStatus.PRECHECK_IN_PROGRESS,
                  SessionStatus.PRECHECK_BLOCKED,
                  SessionStatus.OPERATING,
                  SessionStatus.OUTCHECK_IN_PROGRESS,
                  SessionStatus.OUTCHECK_PENDING_APPROVAL,
                ],
              },
            },
          },
        });
        if (openCount === 0 && !activeSessionCounter) {
          await this.counterStatus.transitionMany([issue.counterId], CounterStatus.AVAILABLE, user, 'Issue resolved', tx);
        }
      }
      return updated;
    });
    await this.audit.record({ user, action: 'RESOLVE_ISSUE', entityType: 'Issue', entityId: id });
    await this.notifications.create({
      title: 'Issue resolved',
      message: resolved.title,
      type: NotificationType.ISSUE_RESOLVED,
      targetRole: Role.MOVEMENT_SUPERVISOR,
      entityType: 'Issue',
      entityId: id,
    });
    return resolved;
  }

  async close(id: string, user: AuthUser) {
    await this.find(id);
    const issue = await this.prisma.issue.update({ where: { id }, data: { status: IssueStatus.CLOSED } });
    await this.audit.record({ user, action: 'CLOSE_ISSUE', entityType: 'Issue', entityId: id });
    return issue;
  }
}
