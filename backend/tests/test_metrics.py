"""Internal metrics (push), alerts and the per-project monitoring overview."""

from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.deployments.models import ServiceToken
from apps.infrastructure.models import Environment
from apps.monitoring import alerts, metrics, probe, services
from apps.monitoring.models import (
    Alert,
    AlertKind,
    AlertStatus,
    CheckResult,
    HealthCheck,
    HealthStatus,
    MetricSample,
)
from apps.projects.models import ProjectStatus
from apps.users.roles import Role

pytestmark = pytest.mark.django_db

INGEST = "/api/v1/integrations/metrics/"
ALERTS = "/api/v1/alerts/"
OVERVIEW = "/api/v1/monitoring/projects/"
OK = probe.ProbeResult(True, 200, 120)
SLOW = probe.ProbeResult(True, 200, 5000)
DOWN = probe.ProbeResult(False, None, None, "Conexión fallida: ConnectionRefusedError")


@pytest.fixture
def project(make_project, developer):
    return make_project("Pedidos", owner=developer)


@pytest.fixture
def env(project):
    return Environment.objects.create(
        project=project, kind="PRODUCTION", public_url="https://app.example.com"
    )


@pytest.fixture
def check(env):
    return HealthCheck.objects.create(environment=env, path="/health")


@pytest.fixture
def token(admin_user, project):
    raw, prefix, digest = ServiceToken.generate()
    t = ServiceToken.objects.create(
        name="agente", key_prefix=prefix, token_hash=digest, created_by=admin_user
    )
    t.projects.add(project)
    return raw


def bearer(raw):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
    return c


def push(raw, **values):
    payload = {"project": "pedidos", "environment": "PRODUCTION", **values}
    return bearer(raw).post(INGEST, payload, format="json")


def sample(env, at=None, **values):
    return metrics.ingest_sample(env, {"recorded_at": at, **values})


def active(env, kind):
    return Alert.objects.filter(environment=env, kind=kind).exclude(status=AlertStatus.RESOLVED)


# --- ingestion -------------------------------------------------------------------------


def test_ingest_requires_service_token(api_client, env, as_user, admin_user):
    assert api_client.post(INGEST, {}, format="json").status_code == 401
    # A logged-in user (session) is not a service token.
    assert as_user(admin_user).post(INGEST, {}, format="json").status_code in (401, 403)


def test_ingest_stores_sample(token, env):
    res = push(token, cpu_percent=42.5, memory_percent=61, requests_per_minute=120)
    assert res.status_code == 201, res.data
    s = MetricSample.objects.get()
    assert s.environment == env and s.cpu_percent == 42.5 and s.requests_per_minute == 120


def test_ingest_is_scoped_to_token_projects(token, env, make_project):
    other = make_project("Ajeno")
    Environment.objects.create(project=other, kind="PRODUCTION")
    res = bearer(token).post(
        INGEST, {"project": "ajeno", "environment": "PRODUCTION", "cpu_percent": 1}, format="json"
    )
    assert res.status_code == 404
    assert push(token, environment="DEMO", cpu_percent=1).status_code == 404


@pytest.mark.parametrize(
    "values",
    [
        {},
        {"cpu_percent": 101},
        {"error_rate_percent": -1},
        {"cpu_percent": 5, "recorded_at": "2000-01-01T00:00:00Z"},
    ],
)
def test_ingest_rejects_invalid_samples(token, env, values):
    assert push(token, **values).status_code == 400
    assert not MetricSample.objects.exists()


def test_ingest_rejects_future_timestamps(token, env):
    future = (timezone.now() + timedelta(hours=1)).isoformat()
    assert push(token, cpu_percent=5, recorded_at=future).status_code == 400


def test_ingest_refused_for_archived_project(token, env, project):
    project.status = ProjectStatus.ARCHIVED
    project.archived_at = timezone.now()
    project.save()
    assert push(token, cpu_percent=5).status_code == 400


# --- metric threshold alerts -----------------------------------------------------------


def test_threshold_alert_opens_escalates_and_resolves(env):
    now = timezone.now()
    sample(env, now - timedelta(minutes=3), cpu_percent=90)
    alert = active(env, AlertKind.HIGH_CPU).get()
    assert alert.severity == "WARNING" and alert.value == 90 and alert.threshold == 85

    sample(env, now - timedelta(minutes=2), cpu_percent=97)
    alert.refresh_from_db()
    assert alert.severity == "CRITICAL" and alert.hits == 2
    assert Alert.objects.filter(kind=AlertKind.HIGH_CPU).count() == 1  # refreshed, not duplicated

    sample(env, now - timedelta(minutes=1), cpu_percent=40)
    alert.refresh_from_db()
    assert alert.status == AlertStatus.RESOLVED and alert.resolved_at is not None


def test_each_metric_rule_is_independent(env):
    sample(env, error_rate_percent=20, latency_p95_ms=1000, memory_percent=50)
    assert active(env, AlertKind.HIGH_ERROR_RATE).get().severity == "CRITICAL"
    assert not active(env, AlertKind.HIGH_LATENCY).exists()
    assert not active(env, AlertKind.HIGH_MEMORY).exists()


def test_out_of_order_sample_does_not_change_alerts(env):
    now = timezone.now()
    sample(env, now, cpu_percent=99)
    sample(env, now - timedelta(minutes=5), cpu_percent=10)  # late, older sample
    assert active(env, AlertKind.HIGH_CPU).exists()


def test_stale_metrics_alert_opens_once_and_resolves_on_new_sample(env):
    now = timezone.now()
    MetricSample.objects.create(environment=env, recorded_at=now - timedelta(minutes=30))
    assert alerts.evaluate_stale_metrics(now) == 1
    assert alerts.evaluate_stale_metrics(now) == 0
    assert active(env, AlertKind.METRICS_STALE).count() == 1
    sample(env, now, cpu_percent=10)
    assert not active(env, AlertKind.METRICS_STALE).exists()


def test_never_reporting_environment_is_not_stale(env):
    assert alerts.evaluate_stale_metrics() == 0


# --- health-check alerts ---------------------------------------------------------------


def test_service_down_alert_follows_health_check(check):
    services.record_result(check.pk, DOWN)
    assert not active(check.environment, AlertKind.SERVICE_DOWN).exists()  # threshold 2
    assert active(check.environment, AlertKind.SLOW_RESPONSE).exists()  # degraded meanwhile
    services.record_result(check.pk, DOWN)
    down = active(check.environment, AlertKind.SERVICE_DOWN).get()
    assert down.severity == "CRITICAL"  # production
    assert not active(check.environment, AlertKind.SLOW_RESPONSE).exists()
    services.record_result(check.pk, OK)
    down.refresh_from_db()
    assert down.status == AlertStatus.RESOLVED
    assert not Alert.objects.exclude(status=AlertStatus.RESOLVED).exists()


def test_slow_response_alert(check):
    services.record_result(check.pk, SLOW)
    alert = active(check.environment, AlertKind.SLOW_RESPONSE).get()
    assert alert.severity == "WARNING" and alert.value == 5000
    services.record_result(check.pk, OK)
    assert not active(check.environment, AlertKind.SLOW_RESPONSE).exists()


def test_disabling_check_resolves_its_alerts(check, admin_user):
    services.record_result(check.pk, DOWN)
    services.record_result(check.pk, DOWN)
    services.update_check(check, actor=admin_user, data={"enabled": False})
    assert not Alert.objects.exclude(status=AlertStatus.RESOLVED).exists()


# --- alerts API ------------------------------------------------------------------------


@pytest.fixture
def open_alert(env):
    return alerts.raise_alert(env, AlertKind.HIGH_CPU, severity="WARNING", message="CPU")


def test_alert_list_is_scoped(as_user, make_user, open_alert, developer):
    res = as_user(developer).get(ALERTS)
    assert res.status_code == 200 and res.data["count"] == 1
    other = make_user(Role.DEVELOPER)
    assert as_user(other).get(ALERTS).data["count"] == 0
    assert as_user(other).get(f"{ALERTS}{open_alert.id}/").status_code == 404


def test_clients_cannot_see_alerts(as_user, client_user, open_alert):
    assert as_user(client_user).get(ALERTS).status_code == 403


def test_acknowledge_then_resolve(as_user, developer, open_alert):
    c = as_user(developer)
    res = c.post(f"{ALERTS}{open_alert.id}/acknowledge/")
    assert res.status_code == 200 and res.data["status"] == "ACKNOWLEDGED"
    assert res.data["acknowledged_by_email"] == developer.email
    assert c.post(f"{ALERTS}{open_alert.id}/acknowledge/").status_code == 400
    res = c.post(f"{ALERTS}{open_alert.id}/resolve/")
    assert res.status_code == 200 and res.data["status"] == "RESOLVED"
    assert c.post(f"{ALERTS}{open_alert.id}/resolve/").status_code == 400


def test_non_editor_cannot_manage_alerts(as_user, make_user, project, open_alert):
    from apps.projects.models import ProjectMember

    viewer = make_user(Role.DEVELOPER)
    ProjectMember.objects.create(project=project, user=viewer, role="DEVELOPER")
    c = as_user(viewer)
    assert c.get(f"{ALERTS}{open_alert.id}/").status_code == 200
    assert c.post(f"{ALERTS}{open_alert.id}/acknowledge/").status_code == 403


def test_alert_filters_and_summary(as_user, admin_user, env, open_alert):
    resolved = alerts.raise_alert(env, AlertKind.HIGH_MEMORY, severity="CRITICAL", message="M")
    alerts.resolve(resolved, actor=admin_user)
    c = as_user(admin_user)
    assert c.get(ALERTS, {"status": "ACTIVE"}).data["count"] == 1
    assert c.get(ALERTS, {"status": "RESOLVED"}).data["count"] == 1
    s = c.get(f"{ALERTS}summary/").data
    assert s["open"] == 1 and s["resolved_7d"] == 1 and s["critical"] == 0


# --- overview and project detail -------------------------------------------------------


def _history(check, *, count=12, down_every=0, minutes=5):
    now = timezone.now()
    rows = []
    for i in range(count):
        down = bool(down_every) and i % down_every == 0
        rows.append(
            CheckResult(
                health_check=check,
                checked_at=now - timedelta(minutes=minutes * (count - i)),
                status=HealthStatus.UNAVAILABLE if down else HealthStatus.HEALTHY,
                response_ms=None if down else 100 + i,
                status_code=None if down else 200,
            )
        )
    CheckResult.objects.bulk_create(rows)


def test_overview_lists_projects_with_status_metrics_and_alerts(
    as_user, admin_user, check, env, make_project
):
    _history(check, count=10, down_every=5)  # 2/10 down -> 80 %
    services.record_result(check.pk, OK)
    sample(env, cpu_percent=96)
    make_project("Sin monitoreo")
    archived = make_project("Viejo", status=ProjectStatus.ARCHIVED)
    Environment.objects.create(project=archived, kind="PRODUCTION")

    res = as_user(admin_user).get(OVERVIEW)
    assert res.status_code == 200
    data = res.json()
    totals = data["totals"]
    assert totals["projects"] == 2  # archived excluded
    assert totals["monitored_projects"] == 1
    assert totals["pages"] == 1 and totals["pages_up"] == 1 and totals["pages_down"] == 0
    assert totals["open_alerts"] == 1 and totals["critical_alerts"] == 1
    assert totals["reporting_metrics"] == 1
    row = next(p for p in data["projects"] if p["name"] == "Pedidos")
    assert row["status"] == "HEALTHY" and row["open_alerts"] == 1
    assert row["metrics"]["cpu_percent"] == 96
    assert 0.8 <= row["uptime_24h"] <= 0.82
    assert len(row["environments"][0]["history_24h"]) == 24
    empty = next(p for p in data["projects"] if p["name"] == "Sin monitoreo")
    assert empty["environments"] == [] and empty["status"] == "UNKNOWN"


def test_overview_counts_down_pages(as_user, admin_user, check):
    services.record_result(check.pk, DOWN)
    services.record_result(check.pk, DOWN)
    totals = as_user(admin_user).get(OVERVIEW).json()["totals"]
    assert totals["pages_down"] == 1 and totals["pages_up"] == 0


def test_overview_is_scoped_to_visible_projects(as_user, make_user, check):
    other = make_user(Role.DEVELOPER)
    assert as_user(other).get(OVERVIEW).json()["totals"]["projects"] == 0


def test_overview_query_count_is_bounded(
    as_user, admin_user, make_project, django_assert_max_num_queries
):
    for i in range(6):
        p = make_project(f"P{i}")
        e = Environment.objects.create(
            project=p, kind="PRODUCTION", public_url=f"https://p{i}.example.com"
        )
        HealthCheck.objects.create(environment=e)
        MetricSample.objects.create(environment=e, recorded_at=timezone.now(), cpu_percent=5)
    c = as_user(admin_user)
    with django_assert_max_num_queries(20):
        assert c.get(OVERVIEW).status_code == 200


def test_project_detail_statistics_and_series(as_user, developer, check, env, project):
    _history(check, count=20, down_every=10)
    alerts.raise_alert(env, AlertKind.SERVICE_DOWN, severity="CRITICAL", message="x")
    now = timezone.now()
    for i in range(5):
        MetricSample.objects.create(
            environment=env,
            recorded_at=now - timedelta(minutes=10 * i),
            cpu_percent=10 * (i + 1),
            requests_per_minute=60,
        )
    res = as_user(developer).get(f"{OVERVIEW}{project.id}/", {"hours": 24})
    assert res.status_code == 200, res.data
    d = res.json()
    st = d["statistics"]
    assert st["checks"] == 20 and st["failures"] == 2 and st["uptime"] == 0.9
    assert st["p95_response_ms"] is not None and st["incidents"] == 1
    assert st["avg_cpu_percent"] == 30.0 and st["max_cpu_percent"] == 50.0
    assert st["total_requests"] == 60 * 24 * 60
    assert d["selected_environment"] == str(env.id)
    assert d["metric_series"] and d["response_series"]
    assert len(d["daily_uptime"]) == 30


def test_project_detail_access_and_validation(as_user, make_user, admin_user, project, env):
    other = make_user(Role.DEVELOPER)
    assert as_user(other).get(f"{OVERVIEW}{project.id}/").status_code == 404
    c = as_user(admin_user)
    assert c.get(f"{OVERVIEW}{project.id}/", {"environment": str(project.id)}).status_code == 400


# --- retention -------------------------------------------------------------------------


def test_purge_history_removes_old_samples_and_resolved_alerts(env):
    old = timezone.now() - timedelta(days=400)
    MetricSample.objects.create(environment=env, recorded_at=old, cpu_percent=1)
    MetricSample.objects.create(environment=env, recorded_at=timezone.now(), cpu_percent=1)
    a = alerts.raise_alert(env, AlertKind.HIGH_CPU, severity="WARNING", message="x", at=old)
    alerts.resolve_condition(env, AlertKind.HIGH_CPU, at=old)
    alerts.raise_alert(env, AlertKind.HIGH_MEMORY, severity="WARNING", message="y", at=old)
    call_command("purge_history", stdout=StringIO())
    assert MetricSample.objects.count() == 1
    assert not Alert.objects.filter(pk=a.pk).exists()
    assert Alert.objects.filter(kind=AlertKind.HIGH_MEMORY).exists()  # active alerts are kept
