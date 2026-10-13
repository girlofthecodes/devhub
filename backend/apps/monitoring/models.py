from datetime import timedelta

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
