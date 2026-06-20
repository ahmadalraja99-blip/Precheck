import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma, Role } from '@prisma/client';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(input: {
    title: string;
    message: string;
    type: NotificationType;
    targetRole?: Role;
    targetUserId?: string;
    targetCompanyId?: string;
    entityType?: string;
    entityId?: string;
  }) {
    const notification = await this.prisma.notification.create({ data: input });
    this.gateway.emitNotification(notification);
    return notification;
  }

  async listForUser(user: AuthUser, query: PaginationDto) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.NotificationWhereInput = {
      OR: [
        { targetUserId: user.id },
        { targetRole: user.role },
        user.companyId ? { targetCompanyId: user.companyId } : {},
        { targetUserId: null, targetRole: null, targetCompanyId: null },
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  markRead(id: string, user: AuthUser) {
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  markAllRead(user: AuthUser) {
    return this.prisma.notification.updateMany({
      where: { OR: [{ targetUserId: user.id }, { targetRole: user.role }, { targetCompanyId: user.companyId ?? undefined }] },
      data: { readAt: new Date() },
    });
  }
}
