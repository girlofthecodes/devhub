#!/usr/bin/env bash
# Report a deployment to DevHub from CI/CD (GitHub Actions or any shell).
#
#   devhub-deploy-report.sh start  --project <slug> --environment <DEVELOPMENT|DEMO|PRODUCTION> \
#                                  --version <v> [--status PENDING|RUNNING] [--message <m>]
#   devhub-deploy-report.sh finish --id <deployment-id> --status <SUCCESS|FAILED|CANCELLED> \
#                                  [--message <m>]
#
# Required environment:
#   DEVHUB_URL    Base URL of DevHub, e.g. https://devhub.example.com
#   DEVHUB_TOKEN  Service token (dhs_…) scoped to the project. Store it as a CI secret.
#
# Inside GitHub Actions the commit, branch, run id/url and actor are taken from the
# standard GITHUB_* variables; they can be overridden with --commit/--branch/--run-id/
# --run-url/--actor. `start` prints the deployment id on stdout (use it for `finish`).
# The token is never printed.
set -euo pipefail
# This script handles a secret: never trace it, even if invoked with `bash -x`.
{ set +x; } 2>/dev/null

die() { echo "devhub-deploy-report: $*" >&2; exit 1; }
usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

command -v curl >/dev/null || die "curl no está instalado"
PY=""
# Pick the first interpreter that actually runs (on Windows `python3` may be a Store stub).
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import json' >/dev/null 2>&1; then
    PY="$candidate"; break
  fi
done
[ -n "$PY" ] || die "se requiere python3 para construir y leer JSON"

[ $# -ge 1 ] || usage
ACTION="$1"; shift

PROJECT="" ENVIRONMENT="" VERSION="" STATUS="" MESSAGE="" DEPLOYMENT_ID=""
COMMIT="${GITHUB_SHA:-}"
BRANCH="${GITHUB_REF_NAME:-}"
RUN_ID="${GITHUB_RUN_ID:+${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}}"
RUN_URL=""
if [ -n "${GITHUB_RUN_ID:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
  RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
fi
ACTOR="${GITHUB_ACTOR:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --environment) ENVIRONMENT="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --status) STATUS="${2:-}"; shift 2 ;;
    --message) MESSAGE="${2:-}"; shift 2 ;;
    --id) DEPLOYMENT_ID="${2:-}"; shift 2 ;;
    --commit) COMMIT="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --run-url) RUN_URL="${2:-}"; shift 2 ;;
    --actor) ACTOR="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) die "argumento desconocido: $1" ;;
  esac
done

[ -n "${DEVHUB_URL:-}" ] || die "define DEVHUB_URL"
[ -n "${DEVHUB_TOKEN:-}" ] || die "define DEVHUB_TOKEN (secreto del CI)"
BASE="${DEVHUB_URL%/}/api/v1/integrations/deployments"

json() {
  # Build a JSON object from KEY=VALUE pairs, skipping empty values (safe escaping).
  "$PY" -c 'import json,sys; print(json.dumps({k:v for k,v in (a.split("=",1) for a in sys.argv[1:]) if v}))' "$@"
}

post() {
  local url="$1" body="$2" out code
  out="$(mktemp)"
  # The Authorization header goes through stdin (`-H @-`; printf is a builtin), so the
  # token never appears in the process list or in shell traces.
  code="$(printf 'Authorization: Bearer %s\n' "$DEVHUB_TOKEN" | \
    curl -sS -o "$out" -w '%{http_code}' --max-time 20 --retry 3 --retry-connrefused \
      -X POST "$url" -H 'Content-Type: application/json' -H @- \
      --data "$body")" || { rm -f "$out"; die "no se pudo contactar con DevHub"; }
  if [ "${code:0:1}" != "2" ]; then
    detail="$("$PY" -c 'import json,sys; d=json.load(open(sys.argv[1], encoding="utf-8")); print(d.get("detail",""), d.get("fields",""))' "$out" 2>/dev/null || true)"
    rm -f "$out"
    die "DevHub respondió HTTP $code: $detail"
  fi
  cat "$out"; rm -f "$out"
}

case "$ACTION" in
  start)
    if [ -z "$PROJECT" ] || [ -z "$ENVIRONMENT" ] || [ -z "$VERSION" ]; then
      die "start requiere --project, --environment y --version"
    fi
    body="$(json project="$PROJECT" environment="$ENVIRONMENT" version="$VERSION" \
      status="${STATUS:-RUNNING}" message="$MESSAGE" commit_sha="$COMMIT" branch="$BRANCH" \
      ci_run_id="$RUN_ID" ci_run_url="$RUN_URL" triggered_by="$ACTOR")"
    response="$(post "$BASE/" "$body")"
    "$PY" -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["id"]); sys.stderr.write("devhub: despliegue %s -> %s/%s [%s]\n" % (d["version"], d["project_slug"], d["environment_kind"], d["status"]))' "$response"
    ;;
  finish)
    if [ -z "$DEPLOYMENT_ID" ] || [ -z "$STATUS" ]; then
      die "finish requiere --id y --status"
    fi
    body="$(json status="$STATUS" message="$MESSAGE")"
    response="$(post "$BASE/$DEPLOYMENT_ID/status/" "$body")"
    "$PY" -c 'import json,sys; d=json.loads(sys.argv[1]); sys.stderr.write("devhub: despliegue %s [%s]\n" % (d["version"], d["status"]))' "$response"
    ;;
  *) usage ;;
esac
