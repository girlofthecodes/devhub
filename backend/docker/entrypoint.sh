#!/bin/sh
# DevHub backend entrypoint.
#  - Waits (bounded) for PostgreSQL, which may be on another host over the VPN.
#  - Applies migrations and creates the cache table when RUN_MIGRATIONS=true.
#  - Creates the initial admin when BOOTSTRAP_ADMIN=true and credentials are set.
set -eu

DB_WAIT_SECONDS="${DB_WAIT_SECONDS:-60}"

echo "[entrypoint] Waiting for database (max ${DB_WAIT_SECONDS}s)..."
python - <<'PY'
import os, sys, time
import psycopg

deadline = time.monotonic() + int(os.environ.get("DB_WAIT_SECONDS", "60"))
params = dict(
    dbname=os.environ.get("POSTGRES_DB", "devhub"),
    user=os.environ.get("POSTGRES_USER", "devhub"),
    password=os.environ.get("POSTGRES_PASSWORD", ""),
    host=os.environ.get("POSTGRES_HOST", "localhost"),
    port=os.environ.get("POSTGRES_PORT", "5432"),
    connect_timeout=int(os.environ.get("DB_CONNECT_TIMEOUT", "5")),
)
while True:
    try:
        psycopg.connect(**params).close()
        print("[entrypoint] Database is reachable.")
        break
    except psycopg.OperationalError as exc:
        if time.monotonic() > deadline:
            print(f"[entrypoint] Database unreachable: {exc.__class__.__name__}", file=sys.stderr)
            sys.exit(1)
        time.sleep(2)
PY

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] Applying migrations..."
  python manage.py migrate --noinput
  python manage.py createcachetable
fi

if [ "${BOOTSTRAP_ADMIN:-false}" = "true" ] && [ -n "${DJANGO_ADMIN_EMAIL:-}" ] && [ -n "${DJANGO_ADMIN_PASSWORD:-}" ]; then
  python manage.py bootstrap_admin
fi

exec "$@"
