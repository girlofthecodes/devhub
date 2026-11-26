"""Alert lifecycle: raise (open or refresh), resolve automatically, acknowledge/resolve by hand.

Rules:
- At most one active alert (OPEN or ACKNOWLEDGED) per (environment, kind), enforced by a
  partial unique constraint. A new detection of an active condition refreshes that alert
  (value, severity, message, hits) instead of creating a duplicate.
- Conditions that clear resolve the alert automatically. A manual resolve while the condition
  still holds is allowed: the next evaluation opens a new alert.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditAction
from apps.infrastructure.models import Environment, EnvironmentStatus
from apps.traceability.models import Severity
from common.exceptions import DomainError

from .models import ACTIVE_ALERT_STATUSES, Alert, AlertKind, AlertStatus, MetricSample

SEVERITY_RANK = {Severity.INFO: 0, Severity.WARNING: 1, Severity.ERROR: 2, Severity.CRITICAL: 3}

# metric field -> (alert kind, label, unit)
METRIC_RULES: dict[str, tuple[str, str, str]] = {
    "cpu_percent": (AlertKind.HIGH_CPU, "CPU", " %"),
    "memory_percent": (AlertKind.HIGH_MEMORY, "Memoria", " %"),
    "error_rate_percent": (AlertKind.HIGH_ERROR_RATE, "Tasa de errores", " %"),
    "latency_p95_ms": (AlertKind.HIGH_LATENCY, "Latencia p95", " ms"),
}


def _active(environment, kind):
    return (
        Alert.objects.select_for_update()
        .filter(environment=environment, kind=kind, status__in=ACTIVE_ALERT_STATUSES)
        .first()
    )


def raise_alert(
    environment: Environment,
    kind: str,
    *,
    severity: str,
    message: str,
    value: float | None = None,
    threshold: float | None = None,
    at=None,
) -> Alert:
    now = at or timezone.now()
    for _attempt in range(2):
        try:
            with transaction.atomic():
                alert = _active(environment, kind)
                if alert is None:
                    return Alert.objects.create(
                        environment=environment,
                        kind=kind,
                        severity=severity,
                        message=message[:255],
                        value=value,
                        threshold=threshold,
                        opened_at=now,
                        last_seen_at=now,
                    )
                alert.severity = severity
                alert.message = message[:255]
                alert.value = value
                alert.threshold = threshold
                alert.last_seen_at = max(alert.last_seen_at, now)
                alert.hits += 1
                alert.save(
                    update_fields=[
                        "severity",
                        "message",
                        "value",
                        "threshold",
                        "last_seen_at",
                        "hits",
                        "updated_at",
                    ]
                )
                return alert
        except IntegrityError:
            # A concurrent writer opened the same alert: retry once and refresh it.
            continue
    raise RuntimeError("No se pudo registrar la alerta")  # pragma: no cover


def resolve_condition(environment: Environment, kind: str, *, at=None) -> Alert | None:
    """Automatic resolution: the condition that opened the alert is no longer present."""
    with transaction.atomic():
        alert = _active(environment, kind)
        if alert is None:
            return None
        alert.status = AlertStatus.RESOLVED
        alert.resolved_at = at or timezone.now()
        alert.save(update_fields=["status", "resolved_at", "updated_at"])
        return alert


# --- evaluation ------------------------------------------------------------------------


def evaluate_sample(sample: MetricSample) -> None:
    """Apply threshold rules to the newest sample of an environment."""
    newer = MetricSample.objects.filter(
        environment_id=sample.environment_id, recorded_at__gt=sample.recorded_at
    ).exists()
    if newer:
        return  # a late, out-of-order sample never overrides the current state
    env = sample.environment
    resolve_condition(env, AlertKind.METRICS_STALE, at=sample.recorded_at)
    for field, (kind, label, unit) in METRIC_RULES.items():
        value = getattr(sample, field)
        if value is None:
            continue
        warn, crit = settings.MONITOR_ALERT_THRESHOLDS[field]
        if value >= warn:
            severity = Severity.CRITICAL if value >= crit else Severity.WARNING
            raise_alert(
                env,
                kind,
                severity=severity,
                message=f"{label} en {value:.0f}{unit} (umbral {warn}{unit})",
                value=float(value),
                threshold=float(warn),
                at=sample.recorded_at,
            )
        else:
            resolve_condition(env, kind, at=sample.recorded_at)


def evaluate_stale_metrics(now=None) -> int:
    """Open METRICS_STALE for environments whose agent stopped reporting. Returns opened count.

    Only environments that reported in the last 24 h are considered: a decommissioned agent
    does not keep alerting forever (its last alert stays until someone resolves it).
    """
    now = now or timezone.now()
    limit = settings.MONITOR_METRICS_STALE_SECONDS
    cutoff = now - timedelta(seconds=limit)
    quiet = (
        MetricSample.objects.filter(
            recorded_at__gte=now - timedelta(hours=24),
            environment__status=EnvironmentStatus.ACTIVE,
        )
        .values("environment_id")
        .annotate(last=Max("recorded_at"))
        .filter(last__lt=cutoff)
    )
    opened = 0
    already = set(
        Alert.objects.filter(
            kind=AlertKind.METRICS_STALE, status__in=ACTIVE_ALERT_STATUSES
        ).values_list("environment_id", flat=True)
    )
    for row in quiet:
        if row["environment_id"] in already:
            continue
        env = Environment.objects.select_related("project").get(pk=row["environment_id"])
        minutes = int((now - row["last"]).total_seconds() // 60)
        raise_alert(
            env,
            AlertKind.METRICS_STALE,
            severity=Severity.WARNING,
            message=f"La aplicación no reporta métricas desde hace {minutes} min",
            at=now,
        )
        opened += 1
    return opened


def on_health_status(check, new_status: str, error: str, *, at) -> None:
    """Keep SERVICE_DOWN / SLOW_RESPONSE in sync with a health-check transition."""
    from .models import HealthStatus

    env = check.environment
    if new_status == HealthStatus.UNAVAILABLE:
        resolve_condition(env, AlertKind.SLOW_RESPONSE, at=at)
        raise_alert(
            env,
            AlertKind.SERVICE_DOWN,
            severity=Severity.CRITICAL if env.kind == "PRODUCTION" else Severity.ERROR,
            message=f"{env.display_name} no responde: {error or 'sin respuesta'}",
            at=at,
        )
    elif new_status == HealthStatus.DEGRADED:
        resolve_condition(env, AlertKind.SERVICE_DOWN, at=at)
        raise_alert(
            env,
            AlertKind.SLOW_RESPONSE,
            severity=Severity.WARNING,
            message=f"{env.display_name} degradado: {error or 'respuesta lenta'}",
            value=check.last_response_ms,
            threshold=check.degraded_threshold_ms,
            at=at,
        )
    else:
        resolve_condition(env, AlertKind.SERVICE_DOWN, at=at)
        resolve_condition(env, AlertKind.SLOW_RESPONSE, at=at)


# --- manual actions --------------------------------------------------------------------


@transaction.atomic
def acknowledge(alert: Alert, *, actor, request=None) -> Alert:
    alert = Alert.objects.select_for_update().get(pk=alert.pk)
    if alert.status != AlertStatus.OPEN:
        raise DomainError("Solo se pueden reconocer alertas abiertas.", code="not_open")
    alert.status = AlertStatus.ACKNOWLEDGED
    alert.acknowledged_at = timezone.now()
    alert.acknowledged_by = actor
    alert.save(update_fields=["status", "acknowledged_at", "acknowledged_by", "updated_at"])
    audit.record(AuditAction.ALERT_ACKNOWLEDGED, actor=actor, target=alert, request=request)
    return alert


@transaction.atomic
def resolve(alert: Alert, *, actor, request=None) -> Alert:
    alert = Alert.objects.select_for_update().get(pk=alert.pk)
    if alert.status == AlertStatus.RESOLVED:
        raise DomainError("La alerta ya está resuelta.", code="already_resolved")
    alert.status = AlertStatus.RESOLVED
    alert.resolved_at = timezone.now()
    alert.resolved_by = actor
    alert.save(update_fields=["status", "resolved_at", "resolved_by", "updated_at"])
    audit.record(AuditAction.ALERT_RESOLVED, actor=actor, target=alert, request=request)
    return alert


def resolve_for_environment(environment, kinds, *, at=None) -> None:
    for kind in kinds:
        resolve_condition(environment, kind, at=at)
