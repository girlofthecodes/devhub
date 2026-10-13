#!/usr/bin/env bash
# Back up PostgreSQL databases (custom format) with checksum, rotation and optional
# off-site copy (rclone) and encryption (age). Safe to run repeatedly (lock + unique names).
#
#   scripts/backup.sh [--env-file FILE] [--db NAME ...]
#
# Variables (env file or environment):
#   DB_CONTAINER            PostgreSQL container (default: devhub-data-postgres-1)
#   PGUSER                  User for pg_dump (default: postgres)
#   POSTGRES_SUPERUSER_PASSWORD / PGPASSWORD   Password (never printed)
#   BACKUP_DIR              Destination (default: /var/backups/devhub)
#   BACKUP_RETENTION_DAYS   Local retention (default: 14)
#   BACKUP_REMOTE           rclone remote path for the off-site copy (optional)
#   BACKUP_AGE_RECIPIENT    age public key to encrypt the dumps (optional)
set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

ENV_FILE=""
DBS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?}"; shift 2 ;;
    --db) DBS+=("${2:?}"); shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done
[ -n "$ENV_FILE" ] && load_env_file "$ENV_FILE"

require docker sha256sum find
DB_CONTAINER="${DB_CONTAINER:-devhub-data-postgres-1}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-${POSTGRES_SUPERUSER_PASSWORD:-${POSTGRES_PASSWORD:-}}}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/devhub}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
[[ "$RETENTION" =~ ^[0-9]+$ ]] || die "BACKUP_RETENTION_DAYS debe ser un número"

docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q true \
  || die "El contenedor $DB_CONTAINER no está en ejecución"

psql_q() {
  docker exec -e PGPASSWORD="$PGPASSWORD" "$DB_CONTAINER" \
    psql -U "$PGUSER" -d postgres -AtX -v ON_ERROR_STOP=1 -c "$1"
}

run_backup() {
  local stamp dir db file
  stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  dir="$BACKUP_DIR/$stamp"
  umask 077
  mkdir -p "$dir"

  if [ ${#DBS[@]} -eq 0 ]; then
    mapfile -t DBS < <(psql_q "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> 'postgres' ORDER BY 1")
  fi
  [ ${#DBS[@]} -gt 0 ] || die "No hay bases de datos que respaldar"

  log "Respaldo en $dir (${#DBS[@]} base(s): ${DBS[*]})"
  docker exec -e PGPASSWORD="$PGPASSWORD" "$DB_CONTAINER" pg_dumpall -U "$PGUSER" --globals-only --no-role-passwords > "$dir/globals.sql"
  for db in "${DBS[@]}"; do
    [[ "$db" =~ ^[A-Za-z0-9_]+$ ]] || die "Nombre de base no válido: $db"
    file="$dir/$db.dump"
    docker exec -e PGPASSWORD="$PGPASSWORD" "$DB_CONTAINER" pg_dump -U "$PGUSER" -d "$db" -Fc -Z 6 > "$file"
    [ -s "$file" ] || die "El respaldo de $db está vacío"
    ok "$db → $(du -h "$file" | cut -f1)"
  done

  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    require age
    for file in "$dir"/*; do
      age -r "$BACKUP_AGE_RECIPIENT" -o "$file.age" "$file" && rm -f "$file"
    done
    log "Respaldos cifrados con age"
  fi

  (cd "$dir" && sha256sum -- * > SHA256SUMS)
  ok "Checksums en $dir/SHA256SUMS"

  if [ -n "${BACKUP_REMOTE:-}" ]; then
    require rclone
    rclone copy --immutable "$dir" "$BACKUP_REMOTE/$stamp"
    ok "Copia externa en $BACKUP_REMOTE/$stamp"
  else
    warn "BACKUP_REMOTE no definido: sin copia externa (recomendado configurarla)"
  fi

  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$RETENTION" -print -exec rm -rf {} + \
    | while read -r old; do log "Rotado (>${RETENTION} días): $old"; done
  echo "$dir"
}

with_lock backup run_backup
