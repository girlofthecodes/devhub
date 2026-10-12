from datetime import timedelta
from io import StringIO
from unittest import mock

import pytest
from django.core.management import CommandError, call_command
from django.db import DatabaseError, connection, transaction
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditAction, AuditLog, ImmutableRecordError
from apps.infrastructure.models import Environment
from apps.projects.models import ProjectMember
from apps.traceability import services as trace
from apps.traceability.models import Event, EventType
from apps.users.roles import Role

pytestmark = pytest.mark.django_db

EVENTS = "/api/v1/events/"


# --- emission from business services --------------------------------------------------


def test_project_lifecycle_emits_events(as_user, admin_user, developer, make_org):
    client = as_user(admin_user)
    project = client.post("/api/v1/projects/", {"name": "Trazado", "owner": str(developer.id)}).data
    client.patch(f"/api/v1/projects/{project['id']}/", {"status": "DEVELOPMENT"})
    org = make_org("Acme")
    grant = client.post(
        "/api/v1/project-access/", {"project": project["id"], "organization": str(org.id)}
    ).data
    client.post(f"/api/v1/project-access/{grant['id']}/revoke/")
    client.post(
        "/api/v1/environments/",
        {"project": project["id"], "kind": "DEMO", "public_url": "https://demo.example.com"},
    )
    types = list(
        Event.objects.filter(project_id=project["id"])
        .order_by("occurred_at")
        .values_list("event_type", flat=True)
    )
    assert types == [
        EventType.PROJECT_CREATED,
        EventType.PROJECT_UPDATED,
        EventType.ACCESS_GRANTED,
        EventType.ACCESS_REVOKED,
        EventType.CONFIGURATION_CHANGED,
    ]
    revoked = Event.objects.get(project_id=project["id"], event_type=EventType.ACCESS_REVOKED)
    assert revoked.severity == "WARNING"
    assert revoked.actor == admin_user and revoked.source == "USER"
    # Request correlation id is propagated when no explicit correlation is given.
    assert revoked.correlation_id


def test_event_metadata_is_sanitized(make_project):
    event = trace.emit(
        EventType.CONFIGURATION_CHANGED,
        description="x",
        project=make_project(),
        metadata={"token": "abc", "db": "postgresql://u:p@h/db", "ok": 1},
    )
    assert event.metadata == {"token": "[REDACTED]", "db": "[REDACTED]", "ok": 1}


def test_unknown_event_type_rejected():
    with pytest.raises(ValueError):
        trace.emit("HACKED", description="x")


# --- immutability ---------------------------------------------------------------------


def test_events_immutable_in_django(make_project):
    event = trace.emit(EventType.PROJECT_UPDATED, description="x", project=make_project())
    event.description = "changed"
    with pytest.raises(ImmutableRecordError):
        event.save()
    with pytest.raises(ImmutableRecordError):
        event.delete()
    with pytest.raises(ImmutableRecordError):
        Event.objects.all().update(description="y")
    with pytest.raises(ImmutableRecordError):
        Event.objects.all().delete()


@pytest.mark.parametrize(
    ("table", "sql"),
    [
        ("traceability_event", "UPDATE traceability_event SET description = 'tampered'"),
        ("traceability_event", "DELETE FROM traceability_event"),
        ("audit_auditlog", "UPDATE audit_auditlog SET action = 'X'"),
        ("audit_auditlog", "DELETE FROM audit_auditlog"),
    ],
)
def test_database_trigger_blocks_raw_sql_tampering(make_project, admin_user, table, sql):
    trace.emit(EventType.PROJECT_UPDATED, description="x", project=make_project())
    audit.record(AuditAction.USER_UPDATED, actor=admin_user, target=admin_user)
    with (
        pytest.raises(DatabaseError, match="append-only"),
        transaction.atomic(),
        connection.cursor() as cursor,
    ):
        cursor.execute(sql)


def test_trigger_allows_fk_set_null_but_not_reassignment(make_project, make_user):
    actor = make_user(Role.ADMIN)
    other = make_user(Role.ADMIN)
    trace.emit(EventType.PROJECT_UPDATED, description="x", project=make_project(), actor=actor)
    with (
        pytest.raises(DatabaseError, match="may only be set to NULL"),
        transaction.atomic(),
        connection.cursor() as cursor,
    ):
        cursor.execute("UPDATE traceability_event SET actor_id = %s", [other.pk])
    # Deleting the referenced user nulls the FK (ON DELETE SET NULL) and must work.
    actor.delete()
    event = Event.objects.get()
    assert event.actor_id is None and event.actor_label == actor.email


# --- retention ------------------------------------------------------------------------


def test_purge_history_respects_retention(make_project, admin_user):
    project = make_project()
    old = trace.emit(
        EventType.PROJECT_UPDATED,
        description="viejo",
        project=project,
        occurred_at=timezone.now() - timedelta(days=400),
    )
    recent = trace.emit(EventType.PROJECT_UPDATED, description="nuevo", project=project)
    audit.record(AuditAction.USER_UPDATED, actor=admin_user, target=admin_user)

    out = StringIO()
    call_command("purge_history", "--events-days", "365", "--dry-run", stdout=out)
    assert "'eventos': 1" in out.getvalue()
    assert Event.objects.filter(pk=old.pk).exists()

    call_command("purge_history", "--events-days", "365", "--audit-days", "730", stdout=StringIO())
    assert not Event.objects.filter(pk=old.pk).exists()
    assert Event.objects.filter(pk=recent.pk).exists()
    assert AuditLog.objects.count() == 1

    future = timezone.now() + timedelta(days=800)
    with mock.patch("django.utils.timezone.now", return_value=future):
        call_command("purge_history", "--audit-days", "730", stdout=StringIO())
    assert AuditLog.objects.count() == 0


def test_purge_history_minimum_retention():
    with pytest.raises(CommandError):
        call_command("purge_history", "--events-days", "5", stdout=StringIO())


# --- API: timeline, filters, scoping --------------------------------------------------


def test_timeline_filters(as_user, admin_user, make_project):
    project = make_project("Uno")
    env = Environment.objects.create(project=project, kind="DEMO")
    trace.emit(
        EventType.DEPLOYMENT_FAILED,
        description="falló",
        environment=env,
        severity="ERROR",
        correlation_id="dep-1",
    )
    trace.emit(
        EventType.DEPLOYMENT_STARTED, description="inició", environment=env, correlation_id="dep-1"
    )
    trace.emit(
        EventType.PROJECT_UPDATED,
        description="otro",
        project=make_project("Dos"),
        occurred_at=timezone.now() - timedelta(days=3),
    )
    client = as_user(admin_user)

    res = client.get(EVENTS)
    assert res.data["count"] == 3
    assert res.data["results"][0]["occurred_at"] >= res.data["results"][1]["occurred_at"]
    assert client.get(EVENTS, {"project": str(project.id)}).data["count"] == 2
    assert client.get(EVENTS, {"severity": "ERROR,CRITICAL"}).data["count"] == 1
    assert (
        client.get(EVENTS, {"event_type": "DEPLOYMENT_STARTED,DEPLOYMENT_FAILED"}).data["count"]
        == 2
    )
    assert client.get(EVENTS, {"correlation_id": "dep-1"}).data["count"] == 2
    since = (timezone.now() - timedelta(days=1)).isoformat()
    assert client.get(EVENTS, {"occurred_from": since}).data["count"] == 2
    assert client.get(EVENTS, {"search": "falló"}).data["count"] == 1
    assert client.get(EVENTS, {"page_size": 1}).data["next"]
    res = client.get(EVENTS, {"severity": "PANIC"})
    assert res.status_code == 400


def test_events_scoped_for_developers(as_user, developer, make_user, make_project):
    mine = make_project("Mio", owner=developer)
    assigned = make_project("Asignado")
    ProjectMember.objects.create(project=assigned, user=developer)
    other = make_project("Ajeno")
    for p in (mine, assigned, other):
        trace.emit(EventType.PROJECT_UPDATED, description=p.name, project=p)
    trace.emit(EventType.CONFIGURATION_CHANGED, description="interno sin proyecto")
    res = as_user(developer).get(EVENTS)
    assert sorted(e["description"] for e in res.data["results"]) == ["Asignado", "Mio"]
    hidden = Event.objects.get(description="Ajeno")
    assert as_user(developer).get(f"{EVENTS}{hidden.id}/").status_code == 404


def test_events_api_is_read_only(as_user, admin_user):
    client = as_user(admin_user)
    assert client.post(EVENTS, {"event_type": "PROJECT_CREATED"}).status_code == 405
