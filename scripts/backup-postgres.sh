#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
mkdir -p "$BACKUP_DIR"
OUTPUT="$BACKUP_DIR/precheck-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' > "$OUTPUT"
chmod 600 "$OUTPUT"
echo "PostgreSQL backup written to $OUTPUT"
