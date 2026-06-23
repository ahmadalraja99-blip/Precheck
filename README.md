# Online PreCheck / OutCheck Backend

Backend-only NestJS system for IT Support at Damascus International Airport to manage Check-in counter receiving and handover workflows.

## Quick Start

Docker Desktop must be running before starting the database.

```bash
npm install
copy .env.example .env
docker compose up -d
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run start:dev
```

Default API prefix is `http://localhost:3000/api/v1`.

The Docker PostgreSQL container listens on internal port `5432` and is exposed on host port `5433`.

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/precheck_outcheck?schema=public"
```

## Seed Users

Development fallback users are documented in `prisma/seed.ts`. Override the Super Admin with:

- `SEED_SUPER_ADMIN_EMAIL`
- `SEED_SUPER_ADMIN_PASSWORD`
- `SEED_SUPER_ADMIN_FULL_NAME`

## Main Flow

Movement Supervisor creates a session using AVAILABLE counters. Company User starts and submits PreCheck. Clean PreCheck moves the session to OPERATING and counters to IN_USE. OutCheck submission moves counters to PENDING_OUTCHECK_APPROVAL. Admin or Super Admin with `CAN_APPROVE_OUTCHECK` approves or rejects. Approval closes the session and generates PDF/Excel reports; rejection creates issues and marks counters UNAVAILABLE.

Session creation accepts an optional `note` or `notes` field for operational comments. Company Users should use the safe checklist template endpoints for session-scoped counter, device, and check item data:

- `GET /api/v1/sessions/:sessionId/precheck/template`
- `GET /api/v1/sessions/:sessionId/outcheck/template`

## Postman

Import:

- `postman/Online-PreCheck-OutCheck.postman_collection.json`
- `postman/Online-PreCheck-OutCheck.postman_environment.json`

Run `Auth / Login` first to save `accessToken` and `refreshToken`.

## Troubleshooting

- `P1001` database connection error: confirm Docker Desktop is running, run `docker compose up -d`, and check that `DATABASE_URL` uses host port `5433`.
- `EADDRINUSE` on port `3000`: stop the other process using port `3000` or set a different `PORT` in `.env`.
- Docker not running: start Docker Desktop, wait until it reports ready, then rerun `docker compose up -d`.
- Postman `401`: login again, confirm `accessToken` is saved, and verify the request inherits collection authorization.
- Postman `403`: the token is valid, but the role or assigned permissions do not allow that endpoint.
- Expired JWT token: rerun `Auth / Login` or use `Auth / Refresh` to update `accessToken`.
- Missing Postman variables: check the active environment for `baseUrl`, `accessToken`, `refreshToken`, `companyId`, `counterId`, `sessionId`, `deviceId`, `checkItemId`, `issueId`, and `reportId`.
