"""Role-based permission classes. Object scoping is done in each view's get_queryset."""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.users.roles import Role


def _role(request) -> str | None:
    user = request.user
    if not user or not user.is_authenticated or not user.is_active:
        return None
    return user.role


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
