"""Settings read from the environment (run in a subprocess so the test settings stay intact)."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
SNIPPET = (
    "import json; from config.settings import base; "
    "d = base.DATABASES['default']; "
    "print(json.dumps({k: d[k] for k in ('NAME', 'USER', 'PASSWORD', 'HOST', 'PORT')} "
    "| {'sslmode': d['OPTIONS']['sslmode']}))"
)


def load_db(**env) -> dict:
    clean = {k: v for k, v in os.environ.items() if not k.startswith(("POSTGRES_", "DATABASE_"))}
    clean.update(DJANGO_SECRET_KEY="x" * 60, **env)
    out = subprocess.run(  # noqa: S603 - fixed interpreter and code
        [sys.executable, "-c", SNIPPET],
        cwd=BACKEND,
        env=clean,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(out.stdout)


def test_database_url_takes_precedence_and_is_decoded():
    db = load_db(
        POSTGRES_HOST="ignored",
        DATABASE_URL="postgresql://u%40ser:p%40ss%3Aw%2Frd@db.internal:6543/app_db?sslmode=require",
    )
    assert db == {
        "NAME": "app_db",
        "USER": "u@ser",
        "PASSWORD": "p@ss:w/rd",
        "HOST": "db.internal",
        "PORT": "6543",
        "sslmode": "require",
    }


@pytest.mark.parametrize("url", ["", None])
def test_postgres_variables_without_database_url(url):
    env = {"POSTGRES_HOST": "10.8.0.2", "POSTGRES_DB": "devhub", "DB_SSLMODE": "verify-full"}
    if url is not None:
        env["DATABASE_URL"] = url
    db = load_db(**env)
    assert db["HOST"] == "10.8.0.2" and db["PORT"] == "5432" and db["sslmode"] == "verify-full"


def test_database_url_without_port_or_sslmode_uses_defaults():
    db = load_db(DATABASE_URL="postgres://u:p@host/db", DB_SSLMODE="prefer")
    assert db["PORT"] == "5432" and db["sslmode"] == "prefer"
