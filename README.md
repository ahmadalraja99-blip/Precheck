# Online PreCheck / OutCheck Backend

Backend-only NestJS system for IT Support at Damascus International Airport to manage Check-in counter receiving and handover workflows.

## Quick Start

1. Install dependencies: `npm install`
2. Copy environment: `copy .env.example .env`
3. Start PostgreSQL: `docker compose up -d postgres`
4. Generate Prisma client: `npm run prisma:generate`
5. Create migration: `npm run prisma:migrate`
6. Seed data: `npm run prisma:seed`
7. Start API: `npm run start:dev`

Default API prefix is `http://localhost:3000/api/v1`.

## Seed Users

Development fallback users are documented in `prisma/seed.ts`. Override the Super Admin with:

- `SEED_SUPER_ADMIN_EMAIL`
- `SEED_SUPER_ADMIN_PASSWORD`
- `SEED_SUPER_ADMIN_FULL_NAME`

## Main Flow

Movement Supervisor creates a session using AVAILABLE counters. Company User starts and submits PreCheck. Clean PreCheck moves the session to OPERATING and counters to IN_USE. OutCheck submission moves counters to PENDING_OUTCHECK_APPROVAL. Admin or Super Admin with `CAN_APPROVE_OUTCHECK` approves or rejects. Approval closes the session and generates PDF/Excel reports; rejection creates issues and marks counters UNAVAILABLE.

## Postman

Import:

- `postman/Online-PreCheck-OutCheck.postman_collection.json`
- `postman/Online-PreCheck-OutCheck.postman_environment.json`

Run `Auth / Login` first to save `accessToken` and `refreshToken`.
