"""Append-only protection for trace events (function defined in audit 0003)."""

from django.db import migrations

TRIGGER_SQL = """
CREATE TRIGGER traceability_event_append_only
BEFORE UPDATE OR DELETE ON traceability_event
FOR EACH ROW EXECUTE FUNCTION devhub_protect_append_only(
    'project_id', 'environment_id', 'deployment_id', 'actor_id'
);
"""


class Migration(migrations.Migration):
    dependencies = [
        ("traceability", "0001_initial"),
        ("audit", "0003_append_only_trigger"),
    ]

    operations = [
        migrations.RunSQL(
            TRIGGER_SQL,
            "DROP TRIGGER IF EXISTS traceability_event_append_only ON traceability_event;",
        ),
    ]
