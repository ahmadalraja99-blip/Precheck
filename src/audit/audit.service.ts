import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/types/auth-user.type';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    user?: Partial<AuthUser> | null;
    permissionUsed?: string;
    action: string;
    entityType: string;
    entityId?: string;
    result?: string;
    note?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.auditLog.create({
      data: {
        userId: input.user?.id,
        fullName: input.user?.fullName,
        role: input.user?.role,
        companyId: input.user?.companyId ?? undefined,
        permissionUsed: input.permissionUsed,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        result: input.result ?? 'SUCCESS',
        note: input.note,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: input.metadata,
      },
    });
  }

  async list(query: PaginationDto & { action?: string; entityType?: string }) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.AuditLogWhereInput = {
      action: query.action,
      entityType: query.entityType,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }
}
