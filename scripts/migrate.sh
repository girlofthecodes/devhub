#!/usr/bin/env bash
# Apply database migrations with a one-off backend container (Servidor A). Idempotent.
#   DEVHUB_ENV_FILE=/etc/devhub/server-a.env scripts/migrate.sh
set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

ENV_FILE="${DEVHUB_ENV_FILE:?define DEVHUB_ENV_FILE (p. ej. /etc/devhub/server-a.env)}"
[ -f "$ENV_FILE" ] || die "No existe $ENV_FILE"
require docker
export DEVHUB_ENV_FILE="$ENV_FILE"

log "Aplicando migraciones"
docker compose -f "$COMPOSE_A" --env-file "$ENV_FILE" run --rm --no-deps \
  -e RUN_MIGRATIONS=false backend sh -c "python manage.py migrate --noinput && python manage.py createcachetable"
ok "Migraciones aplicadas"
