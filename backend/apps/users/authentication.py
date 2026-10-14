from rest_framework.authentication import SessionAuthentication

from .portals import PORTAL_SESSION_KEY, apply_portal_context


class PortalSessionAuthentication(SessionAuthentication):
    """Session authentication (with CSRF) whose effective role follows the session portal."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is not None:
            apply_portal_context(result[0], request._request.session.get(PORTAL_SESSION_KEY))
        return result
