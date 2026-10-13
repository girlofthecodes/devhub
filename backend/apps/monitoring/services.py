"""Health-check configuration, execution and status transitions."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Count, DurationField, ExpressionWrapper, F, Q, QuerySet
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditAction
from apps.infrastructure.models import Environment, EnvironmentStatus, Server
from apps.traceability import services as trace
from apps.traceability.models import EventSource, EventType, Severity
from common.exceptions import DomainError

from . import probe as probe_module
from .models import CheckResult, HealthCheck, HealthStatus

CONFIG_FIELDS = (
    "path",
    "expected_status_min",
    "expected_status_max",
    "interval_seconds",
    "timeout_seconds",
    "degraded_threshold_ms",
    "failure_threshold",
    "enabled",
)
Prober = Callable[..., probe_module.ProbeResult]


# --- configuration ---------------------------------------------------------------------


def _validate_config(data: dict, current: HealthCheck | None = None) -> None:
    def value(field):
        return data.get(
            field,
            getattr(current, field) if current else HealthCheck._meta.get_field(field).default,
        )

    if "path" in data:
        try:
            probe_module.validate_path(data["path"])
        except ValueError as exc:
            raise DomainError(str(exc), code="invalid_path", field="path") from exc
    interval, timeout = value("interval_seconds"), value("timeout_seconds")
    if interval < settings.MONITOR_MIN_INTERVAL_SECONDS:
        raise DomainError(
            f"El intervalo mínimo es de {settings.MONITOR_MIN_INTERVAL_SECONDS} s.",
            code="interval_too_short",
            field="interval_seconds",
        )
    if not 1 <= timeout <= 10 or timeout >= interval:
        raise DomainError(
            "El timeout debe estar entre 1 y 10 s y ser menor que el intervalo.",
            code="invalid_timeout",
            field="timeout_seconds",
        )
    lo, hi = value("expected_status_min"), value("expected_status_max")
    if not (100 <= lo <= hi <= 599):
        raise DomainError(
            "Rango de códigos HTTP esperado no válido.",
            code="invalid_range",
            field="expected_status_min",
        )
    if not 1 <= value("failure_threshold") <= 10:
        raise DomainError(
            "Los fallos para marcar caída deben estar entre 1 y 10.",
            code="invalid_threshold",
            field="failure_threshold",
        )


@transaction.atomic
def create_check(*, environment: Environment, actor, request=None, **data) -> HealthCheck:
    if environment.project.is_archived:
        raise DomainError("El proyecto está archivado.", code="archived", field="environment")
    if not environment.public_url:
        raise DomainError(
            "El entorno no tiene URL pública que monitorear.",
            code="no_public_url",
            field="environment",
        )
    if HealthCheck.objects.filter(environment=environment).exists():
        raise DomainError(
            "Este entorno ya tiene un health check.", code="duplicate", field="environment"
        )
    _validate_config(data)
    check = HealthCheck.objects.create(environment=environment, **data)
    trace.emit(
        EventType.CONFIGURATION_CHANGED,
        description=f"Health check configurado: {check.target_url}",
        environment=environment,
        source=trace.source_for(actor),
        actor=actor,
        metadata={k: getattr(check, k) for k in CONFIG_FIELDS},
    )
    audit.record(AuditAction.HEALTH_CHECK_CREATED, actor=actor, target=check, request=request)
    return check


@transaction.atomic
def update_check(check: HealthCheck, *, actor, data: dict, request=None) -> HealthCheck:
    data = {k: v for k, v in data.items() if k in CONFIG_FIELDS and getattr(check, k) != v}
    if not data:
        return check
    _validate_config(data, current=check)
    changes = {k: {"from": getattr(check, k), "to": v} for k, v in data.items()}
    for field, value in data.items():
        setattr(check, field, value)
    if data.get("enabled") is False:
        check.status = HealthStatus.UNKNOWN
    check.save()
    trace.emit(
        EventType.CONFIGURATION_CHANGED,
        description="Health check actualizado: " + ", ".join(sorted(changes)),
        environment=check.environment,
        source=trace.source_for(actor),
        actor=actor,
        metadata={"changes": changes},
    )
    audit.record(
        AuditAction.HEALTH_CHECK_UPDATED,
        actor=actor,
        target=check,
        changes=changes,
        request=request,
    )
    return check


# --- execution -----------------------------------------------------------------------


def due_checks(now=None) -> QuerySet[HealthCheck]:
    now = now or timezone.now()
    interval = ExpressionWrapper(
        F("interval_seconds") * timedelta(seconds=1), output_field=DurationField()
    )
    return (
        HealthCheck.objects.filter(
            enabled=True,
            environment__status=EnvironmentStatus.ACTIVE,
            environment__project__archived_at__isnull=True,
        )
        .exclude(environment__public_url="")
        .annotate(next_due=F("last_checked_at") + interval)
        .filter(Q(last_checked_at__isnull=True) | Q(next_due__lte=now))
        .select_related("environment__project", "environment__server")
    )


def _outcome(check: HealthCheck, result: probe_module.ProbeResult) -> tuple[str, str]:
    """Return (raw_status, error) where raw_status ignores the failure threshold."""
    if not result.ok_connection:
        return "FAIL", result.error
    code = result.status_code or 0
    if not check.expected_status_min <= code <= check.expected_status_max:
        return "FAIL", f"Código HTTP inesperado: {code}"
    if result.response_ms is not None and result.response_ms > check.degraded_threshold_ms:
        return HealthStatus.DEGRADED, f"Respuesta lenta ({result.response_ms} ms)"
    return HealthStatus.HEALTHY, ""


def execute(check: HealthCheck, *, prober: Prober | None = None) -> probe_module.ProbeResult:
    """Network part only (no DB writes); safe to run in worker threads."""
    prober = prober or probe_module.probe
    try:
        return prober(check.target_url, timeout=check.timeout_seconds)
    except probe_module.ProbeRefused as exc:
        return probe_module.ProbeResult(False, None, None, f"Destino rechazado: {exc}"[:255])


@transaction.atomic
def record_result(check_id, result: probe_module.ProbeResult, *, at=None) -> HealthCheck:
    """Persist a probe result and apply status transitions (emitting trace events)."""
    now = at or timezone.now()
    check = (
        HealthCheck.objects.select_for_update(of=("self",))
        .select_related("environment__project", "environment__server")
        .get(pk=check_id)
    )
    previous = check.status
    raw, error = _outcome(check, result)
    if raw == "FAIL":
        check.consecutive_failures += 1
        new = (
            HealthStatus.UNAVAILABLE
            if check.consecutive_failures >= check.failure_threshold
            or previous == HealthStatus.UNAVAILABLE
            else HealthStatus.DEGRADED
        )
    else:
        check.consecutive_failures = 0
        new = raw

    CheckResult.objects.create(
        health_check=check,
        checked_at=now,
        status=new,
        response_ms=result.response_ms,
        status_code=result.status_code,
        error=error,
    )
    if new != previous:
        if new == HealthStatus.UNAVAILABLE:
            trace.emit(
                EventType.SERVICE_UNAVAILABLE,
                description=f"{check.environment} no disponible: {error or 'sin respuesta'}",
                environment=check.environment,
                severity=Severity.CRITICAL
                if check.environment.kind == "PRODUCTION"
                else Severity.ERROR,
                source=EventSource.MONITORING,
                actor_label="monitor",
                metadata={
                    "url": check.target_url,
                    "error": error,
                    "failures": check.consecutive_failures,
                },
                occurred_at=now,
            )
        elif previous == HealthStatus.UNAVAILABLE:
            downtime = (
                int((now - check.status_changed_at).total_seconds())
                if check.status_changed_at
                else None
            )
            trace.emit(
                EventType.SERVICE_RECOVERED,
                description=f"{check.environment} recuperado",
                environment=check.environment,
                source=EventSource.MONITORING,
                actor_label="monitor",
                metadata={"url": check.target_url, "downtime_seconds": downtime, "status": new},
                occurred_at=now,
            )
        check.status_changed_at = now
    check.status = new
    check.last_checked_at = now
    check.last_response_ms = result.response_ms
    check.last_status_code = result.status_code
    check.last_error = error
    check.save()
    if check.environment.server_id:
        Server.objects.filter(pk=check.environment.server_id).update(last_checked_at=now)
    return check


def run_now(check: HealthCheck, *, prober: Prober | None = None) -> HealthCheck:
    if check.last_checked_at and timezone.now() - check.last_checked_at < timedelta(
        seconds=settings.MONITOR_MANUAL_MIN_SECONDS
    ):
        wait = settings.MONITOR_MANUAL_MIN_SECONDS
        raise DomainError(
            f"Espera al menos {wait} s entre verificaciones manuales.", code="too_soon"
        )
    if not check.enabled:
        raise DomainError("El health check está desactivado.", code="disabled")
    return record_result(check.pk, execute(check, prober=prober))


# --- read models ---------------------------------------------------------------------


def uptime(check: HealthCheck, *, hours: int) -> float | None:
    since = timezone.now() - timedelta(hours=hours)
    agg = check.results.filter(checked_at__gte=since).aggregate(
        total=Count("id"),
        up=Count("id", filter=Q(status__in=[HealthStatus.HEALTHY, HealthStatus.DEGRADED])),
    )
    return round(agg["up"] / agg["total"], 4) if agg["total"] else None


def availability_for_project(project) -> dict:
    """Client-facing availability: the Production check (else Demo); UNKNOWN when stale."""
    checks = {
        c.environment.kind: c
        for c in HealthCheck.objects.filter(
            environment__project=project, enabled=True
        ).select_related("environment")
    }
    check = checks.get("PRODUCTION") or checks.get("DEMO")
    if check is None:
        return {"status": HealthStatus.UNKNOWN, "label": "Sin monitoreo", "checked_at": None}
    status = check.effective_status
    if check.is_stale:
        label = "Verificación desactualizada"
    else:
        label = HealthStatus(status).label if check.last_checked_at else "Pendiente de verificar"
    return {"status": status, "label": label, "checked_at": check.last_checked_at}
