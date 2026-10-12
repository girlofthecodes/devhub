from typing import Any

from django.db import models

from common.sanitize import sanitize

from .models import AuditLog


def client_ip(request) -> str | None:
    """Client IP honoring the configured number of trusted proxies."""
    if request is None:
        return None
    from rest_framework.settings import api_settings

    num_proxies = api_settings.NUM_PROXIES or 0
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if num_proxies > 0 and xff:
        addrs = [a.strip() for a in xff.split(",") if a.strip()]
        if addrs:
            return addrs[-min(num_proxies, len(addrs))]
    return request.META.get("REMOTE_ADDR") or None


def record(
    action: str,
    *,
    actor=None,
    target: models.Model | None = None,
    changes: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    request=None,
) -> AuditLog:
    if actor is not None and not getattr(actor, "is_authenticated", False):
        actor = None
    return AuditLog.objects.create(
        action=action,
        actor=actor,
        actor_email=getattr(actor, "email", "") or "",
        target_type=target._meta.label_lower if target is not None else "",
        target_id=str(target.pk) if target is not None else "",
        target_repr=str(target)[:255] if target is not None else "",
        changes=sanitize(changes or {}),
        metadata=sanitize(metadata or {}),
        ip_address=client_ip(request),
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:256] if request else ""),
        request_id=getattr(request, "request_id", "") if request else "",
    )


def diff(instance: models.Model, data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return {field: {"from": old, "to": new}} for fields whose value changes."""
    changes = {}
    for field, new in data.items():
        old = getattr(instance, field, None)
        if old != new:
            changes[field] = {"from": old, "to": new}
    return changes
