from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.dispatch import receiver

from apps.audit.services import client_ip

from .models import UserSession


@receiver(user_logged_in)
def track_session(sender, request, user, **kwargs):
    session_key = request.session.session_key
    if not session_key:
        request.session.save()
        session_key = request.session.session_key
    UserSession.objects.update_or_create(
        session_key=session_key,
        defaults={
            "user": user,
            "ip_address": client_ip(request),
            "user_agent": request.META.get("HTTP_USER_AGENT", "")[:256],
        },
    )


@receiver(user_logged_out)
def untrack_session(sender, request, user, **kwargs):
    session_key = request.session.session_key
    if session_key:
        UserSession.objects.filter(session_key=session_key).delete()
