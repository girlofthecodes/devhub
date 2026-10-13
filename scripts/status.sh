#!/usr/bin/env bash
# Show container state and health for the Home Lab stack.
#   scripts/status.sh [--server a|b] [--env-file FILE]
set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

SERVER=a ENV_FILE="${DEVHUB_ENV_FILE:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="${2:?}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done
require docker
case "$SERVER" in
  a) FILE="$COMPOSE_A" ;;
  b) FILE="$COMPOSE_B" ;;
  *) die "--server debe ser a o b" ;;
esac
args=(-f "$FILE")
[ -n "$ENV_FILE" ] && args+=(--env-file "$ENV_FILE")
export DEVHUB_ENV_FILE="${ENV_FILE:-/dev/null}"

docker compose "${args[@]}" ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}\t{{.Status}}'
unhealthy="$(docker compose "${args[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$2=="unhealthy"{print $1}')"
if [ -n "$unhealthy" ]; then
  warn "Servicios no saludables: $unhealthy"
  exit 1
fi
ok "Todos los servicios con healthcheck están sanos"
