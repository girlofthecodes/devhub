from django.conf import settings
from django.db import models

from apps.audit.models import ImmutableRecordError
from common.models import UUIDModel


class EventType(models.TextChoices):
    PROJECT_CREATED = "PROJECT_CREATED", "Proyecto creado"
    PROJECT_UPDATED = "PROJECT_UPDATED", "Proyecto actualizado"
    DEPLOYMENT_STARTED = "DEPLOYMENT_STARTED", "Despliegue iniciado"
    DEPLOYMENT_SUCCESS = "DEPLOYMENT_SUCCESS", "Despliegue exitoso"
    DEPLOYMENT_FAILED = "DEPLOYMENT_FAILED", "Despliegue fallido"
    # Documented extension of the original list.
    DEPLOYMENT_CANCELLED = "DEPLOYMENT_CANCELLED", "Despliegue cancelado"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE", "Servicio no disponible"
    SERVICE_RECOVERED = "SERVICE_RECOVERED", "Servicio recuperado"
    ACCESS_GRANTED = "ACCESS_GRANTED", "Acceso concedido"
    ACCESS_REVOKED = "ACCESS_REVOKED", "Acceso revocado"
    CONFIGURATION_CHANGED = "CONFIGURATION_CHANGED", "Configuración modificada"


class Severity(models.TextChoices):
    INFO = "INFO", "Información"
    WARNING = "WARNING", "Advertencia"
    ERROR = "ERROR", "Error"
    CRITICAL = "CRITICAL", "Crítico"


class EventSource(models.TextChoices):
    SYSTEM = "SYSTEM", "Sistema"
    USER = "USER", "Usuario"
    GITHUB_ACTIONS = "GITHUB_ACTIONS", "GitHub Actions"
    API = "API", "Integración API"
    MONITORING = "MONITORING", "Monitoreo"


class EventQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ImmutableRecordError("Trace events cannot be modified.")

    def delete(self):
        raise ImmutableRecordError("Trace events cannot be deleted. Use the retention purge.")


class Event(UUIDModel):
    """Append-only trace event. Also protected by a PostgreSQL trigger (see migration 0002)."""

    occurred_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    project = models.ForeignKey(
        "projects.Project", null=True, blank=True, on_delete=models.SET_NULL, related_name="events"
    )
    environment = models.ForeignKey(
        "infrastructure.Environment",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    deployment = models.ForeignKey(
        "deployments.Deployment",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    event_type = models.CharField(max_length=32, choices=EventType.choices, db_index=True)
    severity = models.CharField(
        max_length=10, choices=Severity.choices, default=Severity.INFO, db_index=True
    )
    source = models.CharField(
        max_length=16, choices=EventSource.choices, default=EventSource.SYSTEM
    )
    correlation_id = models.CharField(max_length=64, blank=True, db_index=True)
    description = models.CharField(max_length=255)
    metadata = models.JSONField(default=dict, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    actor_label = models.CharField(max_length=150, blank=True)

    objects = EventQuerySet.as_manager()

    class Meta:
        ordering = ["-occurred_at", "-created_at"]
        indexes = [models.Index(fields=["project", "-occurred_at"])]

    def __str__(self) -> str:
        return f"{self.occurred_at:%Y-%m-%d %H:%M} {self.event_type}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ImmutableRecordError("Trace events cannot be modified.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableRecordError("Trace events cannot be deleted.")
