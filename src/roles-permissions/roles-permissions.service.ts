import { BadRequestException, Injectable } from '@nestjs/common';
import { PermissionCode, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const ALL_PERMISSIONS = Object.values(PermissionCode);

export const COMPANY_USER_PERMISSIONS: readonly PermissionCode[] = [
  PermissionCode.CAN_VIEW_DASHBOARD,
  PermissionCode.CAN_VIEW_COUNTERS,
  PermissionCode.CAN_VIEW_DEVICES,
  PermissionCode.CAN_VIEW_SESSIONS,
  PermissionCode.CAN_VIEW_REPORTS,
  PermissionCode.CAN_EXPORT_REPORTS,
];

@Injectable()
export class RolesPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserPermissionCodes(userId: string, role: Role): Promise<PermissionCode[]> {
    if (role === Role.SUPER_ADMIN) return ALL_PERMISSIONS;
    const roleRows = await this.prisma.rolePermission.findMany({
      where: { role },
      include: { permission: true },
    });
    if (role === Role.COMPANY_USER) {
      return roleRows.map((row) => row.permission.code);
    }
    const userRows = await this.prisma.userPermission.findMany({
      where: { userId },
      include: { permission: true },
    });
    return [...new Set([...roleRows, ...userRows].map((row) => row.permission.code))];
  }

  async setAdminPermissions(userId: string, codes: PermissionCode[]) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.role !== Role.ADMIN) throw new BadRequestException('Only ADMIN permissions are assignable');
    const permissions = await this.prisma.permission.findMany({ where: { code: { in: codes } } });
    return this.prisma.$transaction(async (tx) => {
      await tx.userPermission.deleteMany({ where: { userId } });
      if (permissions.length) {
        await tx.userPermission.createMany({
          data: permissions.map((permission) => ({ userId, permissionId: permission.id })),
          skipDuplicates: true,
        });
      }
      return tx.user.findUnique({
        where: { id: userId },
        include: { permissions: { include: { permission: true } } },
      });
    });
  }
}
