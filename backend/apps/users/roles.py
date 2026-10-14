"""DevHub roles. Each role is backed by a Django Group with the same name."""

from django.db import models


class Role(models.TextChoices):
    ADMIN = "ADMIN", "Administrador"
    DEVELOPER = "DEVELOPER", "Desarrollador"
    CLIENT = "CLIENT", "Cliente"
    VISITOR = "VISITOR", "Visitante"


ROLE_NAMES = frozenset(Role.values)

CUSTOM_PERMISSIONS = frozenset({"view_finance", "manage_finance"})

# Django model permissions granted to each group (used by the Django admin site and
# available to `user.has_perm`). API authorization additionally relies on role
# permission classes and object-scoped querysets. Entries are "<action>_<model>" codenames,
# except custom permissions, listed by their full codename (e.g. "view_finance").
# Developers never get finance permissions by role: only explicitly, per user.
ROLE_MODEL_PERMISSIONS: dict[str, dict[str, tuple[str, ...]]] = {
    Role.ADMIN: {
        "users.user": ("add", "change", "view"),
        "organizations.organization": ("add", "change", "view"),
        "organizations.membership": ("add", "change", "delete", "view"),
        "audit.auditlog": ("view",),
        "projects.project": ("add", "change", "view"),
        "projects.projectmember": ("add", "change", "delete", "view"),
        "projects.projectaccess": ("add", "change", "view"),
        "infrastructure.server": ("add", "change", "view"),
        "infrastructure.environment": ("add", "change", "view"),
        "deployments.deployment": ("add", "view"),
        "deployments.servicetoken": ("view",),
        "traceability.event": ("view",),
        "projects.release": ("add", "change", "view"),
        "monitoring.healthcheck": ("add", "change", "view"),
        "monitoring.checkresult": ("view",),
        "commercial.commercialprofile": ("view_finance", "manage_finance"),
    },
    Role.DEVELOPER: {
        "organizations.organization": ("view",),
        "projects.project": ("change", "view"),
        "projects.projectmember": ("view",),
        "infrastructure.server": ("view",),
        "infrastructure.environment": ("add", "change", "view"),
        "deployments.deployment": ("add", "view"),
        "traceability.event": ("view",),
        "projects.release": ("add", "change", "view"),
        "monitoring.healthcheck": ("add", "change", "view"),
        "monitoring.checkresult": ("view",),
    },
    Role.CLIENT: {},
    Role.VISITOR: {},
}
