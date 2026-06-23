import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { sanitizeUser } from '../common/utils/sanitize-user';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { RolesPermissionsService } from '../roles-permissions/roles-permissions.service';
import { CreateUserDto, UpdatePermissionsDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RolesPermissionsService,
    private readonly audit: AuditService,
  ) {}

  private validateCompanyRule(role: Role, companyId?: string | null) {
    if (role === Role.COMPANY_USER && !companyId) throw new BadRequestException('COMPANY_USER must belong to a company');
  }

  async create(dto: CreateUserDto, actor: AuthUser) {
    this.validateCompanyRule(dto.role, dto.companyId);
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (exists) throw new ConflictException('Email already exists');
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash: await bcrypt.hash(dto.password, 12),
        fullName: dto.fullName,
        role: dto.role,
        companyId: dto.companyId,
      },
    });
    await this.audit.record({ user: actor, action: 'CREATE_USER', entityType: 'User', entityId: user.id });
    return sanitizeUser(user);
  }

  async list(query: PaginationDto & { role?: Role; companyId?: string }) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.UserWhereInput = {
      role: query.role,
      companyId: query.companyId,
      OR: query.search ? [{ email: { contains: query.search, mode: 'insensitive' } }, { fullName: { contains: query.search, mode: 'insensitive' } }] : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { permissions: { include: { permission: true } }, company: true } }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(sanitizeUser), meta: { total, page, limit } };
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { permissions: { include: { permission: true } }, company: true } });
    if (!user) throw new NotFoundException('User not found');
    return sanitizeUser(user);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User not found');
    this.validateCompanyRule(dto.role ?? existing.role, dto.companyId ?? existing.companyId);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        email: dto.email?.toLowerCase(),
        fullName: dto.fullName,
        role: dto.role,
        companyId: dto.companyId,
        isActive: dto.isActive,
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 12) : undefined,
      },
    });
    await this.audit.record({ user: actor, action: 'UPDATE_USER', entityType: 'User', entityId: id });
    return sanitizeUser(user);
  }

  activate(id: string, actor: AuthUser) {
    return this.update(id, { isActive: true }, actor);
  }

  deactivate(id: string, actor: AuthUser) {
    return this.update(id, { isActive: false }, actor);
  }

  async updatePermissions(id: string, dto: UpdatePermissionsDto, actor: AuthUser) {
    const user = await this.rbac.setAdminPermissions(id, dto.permissions);
    await this.audit.record({
      user: actor,
      permissionUsed: 'ASSIGN_ADMIN_PERMISSIONS',
      action: 'UPDATE_USER_PERMISSIONS',
      entityType: 'User',
      entityId: id,
      metadata: { permissions: dto.permissions },
    });
    return sanitizeUser(user);
  }
}
