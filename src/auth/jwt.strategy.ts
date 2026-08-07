import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RolesPermissionsService } from '../roles-permissions/roles-permissions.service';
import { Role } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly rbac: RolesPermissionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { company: true } });
    if (!user || !user.isActive || (user.role === Role.COMPANY_USER && !user.company?.isActive)) throw new UnauthorizedException('Inactive or missing user');
    const permissions = await this.rbac.getUserPermissionCodes(user.id, user.role);
    return { id: user.id, email: user.email, fullName: user.fullName, role: user.role, companyId: user.companyId, permissions };
  }
}
