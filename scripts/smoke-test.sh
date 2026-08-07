#!/bin/sh
set -eu

BASE_URL="${BASE_URL:-http://127.0.0.1}"
BASE_URL="${BASE_URL%/}"

check() {
  label="$1"
  url="$2"
  code="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 "$url")"
  case "$code" in
    2*|3*|401|404) echo "$label: reachable ($code)" ;;
    *) echo "$label: failed ($code)" >&2; exit 1 ;;
  esac
}

check "Frontend" "$BASE_URL/"
check "Backend health" "$BASE_URL/health"
check "Authentication endpoint" "$BASE_URL/api/v1/auth/login"
check "Socket.IO transport" "$BASE_URL/socket.io/?EIO=4&transport=polling"
echo "Non-destructive deployment smoke checks passed."
