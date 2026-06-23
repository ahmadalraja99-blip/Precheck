import { PrismaClient, PermissionCode, Role, CounterStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  for (const code of Object.values(PermissionCode)) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, description: code.replace(/_/g, ' ') },
    });
  }

  const password = process.env.SEED_SUPER_ADMIN_PASSWORD || 'ChangeMe123!';
  const superAdmin = await prisma.user.upsert({
    where: { email: process.env.SEED_SUPER_ADMIN_EMAIL || 'super.admin@example.com' },
    update: {},
    create: {
      email: process.env.SEED_SUPER_ADMIN_EMAIL || 'super.admin@example.com',
      passwordHash: await bcrypt.hash(password, 12),
      fullName: process.env.SEED_SUPER_ADMIN_FULL_NAME || 'System Super Admin',
      role: Role.SUPER_ADMIN,
    },
  });

  for (let index = 1; index <= 40; index += 1) {
    const code = `C${String(index).padStart(2, '0')}`;
    await prisma.counter.upsert({
      where: { code },
      update: {},
      create: { code, name: `Check-in Counter ${index}`, status: CounterStatus.AVAILABLE },
    });
  }

  const items = [
    ['Monitor power and display', 'Display', true],
    ['Keyboard and mouse', 'Peripheral', true],
    ['Boarding pass printer', 'Printer', true],
    ['Bag tag printer', 'Printer', true],
    ['Network connectivity', 'Network', true],
    ['Scanner condition', 'Scanner', false],
  ] as const;
  for (let order = 0; order < items.length; order += 1) {
    const [name, category, isRequired] = items[order];
    const existing = await prisma.checkItem.findFirst({ where: { name } });
    if (!existing) await prisma.checkItem.create({ data: { name, category, isRequired, order, description: name } });
  }

  const company = await prisma.company.upsert({
    where: { code: 'SYA' },
    update: {},
    create: { name: 'Sample Airline', code: 'SYA', email: 'ops@example.com', phone: '+963000000000' },
  });

  await prisma.user.upsert({
    where: { email: 'company.user@example.com' },
    update: {},
    create: { email: 'company.user@example.com', passwordHash: await bcrypt.hash('Company123!', 12), fullName: 'Sample Company User', role: Role.COMPANY_USER, companyId: company.id },
  });
  await prisma.user.upsert({
    where: { email: 'movement.supervisor@example.com' },
    update: {},
    create: { email: 'movement.supervisor@example.com', passwordHash: await bcrypt.hash('Movement123!', 12), fullName: 'Sample Movement Supervisor', role: Role.MOVEMENT_SUPERVISOR },
  });
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: { email: 'admin@example.com', passwordHash: await bcrypt.hash('Admin123!', 12), fullName: 'Sample IT Admin', role: Role.ADMIN },
  });
  const adminPermissionCodes = [
    PermissionCode.CAN_VIEW_COUNTERS,
    PermissionCode.CAN_VIEW_SESSIONS,
    PermissionCode.CAN_VIEW_ISSUES,
    PermissionCode.CAN_RESOLVE_ISSUES,
    PermissionCode.CAN_APPROVE_OUTCHECK,
    PermissionCode.CAN_VIEW_REPORTS,
    PermissionCode.CAN_EXPORT_REPORTS,
    PermissionCode.CAN_VIEW_AUDIT_LOGS,
  ];
  const permissions = await prisma.permission.findMany({ where: { code: { in: adminPermissionCodes } } });
  for (const permission of permissions) {
    await prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: admin.id, permissionId: permission.id } },
      update: {},
      create: { userId: admin.id, permissionId: permission.id },
    });
  }

  console.log(`Seed completed. Super admin: ${superAdmin.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
