"""OpenAPI description of the portal-bound session authentication."""

from drf_spectacular.authentication import SessionScheme


class PortalSessionScheme(SessionScheme):
    target_class = "apps.users.authentication.PortalSessionAuthentication"
    name = "cookieAuth"
