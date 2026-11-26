from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from common.models import TimeStampedModel, UUIDModel


class HealthStatus(models.TextChoices):
    HEALTHY = "HEALTHY", "Disponible"
    DEGRADED = "DEGRADED", "Degradado"
    UNAVAILABLE = "UNAVAILABLE", "No disponible"
    UNKNOWN = "UNKNOWN", "Desconocido"


class HealthCheck(TimeStampedModel):
    """Periodic HTTP check of an environment's public URL (plus a fixed path).

    The target host always comes from Environment.public_url, which is already validated as
    a public https domain; users never type an arbitrary URL here.
    """

    environment = models.OneToOneField(
        "infrastructure.Environment", on_delete=models.CASCADE, related_name="health_check"
    )
    path = models.CharField("ruta", max_length=200, default="/")
    expected_status_min = models.PositiveSmallIntegerField(default=200)
    expected_status_max = models.PositiveSmallIntegerField(default=399)
    interval_seconds = models.PositiveIntegerField("intervalo", default=300)
    timeout_seconds = models.PositiveSmallIntegerField("timeout", default=5)
    degraded_threshold_ms = models.PositiveIntegerField("umbral de degradación", default=2000)
    failure_threshold = models.PositiveSmallIntegerField(
        "fallos para marcar caída",
        default=2,
        help_text="Fallos consecutivos antes de considerar el servicio no disponible.",
    )
    enabled = models.BooleanField("activo", default=True, db_index=True)

    # Last known state (written only by the monitor).
    status = models.CharField(
        max_length=16, choices=HealthStatus.choices, default=HealthStatus.UNKNOWN, db_index=True
    )
    last_checked_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_response_ms = models.PositiveIntegerField(null=True, blank=True)
    last_status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    last_error = models.CharField(max_length=255, blank=True)
    consecutive_failures = models.PositiveIntegerField(default=0)
    status_changed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["environment__project__name", "environment__kind"]

    def __str__(self) -> str:
        return f"check {self.environment}"

    @property
    def target_url(self) -> str:
        return self.environment.public_url.rstrip("/") + self.path

    @property
    def is_stale(self) -> bool:
        """True when the last result is too old to be trusted (monitor stopped or delayed)."""
        if self.last_checked_at is None:
            return False
        limit = timedelta(seconds=max(self.interval_seconds * 3, 180))
        return timezone.now() - self.last_checked_at > limit

    @property
    def effective_status(self) -> str:
        if not self.enabled or self.last_checked_at is None or self.is_stale:
            return HealthStatus.UNKNOWN
        return self.status


class CheckResult(UUIDModel):
    health_check = models.ForeignKey(HealthCheck, on_delete=models.CASCADE, related_name="results")
    checked_at = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=16, choices=HealthStatus.choices)
    response_ms = models.PositiveIntegerField(null=True, blank=True)
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    error = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-checked_at"]
        indexes = [models.Index(fields=["health_check", "-checked_at"])]

    def __str__(self) -> str:
        return f"{self.health_check_id} {self.checked_at:%H:%M:%S} {self.status}"


# --- internal metrics (pushed by each application) -----------------------------------


class MetricSample(UUIDModel):
    """Internal metrics reported by the application itself (agent or middleware).

    Push model: the app sends its own numbers with a project-scoped service token, so DevHub
    never connects to internal addresses to collect them.
    """

    environment = models.ForeignKey(
        "infrastructure.Environment", on_delete=models.CASCADE, related_name="metric_samples"
    )
    recorded_at = models.DateTimeField(db_index=True)
    received_at = models.DateTimeField(auto_now_add=True)
    cpu_percent = models.FloatField("CPU (%)", null=True, blank=True)
    memory_percent = models.FloatField("memoria (%)", null=True, blank=True)
    memory_used_mb = models.PositiveIntegerField("memoria usada (MB)", null=True, blank=True)
    requests_per_minute = models.FloatField("peticiones/min", null=True, blank=True)
    error_rate_percent = models.FloatField("tasa de errores (%)", null=True, blank=True)
    latency_p95_ms = models.PositiveIntegerField("latencia p95 (ms)", null=True, blank=True)
    active_connections = models.PositiveIntegerField("conexiones activas", null=True, blank=True)
    process_uptime_seconds = models.PositiveBigIntegerField(
        "tiempo de actividad del proceso (s)", null=True, blank=True
    )

    class Meta:
        ordering = ["-recorded_at"]
        indexes = [models.Index(fields=["environment", "-recorded_at"])]

    def __str__(self) -> str:
        return f"{self.environment_id} {self.recorded_at:%H:%M:%S}"


METRIC_FIELDS = (
    "cpu_percent",
    "memory_percent",
    "memory_used_mb",
    "requests_per_minute",
    "error_rate_percent",
    "latency_p95_ms",
    "active_connections",
    "process_uptime_seconds",
)


# --- alerts ----------------------------------------------------------------------------


class AlertKind(models.TextChoices):
    SERVICE_DOWN = "SERVICE_DOWN", "Servicio caído"
    SLOW_RESPONSE = "SLOW_RESPONSE", "Servicio degradado"
    HIGH_CPU = "HIGH_CPU", "CPU alta"
    HIGH_MEMORY = "HIGH_MEMORY", "Memoria alta"
    HIGH_ERROR_RATE = "HIGH_ERROR_RATE", "Tasa de errores alta"
    HIGH_LATENCY = "HIGH_LATENCY", "Latencia alta"
    METRICS_STALE = "METRICS_STALE", "Sin métricas recientes"


class AlertStatus(models.TextChoices):
    OPEN = "OPEN", "Abierta"
    ACKNOWLEDGED = "ACKNOWLEDGED", "Reconocida"
    RESOLVED = "RESOLVED", "Resuelta"


ACTIVE_ALERT_STATUSES = (AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED)


class Alert(TimeStampedModel):
    """A condition that needs attention. At most one active alert per (environment, kind)."""

    environment = models.ForeignKey(
        "infrastructure.Environment", on_delete=models.CASCADE, related_name="alerts"
    )
    kind = models.CharField(max_length=20, choices=AlertKind.choices, db_index=True)
    severity = models.CharField(max_length=10, default="WARNING", db_index=True)
    status = models.CharField(
        max_length=14, choices=AlertStatus.choices, default=AlertStatus.OPEN, db_index=True
    )
    message = models.CharField(max_length=255)
    value = models.FloatField(null=True, blank=True)
    threshold = models.FloatField(null=True, blank=True)
    hits = models.PositiveIntegerField("detecciones", default=1)
    opened_at = models.DateTimeField(db_index=True)
    last_seen_at = models.DateTimeField()
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True, db_index=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-opened_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["environment", "kind"],
                condition=~models.Q(status="RESOLVED"),
                name="alert_one_active_per_environment_kind",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} · {self.environment}"

    @property
    def is_active(self) -> bool:
        return self.status != AlertStatus.RESOLVED

    @property
    def duration_seconds(self) -> int:
        end = self.resolved_at or timezone.now()
        return max(0, int((end - self.opened_at).total_seconds()))
