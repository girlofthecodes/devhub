#!/usr/bin/env bash
# Shared helpers for DevHub operation scripts. Source it; do not execute.
# shellcheck disable=SC2034

# `pwd -W` (Git Bash on Windows) yields C:/... paths that docker.exe understands.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && { pwd -W 2>/dev/null || pwd; })"
COMPOSE_A="$REPO_ROOT/infrastructure/compose/server-a.compose.yaml"
COMPOSE_B="$REPO_ROOT/infrastructure/compose/server-b.compose.yaml"

if [ -t 2 ]; then
  _c_red=$'\033[31m' _c_grn=$'\033[32m' _c_yel=$'\033[33m' _c_dim=$'\033[2m' _c_off=$'\033[0m'
else
  _c_red="" _c_grn="" _c_yel="" _c_dim="" _c_off=""
fi

log()  { printf '%s[%s]%s %s\n' "$_c_dim" "$(date '+%Y-%m-%d %H:%M:%S')" "$_c_off" "$*" >&2; }
ok()   { printf '%s✔%s %s\n' "$_c_grn" "$_c_off" "$*" >&2; }
warn() { printf '%s!%s %s\n' "$_c_yel" "$_c_off" "$*" >&2; }
die()  { printf '%s✘ %s%s\n' "$_c_red" "$*" "$_c_off" >&2; exit 1; }

require() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "Falta el comando requerido: $cmd"
  done
}

# Load KEY=VALUE pairs from an env file without executing it (no `source`).
load_env_file() {
  local file="$1" line key value
  [ -f "$file" ] || die "No existe el archivo de entorno: $file"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    case "$line" in *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "$key=$value"
  done < "$file"
}

# Ask for an exact confirmation phrase unless --yes was given. Fails closed without a TTY.
confirm_phrase() {
  local phrase="$1" assume_yes="${2:-false}" answer
  if [ "$assume_yes" = "true" ]; then
    warn "Confirmación omitida con --yes."
    return 0
  fi
  [ -t 0 ] || die "Se requiere confirmación interactiva (o --yes). Operación cancelada."
  printf 'Escribe exactamente «%s» para continuar: ' "$phrase" >&2
  IFS= read -r answer
  [ "$answer" = "$phrase" ] || die "Confirmación incorrecta. Operación cancelada."
}

# Random string of length N from a tr(1) charset. Reads a finite chunk of /dev/urandom so
# no pipe is cut early (`tr < /dev/urandom | head` dies with SIGPIPE under `set -o pipefail`).
random_string() {
  local length="$1" charset="${2:-A-Za-z0-9}" pool=""
  while [ "${#pool}" -lt "$length" ]; do
    pool+="$(LC_ALL=C tr -dc "$charset" < <(head -c 1024 /dev/urandom))"
  done
  printf '%s' "${pool:0:$length}"
}

# Run with an exclusive lock so concurrent executions do not overlap.
with_lock() {
  local name="$1"; shift
  local lockfile="${TMPDIR:-/tmp}/devhub-${name}.lock"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$lockfile"
    flock -n 9 || die "Otra ejecución de «$name» está en curso."
  fi
  "$@"
}
