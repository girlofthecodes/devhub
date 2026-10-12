import pytest

from apps.audit import services as audit
from apps.audit.models import AuditAction, AuditLog, ImmutableRecordError
from apps.users.roles import Role
from common.sanitize import REDACTED, sanitize

pytestmark = pytest.mark.django_db


def test_audit_log_is_immutable(admin_user):
    log = audit.record(AuditAction.USER_UPDATED, actor=admin_user, target=admin_user)
    log.action = "TAMPERED"
    with pytest.raises(ImmutableRecordError):
        log.save()
    with pytest.raises(ImmutableRecordError):
        log.delete()
    with pytest.raises(ImmutableRecordError):
        AuditLog.objects.all().update(action="X")
    with pytest.raises(ImmutableRecordError):
        AuditLog.objects.all().delete()


def test_audit_record_sanitizes_secrets(admin_user):
    log = audit.record(
        AuditAction.USER_UPDATED,
        actor=admin_user,
        changes={"password": "hunter2", "nested": {"api_key": "abc", "ok": "visible"}},
        metadata={"url": "postgresql://u:p@host/db", "authorization": "Bearer x"},
    )
    assert log.changes["password"] == REDACTED
    assert log.changes["nested"] == {"api_key": REDACTED, "ok": "visible"}
    assert log.metadata == {"url": REDACTED, "authorization": REDACTED}


def test_sanitize_handles_depth_and_types():
    deep: dict = {}
    cursor = deep
    for _ in range(10):
        cursor["n"] = {}
        cursor = cursor["n"]
    result = sanitize(deep)
    assert "[TRUNCATED]" in str(result)
    assert sanitize({"token_count": 3}) == {"token_count": REDACTED}
    assert sanitize([1, True, None, "ghp_" + "a" * 30]) == [1, True, None, REDACTED]


def test_audit_endpoint_admin_only(as_user, admin_user, make_user):
    audit.record(AuditAction.USER_UPDATED, actor=admin_user, target=admin_user)
    assert as_user(make_user(Role.DEVELOPER)).get("/api/v1/audit-logs/").status_code == 403
    res = as_user(admin_user).get("/api/v1/audit-logs/", {"action": "USER_UPDATED"})
    assert res.status_code == 200
    assert res.data["count"] == 1
    assert res.data["results"][0]["action_label"] == "Usuario actualizado"


def test_audit_endpoint_is_read_only(as_user, admin_user):
    client = as_user(admin_user)
    assert client.post("/api/v1/audit-logs/", {"action": "X"}).status_code == 405


def test_health_endpoint(api_client):
    res = api_client.get("/api/v1/health/")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "database": "ok"}
    assert res["X-Request-ID"]


def test_request_id_is_propagated(api_client):
    res = api_client.get("/api/v1/health/", HTTP_X_REQUEST_ID="abc12345-trace")
    assert res["X-Request-ID"] == "abc12345-trace"
    res = api_client.get("/api/v1/health/", HTTP_X_REQUEST_ID="bad id with spaces")
    assert res["X-Request-ID"] != "bad id with spaces"


def test_openapi_schema_generates(as_user, admin_user):
    res = as_user(admin_user).get("/api/v1/schema/", HTTP_ACCEPT="application/json")
    assert res.status_code == 200


def test_openapi_schema_requires_auth_outside_local(api_client):
    assert api_client.get("/api/v1/schema/").status_code == 403
