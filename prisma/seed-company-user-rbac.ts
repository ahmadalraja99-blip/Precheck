import { PermissionCode, PrismaClient, Role } from '@prisma/client';
import { COMPANY_USER_PERMISSIONS } from '../src/roles-permissions/roles-permissions.service';

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async (tx) => {
    for (const code of COMPANY_USER_PERMISSIONS) {
      const permission = await tx.permission.upsert({
        where: { code },
        update: {},
        create: { code, description: code.replace(/_/g, ' ') },
      });

      await tx.rolePermission.upsert({
        where: {
          role_permissionId: {
            role: Role.COMPANY_USER,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          role: Role.COMPANY_USER,
          permissionId: permission.id,
        },
      });
    }

    await tx.rolePermission.deleteMany({
      where: {
        role: Role.COMPANY_USER,
        permission: {
          code: { notIn: [...COMPANY_USER_PERMISSIONS] },
        },
      },
    });
  });

  const assigned = await prisma.rolePermission.findMany({
    where: { role: Role.COMPANY_USER },
    select: { permission: { select: { code: true } } },
    orderBy: { permission: { code: 'asc' } },
  });

  const codes = assigned.map(({ permission }) => permission.code);
  if (codes.includes(PermissionCode.CAN_APPROVE_OUTCHECK)) {
    throw new Error('COMPANY_USER must not receive CAN_APPROVE_OUTCHECK');
  }

  console.log(`Company User permissions (${codes.length}): ${codes.join(', ')}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
