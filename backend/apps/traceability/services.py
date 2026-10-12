"""Emission of trace events. Only backend code and authorized integrations call this."""

from typing import Any

from django.utils import timezone

from common.middleware import get_request_id
from common.sanitize import sanitize

from .models import Event, EventSource, EventType, Severity


def emit(
    event_type: str,
    *,
    description: str,
    project=None,
    environment=None,
    deployment=None,
    severity: str = Severity.INFO,
    source: str = EventSource.SYSTEM,
    correlation_id: str = "",
    metadata: dict[str, Any] | None = None,
    actor=None,
    actor_label: str = "",
    occurred_at=None,
) -> Event:
    if event_type not in EventType.values:
        raise ValueError(f"Unknown event type: {event_type}")
    if environment is not None and project is None:
        project = environment.project
    if actor is not None and not getattr(actor, "is_authenticated", False):
        actor = None
    if actor is not None and not actor_label:
        actor_label = actor.email
    request_id = get_request_id()
    return Event.objects.create(
        event_type=event_type,
        description=description[:255],
        project=project,
        environment=environment,
        deployment=deployment,
        severity=severity,
        source=source,
        correlation_id=correlation_id or ("" if request_id == "-" else request_id),
        metadata=sanitize(metadata or {}),
        actor=actor,
        actor_label=actor_label[:150],
        occurred_at=occurred_at or timezone.now(),
    )


def source_for(actor) -> str:
    return EventSource.USER if getattr(actor, "is_authenticated", False) else EventSource.SYSTEM
