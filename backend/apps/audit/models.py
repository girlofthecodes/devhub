from django.conf import settings
from django.db import models

from common.models import UUIDModel


class AuditAction(models.TextChoices):
    LOGIN_SUCCEEDED = "LOGIN_SUCCEEDED", "Inicio de sesión"
    LOGIN_FAILED = "LOGIN_FAILED", "Inicio de sesión fallido"
    LOGOUT = "LOGOUT", "Cierre de sesión"
    PASSWORD_CHANGED = "PASSWORD_CHANGED", "Contraseña cambiada"
    PASSWORD_RESET_REQUESTED = "PASSWORD_RESET_REQUESTED", "Recuperación solicitada"
    PASSWORD_RESET_COMPLETED = "PASSWORD_RESET_COMPLETED", "Contraseña restablecida"
    USER_CREATED = "USER_CREATED", "Usuario creado"
    USER_UPDATED = "USER_UPDATED", "Usuario actualizado"
    USER_ROLE_CHANGED = "USER_ROLE_CHANGED", "Rol cambiado"
    USER_ACTIVATED = "USER_ACTIVATED", "Usuario activado"
    USER_DEACTIVATED = "USER_DEACTIVATED", "Usuario desactivado"
    USER_SESSIONS_REVOKED = "USER_SESSIONS_REVOKED", "Sesiones revocadas"
    ORGANIZATION_CREATED = "ORGANIZATION_CREATED", "Organización creada"
    ORGANIZATION_UPDATED = "ORGANIZATION_UPDATED", "Organización actualizada"
    ORGANIZATION_ACTIVATED = "ORGANIZATION_ACTIVATED", "Organización activada"
    ORGANIZATION_DEACTIVATED = "ORGANIZATION_DEACTIVATED", "Organización desactivada"
    MEMBERSHIP_ADDED = "MEMBERSHIP_ADDED", "Miembro agregado"
    MEMBERSHIP_UPDATED = "MEMBERSHIP_UPDATED", "Membresía actualizada"
    MEMBERSHIP_REMOVED = "MEMBERSHIP_REMOVED", "Miembro removido"
    PROJECT_CREATED = "PROJECT_CREATED", "Proyecto creado"
    PROJECT_UPDATED = "PROJECT_UPDATED", "Proyecto actualizado"
    PROJECT_ARCHIVED = "PROJECT_ARCHIVED", "Proyecto archivado"
    PROJECT_RESTORED = "PROJECT_RESTORED", "Proyecto restaurado"
    PROJECT_PUBLISHED = "PROJECT_PUBLISHED", "Proyecto publicado en portafolio"
    PROJECT_UNPUBLISHED = "PROJECT_UNPUBLISHED", "Proyecto oculto del portafolio"
    PROJECT_LOGO_UPDATED = "PROJECT_LOGO_UPDATED", "Logotipo actualizado"
    PROJECT_MEMBER_ADDED = "PROJECT_MEMBER_ADDED", "Desarrollador asignado"
    PROJECT_MEMBER_UPDATED = "PROJECT_MEMBER_UPDATED", "Asignación actualizada"
    PROJECT_MEMBER_REMOVED = "PROJECT_MEMBER_REMOVED", "Desarrollador removido"
    ACCESS_GRANTED = "ACCESS_GRANTED", "Acceso concedido"
    ACCESS_UPDATED = "ACCESS_UPDATED", "Acceso actualizado"
    ACCESS_REVOKED = "ACCESS_REVOKED", "Acceso revocado"
    SERVER_CREATED = "SERVER_CREATED", "Servidor registrado"
    SERVER_UPDATED = "SERVER_UPDATED", "Servidor actualizado"
    ENVIRONMENT_CREATED = "ENVIRONMENT_CREATED", "Entorno creado"
    ENVIRONMENT_UPDATED = "ENVIRONMENT_UPDATED", "Entorno actualizado"


class ImmutableRecordError(Exception):
    pass


class AuditLogQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ImmutableRecordError("Audit records cannot be modified.")

    def delete(self):
        raise ImmutableRecordError("Audit records cannot be deleted.")


class AuditLog(UUIDModel):
    """Append-only record of security-relevant and administrative actions."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
    )
    actor_email = models.EmailField(blank=True)
    action = models.CharField(max_length=64, db_index=True)
    target_type = models.CharField(max_length=64, blank=True, db_index=True)
    target_id = models.CharField(max_length=64, blank=True, db_index=True)
    target_repr = models.CharField(max_length=255, blank=True)
    changes = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=256, blank=True)
    request_id = models.CharField(max_length=64, blank=True)

    objects = AuditLogQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["target_type", "target_id"])]

    def __str__(self) -> str:
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.action} {self.target_repr}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ImmutableRecordError("Audit records cannot be modified.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableRecordError("Audit records cannot be deleted.")
