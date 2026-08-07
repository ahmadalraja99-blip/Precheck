import { PrismaClient } from '@prisma/client';
import {
  DEFINITIVE_AIRLINES,
  TEMPORARY_COMPANY_CODES,
  TEMPORARY_COMPANY_USER_EMAILS,
} from './airlines';

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async (tx) => {
    const temporaryCompanies = await tx.company.findMany({
      where: { code: { in: [...TEMPORARY_COMPANY_CODES] } },
      select: {
        id: true,
        code: true,
        _count: {
          select: {
            sessions: true,
            counterReservations: true,
            flightReports: true,
            dailyCompanyReports: true,
            notifications: true,
          },
        },
      },
    });
    const temporaryCompanyIds = temporaryCompanies.map(({ id }) => id);

    const unsafeDependencies = temporaryCompanies.filter(
      ({ _count }) =>
        _count.sessions > 0 ||
        _count.counterReservations > 0 ||
        _count.flightReports > 0 ||
        _count.dailyCompanyReports > 0 ||
        _count.notifications > 0,
    );
    if (unsafeDependencies.length > 0) {
      throw new Error(
        `Refusing airline update: protected dependencies exist for ${unsafeDependencies
          .map(({ code }) => code)
          .join(', ')}`,
      );
    }

    const sessionFlights = await tx.dailySessionFlight.findMany({
      where: { companyId: { in: temporaryCompanyIds } },
      select: {
        id: true,
        _count: {
          select: {
            counterReservations: true,
            flightReports: true,
          },
        },
        preCheck: { select: { id: true } },
        outCheck: { select: { id: true } },
      },
    });
    const unsafeSessionFlights = sessionFlights.filter(
      ({ _count, preCheck, outCheck }) =>
        _count.counterReservations > 0 ||
        _count.flightReports > 0 ||
        preCheck !== null ||
        outCheck !== null,
    );
    if (unsafeSessionFlights.length > 0) {
      throw new Error(
        'Refusing airline update: protected flight workflow records exist',
      );
    }

    const temporaryUsers = await tx.user.findMany({
      where: { companyId: { in: temporaryCompanyIds } },
      select: { id: true, email: true },
    });
    const unexpectedUsers = temporaryUsers.filter(
      ({ email }) =>
        !TEMPORARY_COMPANY_USER_EMAILS.includes(
          email as (typeof TEMPORARY_COMPANY_USER_EMAILS)[number],
        ),
    );
    if (unexpectedUsers.length > 0) {
      throw new Error(
        `Refusing airline update: non-seed company users exist: ${unexpectedUsers
          .map(({ email }) => email)
          .join(', ')}`,
      );
    }

    await tx.dailySessionFlight.deleteMany({
      where: { companyId: { in: temporaryCompanyIds } },
    });
    await tx.flight.deleteMany({
      where: { companyId: { in: temporaryCompanyIds } },
    });
    await tx.dailyCompanySession.deleteMany({
      where: { companyId: { in: temporaryCompanyIds } },
    });
    await tx.user.deleteMany({
      where: { email: { in: [...TEMPORARY_COMPANY_USER_EMAILS] } },
    });
    await tx.company.deleteMany({
      where: { id: { in: temporaryCompanyIds } },
    });

    for (const airline of DEFINITIVE_AIRLINES) {
      await tx.company.upsert({
        where: { code: airline.code },
        update: {
          name: airline.name,
          isActive: true,
        },
        create: {
          ...airline,
          isActive: true,
        },
      });
    }
  });

  const activeCompanies = await prisma.company.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
    select: { code: true, name: true },
  });
  console.log(JSON.stringify(activeCompanies));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
