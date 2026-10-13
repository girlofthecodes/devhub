#!/usr/bin/env bash
# Create an isolated database + role for one application on the data server (Servidor B).
# Each app gets its own credentials; PUBLIC loses CONNECT; the password is printed once.
# Idempotent: an existing role/database is left untouched (use --rotate to change the password).
#
#   scripts/create-app-db.sh --app pedidos [--env-file FILE] [--rotate]
set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

ENV_FILE="" APP="" ROTATE=false
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?}"; shift 2 ;;
    --app) APP="${2:?}"; shift 2 ;;
    --rotate) ROTATE=true; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done
[ -n "$ENV_FILE" ] && load_env_file "$ENV_FILE"
[[ "$APP" =~ ^[a-z][a-z0-9_]{1,40}$ ]] || die "--app debe ser minúsculas/números/_ (p. ej. pedidos)"
require docker

DB_CONTAINER="${DB_CONTAINER:-devhub-data-postgres-1}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-${POSTGRES_SUPERUSER_PASSWORD:-}}"
ROLE="app_${APP}"
DB="${APP}"

psql_q() { docker exec -e PGPASSWORD="$PGPASSWORD" "$DB_CONTAINER" psql -U "$PGUSER" -d "${2:-postgres}" -AtX -v ON_ERROR_STOP=1 -c "$1"; }
new_password() { random_string 40; }

password=""
if [ -z "$(psql_q "SELECT 1 FROM pg_roles WHERE rolname='$ROLE'")" ]; then
  password="$(new_password)"
  psql_q "CREATE ROLE $ROLE LOGIN PASSWORD '$password' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 30" >/dev/null
  ok "Rol $ROLE creado"
elif $ROTATE; then
  password="$(new_password)"
  psql_q "ALTER ROLE $ROLE PASSWORD '$password'" >/dev/null
  ok "Contraseña de $ROLE rotada"
else
  log "El rol $ROLE ya existe (usa --rotate para cambiar su contraseña)"
fi

if [ -z "$(psql_q "SELECT 1 FROM pg_database WHERE datname='$DB'")" ]; then
  psql_q "CREATE DATABASE $DB OWNER $ROLE" >/dev/null
  ok "Base $DB creada"
fi
psql_q "REVOKE ALL ON DATABASE $DB FROM PUBLIC; GRANT CONNECT, TEMP ON DATABASE $DB TO $ROLE" >/dev/null
psql_q "REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT ALL ON SCHEMA public TO $ROLE" "$DB" >/dev/null
ok "Permisos: solo $ROLE puede conectarse a $DB"

if [ -n "$password" ]; then
  printf '\nGuarda esta credencial en el gestor de secretos de la aplicación (no se volverá a mostrar):\n' >&2
  printf '  POSTGRES_DB=%s\n  POSTGRES_USER=%s\n  POSTGRES_PASSWORD=%s\n\n' "$DB" "$ROLE" "$password"
fi
