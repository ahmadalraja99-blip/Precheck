#!/bin/sh
set -eu

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "Refusing restore. Set CONFIRM_RESTORE=yes after verifying the target and backup." >&2
  exit 2
fi
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: CONFIRM_RESTORE=yes $0 /path/to/backup.dump" >&2
  exit 2
fi

ENV_FILE="${ENV_FILE:-.env.production}"
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' < "$1"
echo "Restore completed. Run migrations and the deployment smoke test."
