"""Role-based permission classes. Object scoping is done in each view's get_queryset."""

from django.db import models
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.users.roles import Role


def _role_of(user) -> str | None:
    if not user or not user.is_authenticated or not user.is_active:
        return None
    return user.role


def _role(request) -> str | None:
    return _role_of(request.user)


class IsAdmin(BasePermission):
    message = "Se requiere rol de administrador."

    def has_permission(self, request, view) -> bool:
        return _role(request) == Role.ADMIN


class IsStaffMember(BasePermission):
    """Administrators and developers (internal team)."""

    message = "Acceso restringido al equipo interno."

    def has_permission(self, request, view) -> bool:
        return _role(request) in {Role.ADMIN, Role.DEVELOPER}


class IsAdminOrReadOnly(BasePermission):
    message = "Solo los administradores pueden modificar este recurso."

    def has_permission(self, request, view) -> bool:
        role = _role(request)
        if role is None:
            return False
        return request.method in SAFE_METHODS or role == Role.ADMIN


# --- finance (Fase 7) ---------------------------------------------------------------------
# Administrators always have full finance access. Developers only with explicit per-user
# permissions (never by role). Clients and visitors never.

FINANCE_VIEW_CODENAME = "view_finance"
FINANCE_MANAGE_CODENAME = "manage_finance"


class FinanceAccess(models.TextChoices):
    NONE = "NONE", "Sin acceso"
    VIEW = "VIEW", "Consulta"
    MANAGE = "MANAGE", "Gestión"


def finance_access_level(user) -> str:
    role = _role_of(user)
    if role == Role.ADMIN:
        return FinanceAccess.MANAGE
    if role == Role.DEVELOPER:
        if user.has_perm(f"commercial.{FINANCE_MANAGE_CODENAME}"):
            return FinanceAccess.MANAGE
        if user.has_perm(f"commercial.{FINANCE_VIEW_CODENAME}"):
            return FinanceAccess.VIEW
    return FinanceAccess.NONE


class HasFinanceAccess(BasePermission):
    """Read requires VIEW or MANAGE; any write requires MANAGE."""

    message = "No tienes permisos para el módulo financiero."

    def has_permission(self, request, view) -> bool:
        if _role(request) is None:
            return False
        level = finance_access_level(request.user)
        if request.method in SAFE_METHODS:
            return level in {FinanceAccess.VIEW, FinanceAccess.MANAGE}
        return level == FinanceAccess.MANAGE
