# Docker Compose production deployment

This package prepares deployment; it does not deploy to an external system. Commands are run from the backend repository, which expects the frontend repository at `../Precheck-Frontend`.

## 1. Prepare the Linux VPS

Use a maintained 64-bit Linux distribution. Install Docker Engine and the Compose plugin from Docker's official repository. Configure the host firewall to expose SSH, TCP 80, and TCP 443 only. PostgreSQL, backend, and frontend have no host-published ports.

## 2. Copy the repositories

Place the repositories beside each other:

```text
/opt/precheck/Precheck
/opt/precheck/Precheck-Frontend
```

Review the working tree and deploy a versioned commit/artifact rather than an unreviewed development directory.

## 3. Create production configuration

From `Precheck`:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
```

Replace every placeholder. `DATABASE_URL` uses hostname `postgres`; URL-encode special characters in its password. `FRONTEND_ORIGIN` is the public origin without `/api/v1`. `NEXT_PUBLIC_API_BASE_URL` is the absolute public API URL including `/api/v1` and is embedded during the frontend image build. Production therefore needs its public domain before the final frontend image is built.

Keep operational email disabled until SMTP and recipients are verified through a test relay. Never commit `.env.production`.

## 4. Supply Arabic PDF fonts

Copy licensed Arabic/Latin TrueType fonts to:

```text
deploy/fonts/regular.ttf
deploy/fonts/bold.ttf
```

The directory is mounted read-only. The backend runs as UID/GID 1001 and must be able to read the files; use mode `0644` or an equivalent ACL. Proprietary fonts are ignored by Git.

## 5. Persistent storage

Compose creates `postgres_data` and `report_storage` named volumes. Report generation writes and atomically renames files inside `/app/storage`; the volume is owned by the non-root backend identity after first creation. Back up both volumes independently. If using a host bind mount instead, create it for UID/GID 1001 and keep it outside the repository.

## 6. Build images

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml build migrate backend frontend
```

The backend image uses deterministic dependencies, Prisma generation, compiled NestJS output, production-only runtime dependencies, `dumb-init`, and a non-root user. The frontend image performs a Linux `next build`, uses standalone output, and runs as a non-root user.

## 7. Start PostgreSQL and migrate

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
```

Only `prisma migrate deploy` is used. Do not run `migrate dev`, reset, or seed automatically. The normal `up -d` flow also requires the one-shot migration service to complete before backend startup; do not scale that service.

## 8. Bootstrap the first Super Admin

Set explicit, non-example `SEED_SUPER_ADMIN_*` variables, then run once:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --entrypoint npx migrate prisma db seed
```

In production, the seed exits unless explicit non-example credentials are supplied and creates only permission definitions plus the requested Super Admin. It does not create sample users, counters, categories, or airlines. Remove the seed variables from the runtime environment after confirming login and rotate the initial password through the approved operational process.

## 9. Start applications and Nginx

For initial HTTP/certificate issuance:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Nginx publishes host ports 80 and 443; its unprivileged container listens on 8080/8443. PostgreSQL is isolated on the internal database network. Backend/frontend ports are Docker-internal only.

## 10. REST and Socket.IO routing

- `/` and `/_next/static/` proxy to Next.js.
- `/health` and `/api/` proxy to backend port 3000. The API proxy does not strip the path, so `/api/v1/auth/login` reaches the backend as `/api/v1/auth/login`; no prefix is duplicated.
- Socket.IO transport uses `/socket.io/` and is proxied with HTTP/1.1 Upgrade headers.
- The authenticated Socket.IO namespace is `/realtime`. A namespace is not a separate reverse-proxy URL.

The frontend derives the socket origin from `NEXT_PUBLIC_API_BASE_URL`, so REST and realtime use the same public origin.

## 11. Domain and TLS

Point DNS A/AAAA records to the VPS before certificate issuance.

Option A — host Certbot: use the mounted `deploy/nginx/certbot-webroot` for HTTP-01, obtain the certificate on the host, and copy/symlink readable `fullchain.pem` and `privkey.pem` into `deploy/nginx/certs`.

Option B — existing certificate: place the certificate chain and private key in that directory with restrictive host permissions and read access for the Nginx container.

Then copy `deploy/nginx/https.conf.template` to a deployment-owned `deploy/nginx/https.conf`, replace `example.com`, and change the Nginx configuration volume source in Compose from `http.conf` to `https.conf`. Validate and restart:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -t
docker compose --env-file .env.production -f docker-compose.prod.yml restart nginx
```

The HTTPS template enables HTTP-to-HTTPS redirect and HSTS. Do not enable HSTS or redirect before a valid certificate is installed. Certificate renewal remains a host operations responsibility; reload Nginx after renewal.

## 12. Verify health and realtime

```sh
BASE_URL=https://example.com ./scripts/smoke-test.sh
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

`GET /health` checks application/database availability without exposing infrastructure details. Inspect browser developer tools to confirm an authenticated `/socket.io/` connection and `/realtime` namespace connection.

## 13. Operational smoke test

Use disposable flights—never XH9001 or RB9001—to verify login/RBAC, duty activation, session/flight/reservations, PreCheck, operation, OutCheck approval/rejection, notifications, PDF/Excel, downloads, history, carry-over, Arabic/English, and tablet/mobile layouts. Use a non-production SMTP relay before enabling operational email.

## 14. Backups

Create a PostgreSQL custom-format dump:

```sh
BACKUP_DIR=/secure/backups ./scripts/backup-postgres.sh
```

Encrypt backups, copy them off-host, define retention, and test restores regularly. The guarded restore script requires `CONFIRM_RESTORE=yes` and is destructive to the selected database.

Database backups do not contain report files. Back up the `report_storage` volume with a filesystem/snapshot tool while coordinating its recovery point with PostgreSQL. Restore the database and report volume together and verify stored report checksums afterward.

## 15. Logs and monitoring

Services log to stdout/stderr. Compose limits JSON logs to five 10 MB files per service. Monitor container health, restarts, PostgreSQL/storage capacity, failed/exhausted jobs, TLS expiration, backup success, and `/health` availability. Resource limits should be measured on staging before being applied.

## 16. Scaling

One backend instance is supported immediately. PostgreSQL job claiming is multi-instance safe, but multiple backend replicas require:

- a Redis-compatible Socket.IO adapter;
- shared report storage;
- load-balancer configuration compatible with Socket.IO.

Do not scale the migration service. Redis is not required for the initial single-instance deployment.

## 17. Rollback

Before release, back up PostgreSQL and reports and retain the previous images. For an application-only rollback, pin prior image tags and restart services only if the previous binary understands the current schema. Do not use Prisma reset. If a migration is incompatible, stop writers and prepare a reviewed forward/compensating migration. Restore database and report storage together only as an explicitly approved recovery operation.
