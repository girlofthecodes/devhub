"""Client-portal logic: authorized projects, published versions and secure demo access."""

import hashlib
import secrets
from datetime import timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from django.conf import settings
from django.db import transaction
from django.db.models import Exists, OuterRef, QuerySet, Subquery
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditAction
from apps.audit.services import client_ip
from apps.infrastructure.models import Environment, EnvironmentKind, EnvironmentStatus
from apps.organizations.models import Organization
from apps.projects import selectors as project_selectors
from apps.projects.models import Project, ProjectAccess, Release, ReleaseStatus
from apps.traceability import services as trace
from apps.traceability.models import EventSource, EventType
from apps.users.models import User
from common.exceptions import DomainError

from .models import DemoAccessToken

DEMO_QUERY_PARAM = "devhub_demo_token"


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def demo_environments() -> QuerySet[Environment]:
    """Demo environments a client may open: active and with a public URL."""
    return Environment.objects.filter(
        kind=EnvironmentKind.DEMO, status=EnvironmentStatus.ACTIVE
    ).exclude(public_url="")


def client_projects(user: User) -> QuerySet[Project]:
    """Projects shared with the client, annotated with what the portal shows."""
    latest_release = Release.objects.filter(
        project=OuterRef("pk"), status=ReleaseStatus.PUBLISHED
    ).order_by("-published_at")
    return (
        project_selectors.projects_shared_with_client(user)
        .annotate(
            published_version=Subquery(latest_release.values("version")[:1]),
            published_at=Subquery(latest_release.values("published_at")[:1]),
            has_demo=Exists(demo_environments().filter(project=OuterRef("pk"))),
        )
        .order_by("name")
    )


def access_for(user: User, project: Project) -> list[ProjectAccess]:
    """Current grants through which the user sees the project (for display)."""
    return list(
        ProjectAccess.objects.current()
        .filter(
            project=project,
            organization__is_active=True,
            organization__memberships__user=user,
        )
        .select_related("organization")
        .distinct()
    )


def published_releases(project: Project) -> QuerySet[Release]:
    return Release.objects.filter(project=project, status=ReleaseStatus.PUBLISHED).order_by(
        "-published_at"
    )


def _with_query_param(url: str, key: str, value: str) -> str:
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != key]
    query.append((key, value))
    return urlunsplit(parts._replace(query=urlencode(query)))


@transaction.atomic
def issue_demo_access(*, user: User, project: Project, request=None) -> tuple[str, DemoAccessToken]:
    """Return (launch_url, token) for an authorized client. Raises DomainError otherwise."""
    if not client_projects(user).filter(pk=project.pk).exists():
        raise DomainError("No tienes acceso a esta aplicación.", code="not_authorized")
    environment = demo_environments().filter(project=project).first()
    if environment is None:
        raise DomainError(
            "Esta aplicación no tiene una demostración disponible.", code="demo_unavailable"
        )
    grants = access_for(user, project)
    organization: Organization | None = grants[0].organization if grants else None
    raw = secrets.token_urlsafe(32)
    token = DemoAccessToken.objects.create(
        environment=environment,
        user=user,
        organization=organization,
        token_hash=_hash(raw),
        expires_at=timezone.now() + timedelta(seconds=settings.DEMO_TOKEN_TTL_SECONDS),
        issued_ip=client_ip(request),
    )
    trace.emit(
        EventType.ACCESS_GRANTED,
        description=f"Acceso temporal a la demo emitido para {user.email}",
        environment=environment,
        source=EventSource.USER,
        actor=user,
        metadata={
            "kind": "demo_ticket",
            "organization": organization.name if organization else None,
            "expires_at": token.expires_at,
        },
    )
    audit.record(
        AuditAction.DEMO_ACCESS_ISSUED,
        actor=user,
        target=project,
        metadata={"environment": environment.kind, "expires_at": token.expires_at},
        request=request,
    )
    return _with_query_param(environment.public_url, DEMO_QUERY_PARAM, raw), token


@transaction.atomic
def redeem_demo_access(*, raw: str, service_token) -> DemoAccessToken:
    """Validate and consume a demo ticket on behalf of a demo application.

    Every failure returns the same generic error so the endpoint cannot be used to probe
    which tickets exist.
    """
    invalid = DomainError(
        "Ticket de demo no válido, expirado o ya utilizado.", code="invalid_ticket"
    )
    if not raw or len(raw) > 200:
        raise invalid
    token = (
        DemoAccessToken.objects.select_for_update(of=("self",))
        .select_related("environment__project", "user", "organization")
        .filter(token_hash=_hash(raw))
        .first()
    )
    now = timezone.now()
    if token is None or token.redeemed_at is not None or token.expires_at <= now:
        raise invalid
    project = token.environment.project
    # The service token must be scoped to the demo's project.
    if not service_token.projects.filter(pk=project.pk).exists():
        raise invalid
    # Re-check authorization at redemption time (access may have been revoked meanwhile).
    if not token.user.is_active or not client_projects(token.user).filter(pk=project.pk).exists():
        raise invalid
    if token.environment.status != EnvironmentStatus.ACTIVE:
        raise invalid
    token.redeemed_at = now
    token.redeemed_by_service = service_token.name[:80]
    token.session_expires_at = now + timedelta(minutes=settings.DEMO_SESSION_MINUTES)
    token.save(update_fields=["redeemed_at", "redeemed_by_service", "session_expires_at"])
    return token
