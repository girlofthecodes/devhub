"""Database-level protection for append-only tables (audit log, trace events).

- UPDATE is rejected unless the only change is a whitelisted FK column becoming NULL
  (needed by ON DELETE SET NULL when a referenced row is removed).
- DELETE is rejected unless the session sets `devhub.allow_purge = on`, which only the
  `purge_history` retention command does, inside its own transaction.
"""

from django.db import migrations

FUNCTION_SQL = r"""
CREATE OR REPLACE FUNCTION devhub_protect_append_only() RETURNS trigger AS $$
DECLARE
    col text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        FOREACH col IN ARRAY TG_ARGV LOOP
            IF (to_jsonb(NEW) ->> col) IS NOT NULL
               AND (to_jsonb(NEW) ->> col) IS DISTINCT FROM (to_jsonb(OLD) ->> col) THEN
                RAISE EXCEPTION 'append-only table %: column % may only be set to NULL',
                    TG_TABLE_NAME, col USING ERRCODE = 'insufficient_privilege';
            END IF;
        END LOOP;
        IF (to_jsonb(NEW) - TG_ARGV) IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV) THEN
            RAISE EXCEPTION 'append-only table %: UPDATE not allowed', TG_TABLE_NAME
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF current_setting('devhub.allow_purge', true) = 'on' THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'append-only table %: DELETE not allowed (use purge_history)', TG_TABLE_NAME
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
"""

AUDIT_TRIGGER_SQL = """
CREATE TRIGGER audit_auditlog_append_only
BEFORE UPDATE OR DELETE ON audit_auditlog
FOR EACH ROW EXECUTE FUNCTION devhub_protect_append_only('actor_id');
"""


class Migration(migrations.Migration):
    dependencies = [("audit", "0002_initial")]

    operations = [
        migrations.RunSQL(FUNCTION_SQL, "DROP FUNCTION IF EXISTS devhub_protect_append_only() CASCADE;"),
        migrations.RunSQL(
            AUDIT_TRIGGER_SQL,
            "DROP TRIGGER IF EXISTS audit_auditlog_append_only ON audit_auditlog;",
        ),
    ]
