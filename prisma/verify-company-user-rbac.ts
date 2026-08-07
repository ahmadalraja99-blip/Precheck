import { ForbiddenException } from '@nestjs/common';
import { PermissionCode, PrismaClient, Role } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';
import { CounterReservationsService } from '../src/counter-reservations/counter-reservations.service';
import { FlightsService } from '../src/flights/flights.service';
import { OperationAccessService } from '../src/operations/operation-access.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  COMPANY_USER_PERMISSIONS,
  RolesPermissionsService,
} from '../src/roles-permissions/roles-permissions.service';

const prisma = new PrismaClient();
const targetEmail = 'flycham.supervisor@example.com';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const database = prisma as unknown as PrismaService;
  const rbac = new RolesPermissionsService(database);
  const access = new OperationAccessService(database, {
    expireDueDuties: async () => undefined,
  } as never);
  const auth = new AuthService(database, null!, null!, rbac, access);
  const flights = new FlightsService(database, access);
  const reservations = new CounterReservationsService(database, access);

  const user = await prisma.user.findUnique({
    where: { email: targetEmail },
    include: { company: true },
  });
  assert(user, `${targetEmail} was not found`);
  assert(user.role === Role.COMPANY_USER, 'User is not a Company User');
  assert(user.company, 'Company User has no assigned company');

  const effectivePermissions = await rbac.getUserPermissionCodes(user.id, user.role);
  assert(effectivePermissions.length > 0, 'Effective permissions are empty');
  assert(
    effectivePermissions.length === COMPANY_USER_PERMISSIONS.length &&
      COMPANY_USER_PERMISSIONS.every((permission) => effectivePermissions.includes(permission)),
    'Effective permissions do not match the Company User allowlist',
  );
  assert(
    !effectivePermissions.includes(PermissionCode.CAN_APPROVE_OUTCHECK),
    'Company User received CAN_APPROVE_OUTCHECK',
  );

  const profile = await auth.me(user.id);
  assert(profile.role === Role.COMPANY_USER, '/auth/me role is incorrect');
  assert(profile.companyId === user.companyId, '/auth/me companyId is incorrect');
  assert(profile.company?.id === user.companyId, '/auth/me company is incorrect');
  assert(profile.permissions.length > 0, '/auth/me permissions are empty');

  const ownFlight = await prisma.flight.findFirst({
    where: { companyId: user.companyId!, flightNumber: 'XH9001' },
  });
  assert(ownFlight, 'Fly Cham flight XH9001 was not found');
  await flights.find(ownFlight.id, {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    companyId: user.companyId,
    permissions: effectivePermissions,
  });

  const sessionFlight = await prisma.dailySessionFlight.findFirst({
    where: { companyId: user.companyId!, flightId: ownFlight.id },
  });
  assert(sessionFlight, 'XH9001 is not attached to a company session');
  const ownReservations = await reservations.forFlight(sessionFlight.id, {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    companyId: user.companyId,
    permissions: effectivePermissions,
  });
  const counterCodes = ownReservations.map((reservation) => reservation.counter.code);
  for (const code of ['C01', 'C02', 'C03', 'C04', 'C05']) {
    assert(counterCodes.includes(code), `XH9001 reservation ${code} was not found`);
  }

  const otherFlight = await prisma.flight.findFirst({
    where: { companyId: { not: user.companyId! } },
  });
  assert(otherFlight, 'No other-company flight exists for the scope check');
  let denied = false;
  try {
    await flights.find(otherFlight.id, {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      companyId: user.companyId,
      permissions: effectivePermissions,
    });
  } catch (error) {
    denied = error instanceof ForbiddenException;
  }
  assert(denied, 'Other-company flight access was not forbidden');

  console.log(
    JSON.stringify(
      {
        profile: {
          email: profile.email,
          role: profile.role,
          company: profile.company?.name,
          companyId: profile.companyId,
          permissions: profile.permissions,
        },
        ownFlight: ownFlight.flightNumber,
        counterReservations: counterCodes,
        otherCompanyFlightDenied: denied,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
