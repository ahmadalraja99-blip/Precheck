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
    update: { logoUrl: 'https://example.com/logos/syrian-air.png' },
    create: { name: 'Sample Airline', code: 'SYA', email: 'ops@example.com', phone: '+963000000000' },
  });

  const chamWings = await prisma.company.upsert({
    where: { code: 'CWA' },
    update: { name: 'Cham Wings', logoUrl: 'https://example.com/logos/cham-wings.png' },
    create: {
      name: 'Cham Wings',
      code: 'CWA',
      email: 'ops@chamwings.com',
      logoUrl: 'https://example.com/logos/cham-wings.png',
    },
  });
  const syrianAir = await prisma.company.upsert({
    where: { code: 'SYR' },
    update: { name: 'Syrian Air', logoUrl: 'https://example.com/logos/syrian-air.png' },
    create: {
      name: 'Syrian Air',
      code: 'SYR',
      email: 'ops@syrianair.com',
      logoUrl: 'https://example.com/logos/syrian-air.png',
    },
  });

  await prisma.user.upsert({
    where: { email: 'company.user@example.com' },
    update: {},
    create: { email: 'company.user@example.com', passwordHash: await bcrypt.hash('Company123!', 12), fullName: 'Sample Company User', role: Role.COMPANY_USER, companyId: company.id },
  });
  await prisma.user.upsert({
    where: { email: 'company.user2@example.com' },
    update: {
      passwordHash: await bcrypt.hash('Company123!', 12),
      companyId: syrianAir.id,
      role: Role.COMPANY_USER,
      isActive: true,
    },
    create: {
      email: 'company.user2@example.com',
      passwordHash: await bcrypt.hash('Company123!', 12),
      fullName: 'Syrian Air Company User',
      role: Role.COMPANY_USER,
      companyId: syrianAir.id,
    },
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

  const movementCategories = [
    ['CAT_A', 'Category A'],
    ['CAT_B', 'Category B'],
    ['CAT_C', 'Category C'],
    ['CAT_D', 'Category D'],
  ] as const;
  const categoryByCode = new Map<string, string>();
  for (const [code, name] of movementCategories) {
    const category = await prisma.movementCategory.upsert({
      where: { code },
      update: { name, isActive: true },
      create: { code, name },
    });
    categoryByCode.set(code, category.id);
  }

  const movementPasswordHash = await bcrypt.hash('Movement@123', 12);
  for (let index = 0; index < movementCategories.length; index += 1) {
    const [code] = movementCategories[index];
    const email = `movement.category${index + 1}@example.com`;
    const supervisor = await prisma.user.upsert({
      where: { email },
      update: {
        passwordHash: movementPasswordHash,
        fullName: `Movement ${code} Supervisor`,
        role: Role.MOVEMENT_SUPERVISOR,
        companyId: null,
        isActive: true,
      },
      create: {
        email,
        passwordHash: movementPasswordHash,
        fullName: `Movement ${code} Supervisor`,
        role: Role.MOVEMENT_SUPERVISOR,
      },
    });
    await prisma.movementCategoryAssignment.upsert({
      where: {
        userId_movementCategoryId: {
          userId: supervisor.id,
          movementCategoryId: categoryByCode.get(code)!,
        },
      },
      update: { isActive: true },
      create: {
        userId: supervisor.id,
        movementCategoryId: categoryByCode.get(code)!,
      },
    });
  }
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

  console.log(`Seed completed. Super admin: ${superAdmin.email}; airlines: ${chamWings.name}, ${syrianAir.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
