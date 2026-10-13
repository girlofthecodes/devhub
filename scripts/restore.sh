#!/usr/bin/env bash
# Restore a PostgreSQL backup produced by scripts/backup.sh.
#
#   scripts/restore.sh --dump DIR/DB.dump --verify            # restore into a scratch DB, check, drop
#   scripts/restore.sh --dump DIR/DB.dump --db NAME [--yes]   # restore OVER an existing database
#
# The real restore asks for the exact phrase «RESTAURAR <db>» (or --yes) and fails closed
# without a TTY. Stop the applications using the database before restoring over it.
# Variables: DB_CONTAINER, PGUSER, PGPASSWORD / POSTGRES_SUPERUSER_PASSWORD (see backup.sh).
set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

ENV_FILE="" DUMP="" TARGET="" VERIFY=false YES=false
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?}"; shift 2 ;;
    --dump) DUMP="${2:?}"; shift 2 ;;
    --db) TARGET="${2:?}"; shift 2 ;;
    --verify) VERIFY=true; shift ;;
    --yes) YES=true; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done
[ -n "$ENV_FILE" ] && load_env_file "$ENV_FILE"
require docker sha256sum
[ -n "$DUMP" ] || die "Indica --dump RUTA.dump"
[ -f "$DUMP" ] || die "No existe $DUMP"
$VERIFY || [ -n "$TARGET" ] || die "Indica --db NOMBRE (o --verify)"
[ -z "$TARGET" ] || [[ "$TARGET" =~ ^[A-Za-z0-9_]+$ ]] || die "Nombre de base no válido"

DB_CONTAINER="${DB_CONTAINER:-devhub-data-postgres-1}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-${POSTGRES_SUPERUSER_PASSWORD:-${POSTGRES_PASSWORD:-}}}"

# 1) Integrity: compare with SHA256SUMS written at backup time.
SUMS="$(dirname "$DUMP")/SHA256SUMS"
if [ -f "$SUMS" ]; then
  # Accept both "hash  file" (Linux) and "hash *file" (binary mode, e.g. Git Bash).
  entry="$(awk -v f="$(basename "$DUMP")" '{n=$2; sub(/^\*/, "", n)} n==f {print $1"  "n}' "$SUMS")"
  [ -n "$entry" ] || die "$(basename "$DUMP") no figura en SHA256SUMS"
  (cd "$(dirname "$DUMP")" && printf '%s\n' "$entry" | sha256sum -c --quiet -) \
    || die "El checksum de $DUMP no coincide: respaldo corrupto o alterado"
  ok "Checksum verificado"
else
  warn "No se encontró SHA256SUMS junto al respaldo: no se puede verificar su integridad"
fi

dexec() { docker exec -i -e PGPASSWORD="$PGPASSWORD" "$DB_CONTAINER" "$@"; }
psql_db() { dexec psql -U "$PGUSER" -d "$1" -AtX -v ON_ERROR_STOP=1 -c "$2"; }

restore_into() {
  local db="$1"
  dexec pg_restore -U "$PGUSER" -d "$db" --no-owner --no-privileges --exit-on-error < "$DUMP"
}

if $VERIFY; then
  scratch="restore_verify_$(date +%s)"
  log "Restaurando en la base temporal $scratch"
  psql_db postgres "CREATE DATABASE $scratch"
  trap 'psql_db postgres "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" >/dev/null || true' EXIT
  restore_into "$scratch"
  tables="$(psql_db "$scratch" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  [ "$tables" -gt 0 ] || die "La restauración no contiene tablas"
  migrations="$(psql_db "$scratch" "SELECT count(*) FROM django_migrations" 2>/dev/null || echo 'n/a')"
  ok "Restauración verificada: $tables tablas, $migrations migraciones registradas"
  exit 0
fi

warn "Se SOBRESCRIBIRÁ la base «$TARGET» en $DB_CONTAINER con $(basename "$DUMP")."
confirm_phrase "RESTAURAR $TARGET" "$YES"
psql_db postgres "SELECT 1 FROM pg_database WHERE datname='$TARGET'" | grep -q 1 || die "La base $TARGET no existe"
log "Cerrando conexiones activas a $TARGET"
psql_db postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$TARGET' AND pid <> pg_backend_pid()" >/dev/null
owner="$(psql_db postgres "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='$TARGET'")"
psql_db postgres "DROP DATABASE $TARGET WITH (FORCE)"
psql_db postgres "CREATE DATABASE $TARGET OWNER $owner"
restore_into "$TARGET"
psql_db "$TARGET" "REASSIGN OWNED BY $PGUSER TO $owner" >/dev/null 2>&1 || true
psql_db "$TARGET" "GRANT ALL ON SCHEMA public TO $owner; GRANT ALL ON ALL TABLES IN SCHEMA public TO $owner; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO $owner" >/dev/null
ok "Base $TARGET restaurada desde $(basename "$DUMP") (propietario: $owner)"
