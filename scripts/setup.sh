#!/usr/bin/env bash
# Prepare a server for DevHub: check tools and create the env file with generated secrets.
#   scripts/setup.sh --server a|b [--env-file /etc/devhub/server-a.env]
# Idempotent: an existing env file is never overwritten.
set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

SERVER="" ENV_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="${2:?}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done
case "$SERVER" in a|b) ;; *) die "Indica --server a (aplicaciones) o --server b (datos)" ;; esac
ENV_FILE="${ENV_FILE:-/etc/devhub/server-$SERVER.env}"

require docker
docker compose version >/dev/null 2>&1 || die "Se requiere Docker Compose v2 (docker compose)"
ok "Docker $(docker version --format '{{.Server.Version}}') y Compose $(docker compose version --short)"

if [ -f "$ENV_FILE" ]; then
  ok "$ENV_FILE ya existe; no se modifica"
  exit 0
fi

mkdir -p "$(dirname "$ENV_FILE")"
umask 077
template="$REPO_ROOT/infrastructure/compose/server-$SERVER.env.example"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    DJANGO_SECRET_KEY=*) printf 'DJANGO_SECRET_KEY=%s\n' "$(random_string 64 'A-Za-z0-9!@%^*_-')" ;;
    POSTGRES_PASSWORD=*|POSTGRES_SUPERUSER_PASSWORD=*) printf '%s=%s\n' "${line%%=*}" "$(random_string 40)" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$template" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "Creado $ENV_FILE (permisos 600) con secretos aleatorios"
warn "Revisa y completa los valores de ejemplo (dominios, IPs de la VPN, correo, token del túnel)."
