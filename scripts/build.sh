#!/usr/bin/env bash
# Build the production images (backend + frontend), tagged with the git commit and "latest".
#   scripts/build.sh [--tag TAG]
set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

TAG="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)"
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done
[[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]] || die "Etiqueta no válida: $TAG"
require docker

if git -C "$REPO_ROOT" rev-parse >/dev/null 2>&1 && [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  warn "Hay cambios sin commit: la imagen $TAG no corresponde exactamente a un commit"
fi
for app in backend frontend; do
  log "Construyendo devhub-$app:$TAG"
  docker build --target prod --pull -t "devhub-$app:$TAG" -t "devhub-$app:latest" \
    --label "org.opencontainers.image.revision=$TAG" "$REPO_ROOT/$app"
  ok "devhub-$app:$TAG"
done
echo "$TAG"
