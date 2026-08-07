# Production readiness

## 1. Architecture summary

The system consists of a NestJS API, PostgreSQL through Prisma, filesystem-backed operational report storage, durable database report and email jobs, scheduled duty/backup processing, authenticated Socket.IO realtime delivery, and a Next.js frontend. PostgreSQL is authoritative; realtime events trigger cache refreshes and do not replace persisted state.

## 2. Environment variables

Required in production:

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: independent high-entropy secrets
- `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`
- `FRONTEND_ORIGIN`: comma-separated HTTPS frontend origins
- `PORT`, `API_PREFIX`
- `STORAGE_ROOT`: persistent writable storage outside the application image
- `REPORT_FONT_REGULAR_PATH`, `REPORT_FONT_BOLD_PATH`: readable Unicode/Arabic-capable font files
- `NEXT_PUBLIC_API_BASE_URL` in the frontend build environment

Operational report workers use the `OPERATIONAL_REPORT_JOB_*` settings in `.env.example`. Email workers and policy use `OPERATIONAL_REPORT_EMAIL_*`. SMTP delivery additionally requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, and credentials when the relay requires them. Disable operational email processing with `OPERATIONAL_REPORT_EMAIL_ENABLED=false` until SMTP and recipient policy have been verified.

Schedules use `DUTY_EXPIRATION_CRON`, `DAILY_BACKUP_CRON`, and `WEEKLY_BACKUP_CRON`. Seed variables are deployment/bootstrap inputs only and should not remain available to the running application. Replace the example seed password and rotate any credential ever deployed from an example value.

## 3. Database migration procedure

1. Take and verify a PostgreSQL backup.
2. Deploy the application artifact without starting traffic.
3. Set the production environment.
4. Run `npx prisma validate` and `npx prisma migrate status`.
5. Run `npx prisma migrate deploy` once from a controlled release job.
6. Re-run `npx prisma migrate status`; do not use `migrate dev`, reset, or seed against production.
7. Start one backend instance, check `/health`, then expand capacity.

## 4. Backend startup

Run `npm ci`, `npx prisma generate`, `npm run build`, and `npm run start:prod`. The process handles termination signals through Nest shutdown hooks and disconnects Prisma during module destruction.

## 5. Frontend build and startup

Set `NEXT_PUBLIC_API_BASE_URL` to the externally reachable API base including `/api/v1`, then run `npm ci`, `npm run test:translations`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm run start`. Public environment values are embedded at build time.

## 6. Storage and reports

`STORAGE_ROOT` must be persistent, writable only by the application identity, excluded from public static serving, and backed up with the database. Downloads resolve stored relative paths through the storage service; do not store user-provided absolute paths. Monitor free space and verify report checksums during backup restores.

## 7. Arabic PDF fonts

Both report font paths must reference fonts that cover Arabic and Latin glyphs. Package the approved font files in the runtime image or mount them read-only. Validate an Arabic report in the release environment before accepting traffic.

## 8. SMTP policy

Use a restricted relay identity, TLS, and approved sender domain. Confirm admin/company recipient policy, CC/BCC lists, attachment limits, and invalid-recipient filtering in a test relay first. Email failure must not change flight/report state. Never use production SMTP during automated tests.

## 9. Realtime topology

The current Socket.IO adapter is in-memory and is suitable for one backend instance. Multiple instances require a Redis-compatible Socket.IO adapter and sticky/session-aware proxy configuration; otherwise room membership and broadcasts are instance-local. WebSocket upgrade and polling must both reach the `/realtime` namespace.

## 10. Backups

Application backup methods do not replace infrastructure backups. Configure managed PostgreSQL point-in-time recovery plus independent `STORAGE_ROOT` backup, retention, encryption, restore drills, and alerting. Database and report storage snapshots should be coordinated so checksums and metadata remain consistent.

## 11. Health check

`GET /health` is intentionally outside the API prefix and returns only application/database availability. It does not expose connection strings, credentials, or host details. Use it for readiness; process liveness should also monitor that the Node process is running.

## 12. Ports

The backend listens on `PORT` (default local value 3000). The frontend normally listens on its Next.js port. PostgreSQL must not be exposed publicly. Only the HTTPS reverse proxy should be internet-facing.

## 13. HTTPS and reverse proxy

Terminate TLS at an approved reverse proxy/load balancer. Forward the API and Socket.IO upgrade headers, impose request/body/time limits, preserve the client scheme, and restrict CORS to `FRONTEND_ORIGIN`. Apply secure headers and rate limiting at the edge in addition to application Helmet headers.

## 14. Known limitations

- Multi-instance realtime requires a Redis adapter.
- Filesystem report storage requires shared persistent storage when scaling workers.
- Browser/device visual and accessibility regression testing is manual because no browser E2E runner is configured.
- Windows may fail the final Next.js worker with `spawn EPERM` after successful compilation/type checking; production builds should run in the target Linux/container environment.
- Infrastructure database and report-file backups remain an operations responsibility.

## 15. Manual smoke test

- Sign in as each role and confirm direct-route denial and navigation visibility.
- Activate a disposable duty and complete one isolated successful flight.
- Complete an isolated rejected OutCheck, resolve its issue, submit attempt 2, and approve.
- Confirm company/duty isolation in two browser sessions.
- Confirm counters/reservations, history, audit records, notifications, PDF/Excel jobs, secure downloads, and no duplicate jobs.
- Validate English/Arabic, RTL identifiers, 360/390/768/desktop layouts, keyboard dialogs, and screen-reader labels.
- Validate an Arabic PDF and an email through a non-production SMTP relay.
- Restart workers while test jobs are pending and verify stale-lock recovery.

Never use XH9001 or RB9001 for deployment smoke tests.

## 16. Rollback considerations

Application rollback is safe only when the previous binary understands the migrated schema. Prefer forward fixes after additive migrations. Before any schema rollback, stop writers, back up PostgreSQL and report storage, assess data created under the new schema, and use a reviewed compensating migration. Never run Prisma reset or manually delete operational history.
