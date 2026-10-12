"""Bearer-token authentication for CI/CD integrations.

Only the integration endpoints enable this class; every other endpoint keeps session
authentication, so a leaked service token can never act as a user.
"""

from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

from .models import ServiceToken
from .services import authenticate_service_token


class ServicePrincipal:
    """Stand-in for request.user when a service token authenticates."""

    is_authenticated = True
    is_anonymous = False
    is_active = True
    role = None
    pk = None

    def __init__(self, token: ServiceToken):
        self.token = token
        self.email = f"token:{token.name}"

    def __str__(self) -> str:
        return self.email


class ServiceTokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts or parts[0].lower() != b"bearer":
            return None
        if len(parts) != 2:
            raise AuthenticationFailed("Encabezado Authorization no válido.")
        token = authenticate_service_token(parts[1].decode("utf-8", errors="ignore"))
        if token is None:
            raise AuthenticationFailed("Token no válido, expirado o revocado.")
        return ServicePrincipal(token), token

    def authenticate_header(self, request) -> str:
        return 'Bearer realm="devhub-integrations"'


class IsServiceToken(BasePermission):
    message = "Se requiere un token de servicio."

    def has_permission(self, request, view) -> bool:
        return isinstance(request.auth, ServiceToken)
