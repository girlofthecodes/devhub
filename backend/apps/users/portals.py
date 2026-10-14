"""Portal context: which interface (admin panel or client portal) a session belongs to.

A user may hold an internal role (ADMIN/DEVELOPER) and, additionally, client access
(the CLIENT group plus organization memberships). The portal chosen at login is stored in
the session and decides the *effective* role for the whole session, so a session opened
in the client portal can never reach admin endpoints (and vice versa), regardless of what
the frontend shows.
"""

from django.db import models

from .models import User
from .roles import Role

PORTAL_SESSION_KEY = "devhub_portal"

STAFF_ROLES = frozenset({Role.ADMIN, Role.DEVELOPER})


class Portal(models.TextChoices):
    ADMIN = "admin", "Panel administrativo"
    CLIENT = "client", "Portal de clientes"


DENIED_MESSAGES = {
    Portal.ADMIN: "Tu cuenta no tiene permisos para acceder al panel administrativo.",
    Portal.CLIENT: "Tu cuenta no tiene acceso al portal de clientes.",
}


def _group_names(user: User) -> set[str]:
    return set(user.groups.values_list("name", flat=True))


def role_for_portal(user: User, portal: str) -> str | None:
    """Effective role of `user` inside `portal`, or None when the portal is not allowed.

    - Admin panel: the user's internal role (ADMIN or DEVELOPER).
    - Client portal: CLIENT when the user belongs to the CLIENT group (primary role or
      additional client access); VISITOR keeps its existing read-only portal home.
    """
    if not user.is_active:
        return None
    primary = user.primary_role()
    if portal == Portal.ADMIN:
        return primary if primary in STAFF_ROLES else None
    if portal == Portal.CLIENT:
        if Role.CLIENT in _group_names(user):
            return Role.CLIENT
        return Role.VISITOR if primary == Role.VISITOR else None
    return None


def has_client_access(user: User) -> bool:
    return Role.CLIENT in _group_names(user)


def available_portals(user: User) -> list[str]:
    return [p.value for p in Portal if role_for_portal(user, p) is not None]


def apply_portal_context(user: User, portal: str | None) -> None:
    """Pin the effective role of an authenticated user for the current request.

    Sessions without a portal (e.g. the Django admin site) keep the primary role.
    """
    if portal in Portal.values:
        user.__dict__["role"] = role_for_portal(user, portal)
        user.__dict__["portal"] = portal
    else:
        user.__dict__["portal"] = None
