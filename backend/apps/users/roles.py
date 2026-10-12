"""DevHub roles. Each role is backed by a Django Group with the same name."""

from django.db import models


class Role(models.TextChoices):
    ADMIN = "ADMIN", "Administrador"
    DEVELOPER = "DEVELOPER", "Desarrollador"
    CLIENT = "CLIENT", "Cliente"
    VISITOR = "VISITOR", "Visitante"


ROLE_NAMES = frozenset(Role.values)

# Django model permissions granted to each group (used by the Django admin site and
# available to `user.has_perm`). API authorization additionally relies on role
# permission classes and object-scoped querysets.
ROLE_MODEL_PERMISSIONS: dict[str, dict[str, tuple[str, ...]]] = {
    Role.ADMIN: {
        "users.user": ("add", "change", "view"),
        "organizations.organization": ("add", "change", "view"),
        "organizations.membership": ("add", "change", "delete", "view"),
        "audit.auditlog": ("view",),
        "projects.project": ("add", "change", "view"),
        "projects.projectmember": ("add", "change", "delete", "view"),
        "projects.projectaccess": ("add", "change", "view"),
    },
    Role.DEVELOPER: {
        "organizations.organization": ("view",),
        "projects.project": ("change", "view"),
        "projects.projectmember": ("view",),
    },
    Role.CLIENT: {},
    Role.VISITOR: {},
}
