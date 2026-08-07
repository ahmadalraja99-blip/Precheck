import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { sanitizeUser } from '../common/utils/sanitize-user';
import { PrismaService } from '../prisma/prisma.service';
import { RolesPermissionsService } from '../roles-permissions/roles-permissions.service';
import { LoginDto, RefreshDto } from './dto/auth.dto';
import { OperationAccessService } from '../operations/operation-access.service';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly rbac: RolesPermissionsService,
    private readonly operationAccess: OperationAccessService,
  ) {}

  private async sign(userId: string, email: string) {
    const payload = { sub: userId, email };
    return {
      accessToken: await this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_ACCESS_EXPIRES_IN',
          '15m',
        ) as JwtSignOptions['expiresIn'],
      }),
      refreshToken: await this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
          '7d',
        ) as JwtSignOptions['expiresIn'],
      }),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() }, include: { company: true } });
    if (!user || !user.isActive || (user.role === Role.COMPANY_USER && !user.company?.isActive)) throw new UnauthorizedException('Invalid credentials');
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    const tokens = await this.sign(user.id, user.email);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), refreshTokenHash: await bcrypt.hash(tokens.refreshToken, 12) },
    });
    return { ...tokens, user: sanitizeUser(user) };
  }

  async refresh(dto: RefreshDto) {
    const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(dto.refreshToken, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
    });
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { company: true } });
    if (!user?.refreshTokenHash || !user.isActive || (user.role === Role.COMPANY_USER && !user.company?.isActive)) throw new UnauthorizedException('Invalid refresh token');
    const valid = await bcrypt.compare(dto.refreshToken, user.refreshTokenHash);
    if (!valid) throw new UnauthorizedException('Invalid refresh token');
    const tokens = await this.sign(user.id, user.email);
    await this.prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: await bcrypt.hash(tokens.refreshToken, 12) } });
    return { ...tokens, user: sanitizeUser(user) };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        company: true,
        movementCategoryAssignments: {
          where: { isActive: true, movementCategory: { isActive: true } },
          include: { movementCategory: true },
        },
      },
    });
    if (!user || !user.isActive || (user.role === Role.COMPANY_USER && !user.company?.isActive)) throw new UnauthorizedException('Inactive or missing user');
    const permissions = await this.rbac.getUserPermissionCodes(user.id, user.role);
    const safe = sanitizeUser(user);
    if (user.role !== Role.MOVEMENT_SUPERVISOR) return { ...safe, permissions };
    const activeDailyDuty = await this.operationAccess.activeDutyForUser({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      companyId: user.companyId,
      permissions,
    });
    const carryOverCount = await this.prisma.dailySessionFlight.count({
      where: { isCarryOver: true, handoverStatus: { in: ['PENDING', 'ACCEPTED'] } },
    });
    return {
      ...safe,
      movementCategoryAssignments: undefined,
      permissions,
      assignedMovementCategories: user.movementCategoryAssignments.map((item) => item.movementCategory),
      activeDailyDuty,
      carryOverCount,
    };
  }
}
