#!/usr/bin/env bash
# Check DevHub availability (API + database) with timeouts and retries.
#   scripts/healthcheck.sh [URL] [--retries N] [--wait SECONDS]
# Exit 0 = healthy, 1 = unhealthy/unreachable. Prints the health JSON.
set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

URL="http://127.0.0.1:${PROXY_LOCAL_PORT:-8080}/api/v1/health/"
RETRIES=1 WAIT=3
while [ $# -gt 0 ]; do
  case "$1" in
    --retries) RETRIES="${2:?}"; shift 2 ;;
    --wait) WAIT="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    http*://*) URL="$1"; shift ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done
[[ "$RETRIES" =~ ^[0-9]+$ && "$WAIT" =~ ^[0-9]+$ ]] || die "--retries y --wait deben ser números"
require curl

for attempt in $(seq 1 "$RETRIES"); do
  body="$(curl -sS --max-time 5 -w '\n%{http_code}' "$URL" 2>/dev/null || printf '\n000')"
  code="${body##*$'\n'}"
  json="${body%$'\n'*}"
  if [ "$code" = "200" ]; then
    ok "DevHub disponible ($URL) $json"
    exit 0
  fi
  [ "$attempt" -lt "$RETRIES" ] && { log "Intento $attempt/$RETRIES: HTTP $code; reintentando en ${WAIT}s"; sleep "$WAIT"; }
done
case "$code" in
  503) warn "DevHub responde pero sin base de datos (HTTP 503): revisa la VPN o el Servidor B. $json" ;;
  000) warn "Sin respuesta de $URL" ;;
  *) warn "Estado inesperado HTTP $code: $json" ;;
esac
exit 1
