"""Internal metrics: ingestion, per-project overview, history series and statistics.

All read models are computed with a bounded number of queries regardless of how many
projects or environments there are (aggregations and DISTINCT ON, never one query per row).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from statistics import fmean
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.db.models import Avg, Count, DateTimeField, F, Func, Max, Q, QuerySet, Value
from django.db.models.functions import TruncDate, TruncHour
from django.utils import timezone

from apps.infrastructure.models import Environment, EnvironmentStatus
from apps.projects.models import Project
from apps.traceability.models import Severity
from common.exceptions import DomainError

from . import alerts
from .models import (
    ACTIVE_ALERT_STATUSES,
    METRIC_FIELDS,
    Alert,
    AlertKind,
    CheckResult,
    HealthCheck,
    HealthStatus,
    MetricSample,
)

UP = (HealthStatus.HEALTHY, HealthStatus.DEGRADED)
KIND_ORDER = {"PRODUCTION": 0, "DEMO": 1, "DEVELOPMENT": 2}
STATUS_RANK = {
    HealthStatus.UNAVAILABLE: 3,
    HealthStatus.DEGRADED: 2,
    HealthStatus.HEALTHY: 1,
    HealthStatus.UNKNOWN: 0,
}
MAX_FUTURE_SKEW = timedelta(minutes=5)
MAX_SAMPLE_AGE = timedelta(hours=1)


class DateBin(Func):
    """PostgreSQL date_bin(): fixed-width time buckets aligned to a constant origin."""

    function = "date_bin"
    output_field = DateTimeField()

    def __init__(self, seconds: int, expression, **extra):
        origin = Value(datetime(2000, 1, 1, tzinfo=UTC), output_field=DateTimeField())
        super().__init__(Value(timedelta(seconds=seconds)), expression, origin, **extra)


def bucket_seconds(hours: int) -> int:
    """~120 points per series, never finer than one minute."""
    return max(60, (hours * 3600) // 120)


def _ratio(up: int, total: int) -> float | None:
    return round(up / total, 4) if total else None


# --- ingestion -------------------------------------------------------------------------


@transaction.atomic
def ingest_sample(environment: Environment, data: dict, *, now=None) -> MetricSample:
    now = now or timezone.now()
    recorded_at = data.pop("recorded_at", None) or now
    if recorded_at > now + MAX_FUTURE_SKEW:
        raise DomainError(
            "recorded_at está en el futuro.", code="invalid_timestamp", field="recorded_at"
        )
    if recorded_at < now - MAX_SAMPLE_AGE:
        raise DomainError(
            "La muestra es demasiado antigua (máx. 1 h).",
            code="invalid_timestamp",
            field="recorded_at",
        )
    values = {k: data.get(k) for k in METRIC_FIELDS}
    if all(v is None for v in values.values()):
        raise DomainError("Envía al menos una métrica.", code="empty_sample")
    if environment.project.is_archived:
        raise DomainError("El proyecto está archivado.", code="archived")
    sample = MetricSample.objects.create(environment=environment, recorded_at=recorded_at, **values)
    sample.environment = environment
    alerts.evaluate_sample(sample)
    return sample


# --- shared read helpers ---------------------------------------------------------------


def latest_samples(env_ids) -> dict:
    rows = (
        MetricSample.objects.filter(environment_id__in=list(env_ids))
        .order_by("environment_id", "-recorded_at")
        .distinct("environment_id")
    )
    return {s.environment_id: s for s in rows}


def metrics_are_stale(sample: MetricSample | None, now) -> bool:
    if sample is None:
        return False
    return now - sample.recorded_at > timedelta(seconds=settings.MONITOR_METRICS_STALE_SECONDS)


def serialize_sample(sample: MetricSample | None, now) -> dict | None:
    if sample is None:
        return None
    return {
        "recorded_at": sample.recorded_at,
        "is_stale": metrics_are_stale(sample, now),
        **{k: getattr(sample, k) for k in METRIC_FIELDS},
    }


def uptime_by_check(check_ids, now) -> dict:
    """{check_id: {"24h": r, "7d": r, "30d": r}} in one aggregation query."""
    windows = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
    annotations = {}
    for name, delta in windows.items():
        since = now - delta
        annotations[f"t_{name}"] = Count("id", filter=Q(checked_at__gte=since))
        annotations[f"u_{name}"] = Count("id", filter=Q(checked_at__gte=since, status__in=UP))
    rows = (
        CheckResult.objects.filter(
            health_check_id__in=list(check_ids), checked_at__gte=now - windows["30d"]
        )
        .values("health_check_id")
        .annotate(**annotations)
    )
    out = {}
    for r in rows:
        out[r["health_check_id"]] = {n: _ratio(r[f"u_{n}"], r[f"t_{n}"]) for n in windows}
    return out


def hourly_strip(check_ids, now, hours: int = 24) -> dict:
    """{check_id: [ {hour, status, uptime} x hours ]} oldest first; status None = no data."""
    start = (now - timedelta(hours=hours - 1)).replace(minute=0, second=0, microsecond=0)
    rows = (
        CheckResult.objects.filter(health_check_id__in=list(check_ids), checked_at__gte=start)
        .annotate(hour=TruncHour("checked_at"))
        .values("health_check_id", "hour")
        .annotate(
            total=Count("id"),
            up=Count("id", filter=Q(status__in=UP)),
            down=Count("id", filter=Q(status=HealthStatus.UNAVAILABLE)),
            slow=Count("id", filter=Q(status=HealthStatus.DEGRADED)),
        )
    )
    index = defaultdict(dict)
    for r in rows:
        index[r["health_check_id"]][r["hour"]] = r
    out = {}
    for cid in check_ids:
        strip = []
        for i in range(hours):
            hour = start + timedelta(hours=i)
            r = index[cid].get(hour)
            if r is None:
                strip.append({"hour": hour, "status": None, "uptime": None})
                continue
            status = (
                HealthStatus.UNAVAILABLE
                if r["down"]
                else HealthStatus.DEGRADED
                if r["slow"]
                else HealthStatus.HEALTHY
            )
            strip.append({"hour": hour, "status": status, "uptime": _ratio(r["up"], r["total"])})
        out[cid] = strip
    return out


def active_alerts_by_env(env_ids) -> dict:
    out = defaultdict(list)
    for a in Alert.objects.filter(
        environment_id__in=list(env_ids), status__in=ACTIVE_ALERT_STATUSES
    ).order_by("-opened_at"):
        out[a.environment_id].append(a)
    return out


def worst_severity(severities) -> str | None:
    found = [s for s in severities if s]
    return max(found, key=alerts.SEVERITY_RANK.__getitem__) if found else None


def monitored_environments(projects) -> QuerySet[Environment]:
    """Active environments that have a health check or have ever pushed metrics."""
    return (
        Environment.objects.filter(project__in=projects, status=EnvironmentStatus.ACTIVE)
        .filter(Q(health_check__isnull=False) | Q(metric_samples__isnull=False))
        .distinct()
        .select_related("project", "server")
    )


def _env_row(env, check, sample, uptime, strip, env_alerts, now) -> dict:
    status = check.effective_status if check else HealthStatus.UNKNOWN
    if check is None:
        label = "Sin health check"
    elif not check.enabled:
        label = "Desactivado"
    elif check.is_stale:
        label = "Verificación desactualizada"
    elif check.last_checked_at is None:
        label = "Pendiente de verificar"
    else:
        label = HealthStatus(status).label
    candidates = [
        t
        for t in (check.last_checked_at if check else None, sample.recorded_at if sample else None)
        if t
    ]
    return {
        "id": env.id,
        "project": env.project_id,
        "kind": env.kind,
        "label": env.display_name,
        "public_url": env.public_url,
        "server_name": env.server.name if env.server_id else None,
        "health_check": check.id if check else None,
        "status": status,
        "status_label": label,
        "is_stale": bool(check and check.is_stale),
        "last_checked_at": check.last_checked_at if check else None,
        "last_response_ms": check.last_response_ms if check else None,
        "status_changed_at": check.status_changed_at if check else None,
        "uptime_24h": (uptime or {}).get("24h"),
        "uptime_7d": (uptime or {}).get("7d"),
        "uptime_30d": (uptime or {}).get("30d"),
        "history_24h": strip or [],
        "metrics": serialize_sample(sample, now),
        "open_alerts": len(env_alerts),
        "alert_severity": worst_severity(a.severity for a in env_alerts),
        "last_update": max(candidates) if candidates else None,
    }


def _environment_rows(envs, now) -> list[dict]:
    envs = list(envs)
    env_ids = [e.id for e in envs]
    checks = {
        c.environment_id: c
        for c in HealthCheck.objects.filter(environment_id__in=env_ids).select_related(
            "environment"
        )
    }
    check_ids = [c.id for c in checks.values()]
    uptime = uptime_by_check(check_ids, now)
    strips = hourly_strip(check_ids, now)
    samples = latest_samples(env_ids)
    env_alerts = active_alerts_by_env(env_ids)
    rows = []
    for env in envs:
        check = checks.get(env.id)
        rows.append(
            _env_row(
                env,
                check,
                samples.get(env.id),
                uptime.get(check.id) if check else None,
                strips.get(check.id) if check else None,
                env_alerts.get(env.id, []),
                now,
            )
        )
    return rows


def _primary(rows: list[dict]) -> dict | None:
    with_check = [r for r in rows if r["health_check"]]
    pool = with_check or rows
    return min(pool, key=lambda r: KIND_ORDER.get(r["kind"], 9)) if pool else None


def _project_status(rows: list[dict]) -> str:
    known = [r["status"] for r in rows if r["status"] != HealthStatus.UNKNOWN]
    if not known:
        return HealthStatus.UNKNOWN
    return max(known, key=lambda s: STATUS_RANK[s])


def _project_row(project: Project, rows: list[dict]) -> dict:
    primary = _primary(rows)
    updates = [r["last_update"] for r in rows if r["last_update"]]
    status = _project_status(rows)
    return {
        "id": project.id,
        "name": project.name,
        "slug": project.slug,
        "project_status": project.status,
        "status": status,
        "status_label": HealthStatus(status).label if rows else "Sin monitoreo",
        "environments": rows,
        "primary_environment": primary["id"] if primary else None,
        "uptime_24h": primary["uptime_24h"] if primary else None,
        "uptime_7d": primary["uptime_7d"] if primary else None,
        "last_response_ms": primary["last_response_ms"] if primary else None,
        "metrics": primary["metrics"] if primary else None,
        "open_alerts": sum(r["open_alerts"] for r in rows),
        "alert_severity": worst_severity(r["alert_severity"] for r in rows),
        "pages_up": sum(1 for r in rows if r["health_check"] and r["status"] in UP),
        "pages_down": sum(1 for r in rows if r["status"] == HealthStatus.UNAVAILABLE),
        "last_update": max(updates) if updates else None,
    }


# --- overview (all projects) -----------------------------------------------------------


def overview(projects: QuerySet[Project], *, now=None) -> dict:
    now = now or timezone.now()
    projects = list(projects.active().order_by("name"))
    rows = _environment_rows(monitored_environments(projects), now)
    by_project = defaultdict(list)
    for r in rows:
        by_project[r["project"]].append(r)
    for env_rows in by_project.values():
        env_rows.sort(key=lambda r: KIND_ORDER.get(r["kind"], 9))
    project_rows = [_project_row(p, by_project.get(p.id, [])) for p in projects]

    # Down first, then degraded, then with active alerts, healthy, and unmonitored last.
    def priority(p):
        if p["pages_down"]:
            return 0
        if p["status"] == HealthStatus.DEGRADED:
            return 1
        if p["open_alerts"]:
            return 2
        return 3 if p["environments"] else 4

    project_rows.sort(key=lambda p: (priority(p), -p["open_alerts"], p["name"].lower()))
    pages = [r for r in rows if r["health_check"]]
    with_uptime = [r["uptime_24h"] for r in pages if r["uptime_24h"] is not None]
    project_ids = [p.id for p in projects]
    active_alerts = Alert.objects.filter(
        environment__project_id__in=project_ids, status__in=ACTIVE_ALERT_STATUSES
    )
    updates = [r["last_update"] for r in rows if r["last_update"]]
    return {
        "generated_at": now,
        "totals": {
            "projects": len(projects),
            "monitored_projects": sum(1 for p in project_rows if p["environments"]),
            "pages": len(pages),
            "pages_up": sum(1 for r in pages if r["status"] in UP),
            "pages_degraded": sum(1 for r in pages if r["status"] == HealthStatus.DEGRADED),
            "pages_down": sum(1 for r in pages if r["status"] == HealthStatus.UNAVAILABLE),
            "pages_unknown": sum(1 for r in pages if r["status"] == HealthStatus.UNKNOWN),
            "open_alerts": active_alerts.count(),
            "critical_alerts": active_alerts.filter(severity=Severity.CRITICAL).count(),
            "avg_uptime_24h": round(fmean(with_uptime), 4) if with_uptime else None,
            "reporting_metrics": sum(
                1 for r in rows if r["metrics"] and not r["metrics"]["is_stale"]
            ),
            "last_update": max(updates) if updates else None,
        },
        "projects": project_rows,
    }


# --- project detail: history and statistics --------------------------------------------


def _percentile(values: list[int], q: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[idx]


def metric_series(env_id, since, seconds: int) -> list[dict]:
    rows = (
        MetricSample.objects.filter(environment_id=env_id, recorded_at__gte=since)
        .annotate(bucket=DateBin(seconds, F("recorded_at")))
        .values("bucket")
        .annotate(
            cpu_percent=Avg("cpu_percent"),
            memory_percent=Avg("memory_percent"),
            memory_used_mb=Avg("memory_used_mb"),
            requests_per_minute=Avg("requests_per_minute"),
            error_rate_percent=Avg("error_rate_percent"),
            latency_p95_ms=Max("latency_p95_ms"),
            active_connections=Avg("active_connections"),
        )
        .order_by("bucket")
    )
    keys = (
        "cpu_percent",
        "memory_percent",
        "memory_used_mb",
        "requests_per_minute",
        "error_rate_percent",
        "latency_p95_ms",
        "active_connections",
    )
    return [
        {"t": r["bucket"], **{k: None if r[k] is None else round(float(r[k]), 2) for k in keys}}
        for r in rows
    ]


def response_series(check_id, since, seconds: int) -> list[dict]:
    rows = (
        CheckResult.objects.filter(health_check_id=check_id, checked_at__gte=since)
        .annotate(bucket=DateBin(seconds, F("checked_at")))
        .values("bucket")
        .annotate(
            avg_ms=Avg("response_ms"),
            max_ms=Max("response_ms"),
            total=Count("id"),
            down=Count("id", filter=Q(status=HealthStatus.UNAVAILABLE)),
            slow=Count("id", filter=Q(status=HealthStatus.DEGRADED)),
        )
        .order_by("bucket")
    )
    out = []
    for r in rows:
        status = (
            HealthStatus.UNAVAILABLE
            if r["down"]
            else HealthStatus.DEGRADED
            if r["slow"]
            else HealthStatus.HEALTHY
        )
        out.append(
            {
                "t": r["bucket"],
                "avg_ms": None if r["avg_ms"] is None else round(float(r["avg_ms"])),
                "max_ms": r["max_ms"],
                "checks": r["total"],
                "status": status,
            }
        )
    return out


def daily_uptime(check_id, now, days: int = 30) -> list[dict]:
    tz = ZoneInfo(settings.BUSINESS_TIME_ZONE)
    today = timezone.localtime(now, tz).date()
    first = today - timedelta(days=days - 1)
    rows = (
        CheckResult.objects.filter(
            health_check_id=check_id, checked_at__gte=now - timedelta(days=days + 1)
        )
        .annotate(day=TruncDate("checked_at", tzinfo=tz))
        .values("day")
        .annotate(
            total=Count("id"),
            up=Count("id", filter=Q(status__in=UP)),
            down=Count("id", filter=Q(status=HealthStatus.UNAVAILABLE)),
            avg_ms=Avg("response_ms"),
        )
    )
    index = {r["day"]: r for r in rows}
    out = []
    for i in range(days):
        day = first + timedelta(days=i)
        r = index.get(day)
        out.append(
            {
                "day": day,
                "uptime": _ratio(r["up"], r["total"]) if r else None,
                "checks": r["total"] if r else 0,
                "failures": r["down"] if r else 0,
                "avg_ms": round(float(r["avg_ms"])) if r and r["avg_ms"] is not None else None,
            }
        )
    return out


def _overlap(alert: Alert, since, now) -> int:
    start = max(alert.opened_at, since)
    end = min(alert.resolved_at or now, now)
    return max(0, int((end - start).total_seconds()))


def statistics(env: Environment, check: HealthCheck | None, since, now) -> dict:
    stats = {
        "checks": 0,
        "failures": 0,
        "degraded": 0,
        "uptime": None,
        "avg_response_ms": None,
        "p95_response_ms": None,
        "max_response_ms": None,
        "incidents": 0,
        "downtime_seconds": 0,
        "mttr_seconds": None,
        "longest_outage_seconds": None,
        "alerts": 0,
        "avg_cpu_percent": None,
        "max_cpu_percent": None,
        "avg_memory_percent": None,
        "max_memory_percent": None,
        "avg_requests_per_minute": None,
        "total_requests": None,
        "avg_error_rate_percent": None,
    }
    if check is not None:
        results = CheckResult.objects.filter(health_check=check, checked_at__gte=since)
        agg = results.aggregate(
            total=Count("id"),
            up=Count("id", filter=Q(status__in=UP)),
            down=Count("id", filter=Q(status=HealthStatus.UNAVAILABLE)),
            slow=Count("id", filter=Q(status=HealthStatus.DEGRADED)),
            avg=Avg("response_ms"),
            mx=Max("response_ms"),
        )
        times = list(
            results.exclude(response_ms__isnull=True).values_list("response_ms", flat=True)[:20000]
        )
        stats.update(
            checks=agg["total"],
            failures=agg["down"],
            degraded=agg["slow"],
            uptime=_ratio(agg["up"], agg["total"]),
            avg_response_ms=round(agg["avg"]) if agg["avg"] is not None else None,
            p95_response_ms=_percentile(times, 0.95),
            max_response_ms=agg["mx"],
        )
    window_alerts = Alert.objects.filter(environment=env).filter(
        Q(opened_at__gte=since) | Q(resolved_at__isnull=True) | Q(resolved_at__gte=since)
    )
    outages = [a for a in window_alerts if a.kind == AlertKind.SERVICE_DOWN]
    resolved = [a for a in outages if a.resolved_at]
    stats.update(
        alerts=sum(1 for a in window_alerts if a.opened_at >= since),
        incidents=sum(1 for a in outages if a.opened_at >= since),
        downtime_seconds=sum(_overlap(a, since, now) for a in outages),
        mttr_seconds=round(fmean(a.duration_seconds for a in resolved)) if resolved else None,
        longest_outage_seconds=max((a.duration_seconds for a in outages), default=None),
    )
    m = MetricSample.objects.filter(environment=env, recorded_at__gte=since).aggregate(
        cpu=Avg("cpu_percent"),
        cpu_max=Max("cpu_percent"),
        mem=Avg("memory_percent"),
        mem_max=Max("memory_percent"),
        rpm=Avg("requests_per_minute"),
        err=Avg("error_rate_percent"),
    )
    minutes = (now - since).total_seconds() / 60

    def r(v, nd=1):
        return None if v is None else round(float(v), nd)

    stats.update(
        avg_cpu_percent=r(m["cpu"]),
        max_cpu_percent=r(m["cpu_max"]),
        avg_memory_percent=r(m["mem"]),
        max_memory_percent=r(m["mem_max"]),
        avg_requests_per_minute=r(m["rpm"]),
        total_requests=None if m["rpm"] is None else round(float(m["rpm"]) * minutes),
        avg_error_rate_percent=r(m["err"], 2),
    )
    return stats


def project_detail(project: Project, *, environment_id=None, hours: int = 24, now=None) -> dict:
    now = now or timezone.now()
    hours = max(1, min(hours, 24 * 30))
    envs = sorted(monitored_environments([project]), key=lambda e: KIND_ORDER.get(e.kind, 9))
    rows = _environment_rows(envs, now)
    head = _project_row(project, rows)
    selected = None
    if environment_id:
        selected = next((e for e in envs if str(e.id) == str(environment_id)), None)
        if selected is None:
            raise DomainError("Entorno no válido para este proyecto.", code="invalid_environment")
    elif head["primary_environment"]:
        selected = next(e for e in envs if e.id == head["primary_environment"])
    since = now - timedelta(hours=hours)
    seconds = bucket_seconds(hours)
    data = {
        **head,
        "generated_at": now,
        "window_hours": hours,
        "bucket_seconds": seconds,
        "selected_environment": selected.id if selected else None,
        "statistics": None,
        "metric_series": [],
        "response_series": [],
        "daily_uptime": [],
    }
    if selected is not None:
        check = HealthCheck.objects.filter(environment=selected).first()
        data.update(
            statistics=statistics(selected, check, since, now),
            metric_series=metric_series(selected.id, since, seconds),
            response_series=response_series(check.id, since, seconds) if check else [],
            daily_uptime=daily_uptime(check.id, now) if check else [],
        )
    return data
