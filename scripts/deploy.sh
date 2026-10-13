#!/usr/bin/env bash
# Deploy DevHub on Servidor A: build → migrate → (re)start → health check.
# Safe to re-run (compose is declarative, migrations are idempotent, a lock prevents overlap).
#
#   DEVHUB_ENV_FILE=/etc/devhub/server-a.env scripts/deploy.sh [--tag TAG] [--skip-build] [--tunnel]
#
#   --tag TAG      Use/build images with this tag (default: current commit).
#   --skip-build   Use already built images (e.g. built by CI).
#   --tunnel       Also start cloudflared (requires CLOUDFLARE_TUNNEL_TOKEN).
set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

TAG="" SKIP_BUILD=false TUNNEL=false
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --tunnel) TUNNEL=true; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done
ENV_FILE="${DEVHUB_ENV_FILE:?define DEVHUB_ENV_FILE (p. ej. /etc/devhub/server-a.env)}"
[ -f "$ENV_FILE" ] || die "No existe $ENV_FILE (créalo con scripts/setup.sh --server a)"
if [ "$(uname -s)" = "Linux" ] && [ "$(stat -c '%a' "$ENV_FILE")" != "600" ]; then
  warn "$ENV_FILE debería tener permisos 600"
fi
grep -q '__GENERAR__' "$ENV_FILE" && die "$ENV_FILE contiene valores __GENERAR__ sin completar"
require docker curl
export DEVHUB_ENV_FILE="$ENV_FILE"

deploy() {
  local tag="${TAG:-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo latest)}"
  if ! $SKIP_BUILD; then
    "$REPO_ROOT/scripts/build.sh" --tag "$tag" >/dev/null
  fi
  export DEVHUB_BACKEND_IMAGE="devhub-backend:$tag" DEVHUB_FRONTEND_IMAGE="devhub-frontend:$tag"
  docker image inspect "$DEVHUB_BACKEND_IMAGE" >/dev/null 2>&1 || die "No existe la imagen $DEVHUB_BACKEND_IMAGE"

  "$REPO_ROOT/scripts/migrate.sh"

  local profiles=()
  if $TUNNEL; then
    grep -qE '^CLOUDFLARE_TUNNEL_TOKEN=.+' "$ENV_FILE" || die "--tunnel requiere CLOUDFLARE_TUNNEL_TOKEN en $ENV_FILE"
    load_env_file "$ENV_FILE"  # compose needs it for interpolation
    profiles=(--profile tunnel)
  fi
  log "Iniciando servicios ($tag)"
  docker compose -f "$COMPOSE_A" --env-file "$ENV_FILE" "${profiles[@]}" up -d --remove-orphans --wait --wait-timeout 180
  local port
  port="$(grep -E '^PROXY_LOCAL_PORT=' "$ENV_FILE" | cut -d= -f2)"
  "$REPO_ROOT/scripts/healthcheck.sh" "http://127.0.0.1:${port:-8080}/api/v1/health/" --retries 10 --wait 3 \
    || die "El despliegue no superó el health check"
  ok "Despliegue $tag completado"
}

with_lock deploy deploy
