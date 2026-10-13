from datetime import timedelta
from io import StringIO
from unittest import mock

import pytest
from django.core.management import call_command
from django.db import OperationalError
from django.utils import timezone

from apps.infrastructure.models import Environment, Server
from apps.monitoring import probe, services
from apps.monitoring.models import CheckResult, HealthCheck, HealthStatus
from apps.projects.models import ProjectAccess, ProjectMember, ProjectStatus
from apps.traceability.models import Event, EventType
from apps.users.roles import Role
from common.exceptions import DomainError

pytestmark = pytest.mark.django_db

CHECKS = "/api/v1/health-checks/"
OK = probe.ProbeResult(True, 200, 120)
SLOW = probe.ProbeResult(True, 200, 5000)
DOWN = probe.ProbeResult(False, None, None, "Conexión fallida: ConnectionRefusedError")


@pytest.fixture
def env(make_project, developer):
    server = Server.objects.create(name="A", identifier="srv-a")
    project = make_project("Pedidos", owner=developer)
    return Environment.objects.create(
        project=project, kind="PRODUCTION", public_url="https://app.example.com", server=server
    )


@pytest.fixture
def check(env):
    return HealthCheck.objects.create(environment=env, path="/health")


def public(host, port):
    return ["93.184.215.14"]


# --- SSRF protections ------------------------------------------------------------------


@pytest.mark.parametrize(
    "addresses",
    [
        ["10.0.0.5"],
        ["127.0.0.1"],
        ["169.254.169.254"],
        ["100.64.1.2"],
        ["::1"],
        ["::ffff:192.168.1.1"],
        ["fd00::1"],
        ["93.184.215.14", "192.168.0.10"],
        ["0.0.0.0"],
        ["224.0.0.1"],
    ],
)
def test_probe_refuses_targets_resolving_to_internal_addresses(addresses):
    with pytest.raises(probe.ProbeRefused):
        probe.resolve_target("https://app.example.com/health", resolver=lambda h, p: addresses)


@pytest.mark.parametrize(
    "url",
    [
        "http://app.example.com/",
        "https://10.0.0.1/",
        "https://localhost/",
        "https://app.example.com:22/",
        "https://user:pw@app.example.com/",
    ],
)
def test_probe_refuses_disallowed_urls(url):
    with pytest.raises(probe.ProbeRefused):
        probe.resolve_target(url, resolver=public)


def test_probe_accepts_public_targets_and_keeps_query():
    host, port, path, ip = probe.resolve_target(
        "https://app.example.com/health?full=1", resolver=public
    )
    assert (host, port, path, ip) == ("app.example.com", 443, "/health?full=1", "93.184.215.14")


def test_probe_connects_to_the_vetted_ip_not_a_second_resolution():
    """DNS-rebinding defense: the socket goes to the IP checked earlier."""
    seen = {}

    def fake_connect(address, timeout=None):
        seen["address"] = address
        raise ConnectionRefusedError

    with mock.patch("apps.monitoring.probe.socket.create_connection", side_effect=fake_connect):
        result = probe.probe("https://app.example.com/health", timeout=2, resolver=public)
    assert seen["address"] == ("93.184.215.14", 443)
    assert result.ok_connection is False and "Conexión fallida" in result.error


@pytest.mark.parametrize(
    "path", ["health", "//evil.com", "/../etc", "/a b", "/x#y", "/" + "a" * 250]
)
def test_invalid_paths(path):
    with pytest.raises(ValueError):
        probe.validate_path(path)


# --- transitions & events ------------------------------------------------------------


def test_status_transitions_and_trace_events(check):
    services.record_result(check.pk, OK)
    check.refresh_from_db()
    assert check.status == HealthStatus.HEALTHY and check.last_response_ms == 120

    services.record_result(check.pk, SLOW)
    check.refresh_from_db()
    assert check.status == HealthStatus.DEGRADED and "lenta" in check.last_error

    services.record_result(check.pk, DOWN)  # 1st failure → degraded (anti-flapping)
    check.refresh_from_db()
    assert check.status == HealthStatus.DEGRADED and check.consecutive_failures == 1
    assert not Event.objects.filter(event_type=EventType.SERVICE_UNAVAILABLE).exists()

    services.record_result(check.pk, DOWN)  # 2nd → unavailable + event
    services.record_result(check.pk, DOWN)  # stays down, no duplicate event
    check.refresh_from_db()
    assert check.status == HealthStatus.UNAVAILABLE
    down = Event.objects.filter(event_type=EventType.SERVICE_UNAVAILABLE)
    assert down.count() == 1
    assert down.get().severity == "CRITICAL" and down.get().source == "MONITORING"

    later = timezone.now() + timedelta(minutes=10)
    services.record_result(check.pk, OK, at=later)
    check.refresh_from_db()
    assert check.status == HealthStatus.HEALTHY and check.consecutive_failures == 0
    recovered = Event.objects.get(event_type=EventType.SERVICE_RECOVERED)
    assert recovered.metadata["downtime_seconds"] >= 590
    assert CheckResult.objects.filter(health_check=check).count() == 6
    assert Server.objects.get().last_checked_at is not None


def test_unexpected_status_code_counts_as_failure(check):
    services.record_result(check.pk, probe.ProbeResult(True, 503, 80))
    check.refresh_from_db()
    assert check.status == HealthStatus.DEGRADED and "503" in check.last_error


def test_refused_target_is_reported_not_contacted(check):
    def refusing(url, timeout):
        raise probe.ProbeRefused("El destino resuelve a una dirección interna o reservada.")

    result = services.execute(check, prober=refusing)
    assert result.ok_connection is False and result.error.startswith("Destino rechazado")


def test_due_checks_respect_interval_and_state(check, make_project):
    assert list(services.due_checks()) == [check]
    services.record_result(check.pk, OK)
    assert list(services.due_checks()) == []
    assert list(
        services.due_checks(timezone.now() + timedelta(seconds=check.interval_seconds + 1))
    ) == [check]
    check.enabled = False
    check.save()
    assert list(services.due_checks(timezone.now() + timedelta(days=1))) == []
    check.enabled = True
    check.save()
    check.environment.status = "INACTIVE"
    check.environment.save()
    assert list(services.due_checks(timezone.now() + timedelta(days=1))) == []


def test_stale_results_are_shown_as_unknown(check):
    services.record_result(check.pk, OK, at=timezone.now() - timedelta(hours=2))
    check.refresh_from_db()
    assert check.is_stale and check.effective_status == HealthStatus.UNKNOWN
    availability = services.availability_for_project(check.environment.project)
    assert (
        availability["status"] == "UNKNOWN"
        and availability["label"] == "Verificación desactualizada"
    )


# --- portal availability ---------------------------------------------------------------


def test_portal_shows_real_availability(as_user, check, make_user, make_org):
    alice = make_user(Role.CLIENT)
    org = make_org("Acme", members=(alice,))
    ProjectAccess.objects.create(project=check.environment.project, organization=org)
    client = as_user(alice)
    pid = check.environment.project_id
    assert (
        client.get(f"/api/v1/portal/projects/{pid}/").data["availability"]["label"]
        == "Pendiente de verificar"
    )
    services.record_result(check.pk, OK)
    data = client.get(f"/api/v1/portal/projects/{pid}/").data["availability"]
    assert data["status"] == "HEALTHY" and data["label"] == "Disponible" and data["checked_at"]


# --- API ----------------------------------------------------------------------------------


def test_create_check_via_api(as_user, developer, env):
    res = as_user(developer).post(
        CHECKS, {"environment": str(env.id), "path": "/health", "interval_seconds": 120}
    )
    assert res.status_code == 201, res.data
    assert res.data["target_url"] == "https://app.example.com/health"
    assert res.data["effective_status"] == "UNKNOWN"
    assert res.data["effective_status_label"] == "Pendiente de verificar"
    assert Event.objects.filter(
        event_type=EventType.CONFIGURATION_CHANGED, description__contains="Health check"
    ).exists()


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"interval_seconds": 30}, "interval_too_short"),
        ({"interval_seconds": 60, "timeout_seconds": 60}, "invalid_timeout"),
        ({"path": "/../admin"}, "invalid_path"),
        ({"expected_status_min": 400, "expected_status_max": 300}, "invalid_range"),
    ],
)
def test_create_check_validation(as_user, developer, env, payload, code):
    res = as_user(developer).post(CHECKS, {"environment": str(env.id), **payload})
    assert res.status_code == 400 and res.data["code"] == code


def test_check_requires_public_url_and_is_unique(as_user, admin_user, env, make_project):
    client = as_user(admin_user)
    no_url = Environment.objects.create(project=make_project(), kind="DEMO")
    assert client.post(CHECKS, {"environment": str(no_url.id)}).data["code"] == "no_public_url"
    assert client.post(CHECKS, {"environment": str(env.id)}).status_code == 201
    assert client.post(CHECKS, {"environment": str(env.id)}).data["code"] == "duplicate"
    archived = Environment.objects.create(
        project=make_project(status=ProjectStatus.ARCHIVED),
        kind="DEMO",
        public_url="https://x.example.com",
    )
    assert client.post(CHECKS, {"environment": str(archived.id)}).data["code"] == "archived"


def test_monitoring_permissions(as_user, make_user, check, make_project):
    contributor = make_user(Role.DEVELOPER)
    ProjectMember.objects.create(
        project=check.environment.project, user=contributor, role="CONTRIBUTOR"
    )
    c = as_user(contributor)
    assert c.get(CHECKS).data["count"] == 1
    assert c.patch(f"{CHECKS}{check.id}/", {"interval_seconds": 600}).status_code == 403
    assert c.post(f"{CHECKS}{check.id}/run/").status_code == 403
    outsider = make_user(Role.DEVELOPER)
    assert as_user(outsider).get(f"{CHECKS}{check.id}/").status_code == 404
    for role in (Role.CLIENT, Role.VISITOR):
        client = as_user(make_user(role))
        assert client.get(CHECKS).status_code == 403
        assert client.get("/api/v1/monitoring/summary/").status_code == 403


def test_run_now_is_rate_limited(as_user, developer, check):
    client = as_user(developer)
    with mock.patch("apps.monitoring.services.probe_module.probe", return_value=OK):
        res = client.post(f"{CHECKS}{check.id}/run/")
        assert res.status_code == 200 and res.data["effective_status"] == "HEALTHY"
        res = client.post(f"{CHECKS}{check.id}/run/")
    assert res.status_code == 400 and res.data["code"] == "too_soon"


def test_results_uptime_and_summary(as_user, admin_user, check, make_project):
    for r in (OK, OK, DOWN, OK):
        services.record_result(check.pk, r)
    client = as_user(admin_user)
    res = client.get(f"{CHECKS}{check.id}/results/", {"hours": 24})
    assert [r["status"] for r in res.data] == ["HEALTHY", "HEALTHY", "DEGRADED", "HEALTHY"]
    data = client.get(f"{CHECKS}{check.id}/").data
    assert data["uptime_24h"] == 1.0  # degraded still counts as reachable
    Environment.objects.create(
        project=make_project(), kind="DEMO", public_url="https://demo.example.com"
    )
    summary = client.get("/api/v1/monitoring/summary/").data
    assert summary["total"] == 1 and summary["by_status"]["HEALTHY"] == 1
    assert summary["environments_without_check"] == 1


# --- worker -------------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_run_monitor_once(check, tmp_path):
    heartbeat = tmp_path / "beat"
    with mock.patch("apps.monitoring.services.probe_module.probe", return_value=OK):
        out = StringIO()
        call_command("run_monitor", "--once", "--heartbeat", str(heartbeat), stdout=out)
    check.refresh_from_db()
    assert check.status == HealthStatus.HEALTHY
    assert "1 verificación(es) ejecutada(s)" in out.getvalue()
    assert heartbeat.exists()


@pytest.mark.django_db(transaction=True)
def test_run_monitor_survives_probe_errors(check, tmp_path):
    with mock.patch("apps.monitoring.services.record_result", side_effect=RuntimeError("boom")):
        call_command("run_monitor", "--once", "--heartbeat", str(tmp_path / "b"), stdout=StringIO())


def test_purge_removes_old_results(check):
    services.record_result(check.pk, OK, at=timezone.now() - timedelta(days=40))
    services.record_result(check.pk, OK)
    call_command("purge_history", "--results-days", "30", stdout=StringIO())
    assert CheckResult.objects.count() == 1


# --- resilience ---------------------------------------------------------------------------


def test_database_outage_returns_503(as_user, admin_user):
    client = as_user(admin_user)
    with mock.patch(
        "apps.projects.views.ProjectViewSet.list",
        side_effect=OperationalError("connection refused"),
    ):
        res = client.get("/api/v1/projects/")
    assert res.status_code == 503 and res.data["code"] == "database_unavailable"


def test_disabled_check_reports_unknown(check):
    services.record_result(check.pk, OK)
    services.update_check(check, actor=None, data={"enabled": False})
    check.refresh_from_db()
    assert check.effective_status == HealthStatus.UNKNOWN
    with pytest.raises(DomainError):
        services.run_now(check)
