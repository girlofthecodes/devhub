"""Business logic for deployments and CI/CD service tokens."""

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditAction
from apps.infrastructure.models import Environment, EnvironmentStatus
from apps.traceability import services as trace
from apps.traceability.models import EventSource, EventType, Severity
from common.exceptions import DomainError

from .models import (
    ALLOWED_TRANSITIONS,
    TOKEN_PREFIX,
    Deployment,
    DeploymentSource,
    DeploymentStatus,
    ServiceToken,
    hash_token,
)

_EVENT_FOR_STATUS = {
    DeploymentStatus.RUNNING: (EventType.DEPLOYMENT_STARTED, Severity.INFO),
    DeploymentStatus.SUCCESS: (EventType.DEPLOYMENT_SUCCESS, Severity.INFO),
    DeploymentStatus.FAILED: (EventType.DEPLOYMENT_FAILED, Severity.ERROR),
    DeploymentStatus.CANCELLED: (EventType.DEPLOYMENT_CANCELLED, Severity.WARNING),
}
_DESCRIPTION = {
    DeploymentStatus.RUNNING: "Despliegue de {v} iniciado en {env}",
    DeploymentStatus.SUCCESS: "Despliegue de {v} completado en {env}",
    DeploymentStatus.FAILED: "Despliegue de {v} falló en {env}",
    DeploymentStatus.CANCELLED: "Despliegue de {v} cancelado en {env}",
}
_EVENT_SOURCE = {
    DeploymentSource.MANUAL: EventSource.USER,
    DeploymentSource.GITHUB_ACTIONS: EventSource.GITHUB_ACTIONS,
    DeploymentSource.API: EventSource.API,
}


def _env_label(environment: Environment) -> str:
    return f"{environment.project.name} · {environment.get_kind_display()}"


def _ensure_running_slot(deployment: Deployment) -> None:
    others = Deployment.objects.filter(
        environment=deployment.environment, status=DeploymentStatus.RUNNING
    ).exclude(pk=deployment.pk)
    if others.exists():
        raise DomainError(
            "Ya hay un despliegue en curso en este entorno. Finalízalo antes de iniciar otro.",
            code="deployment_in_progress",
        )


def _apply_status(
    deployment: Deployment, status: str, *, message: str, actor, actor_label: str
) -> None:
    current = deployment.status
    if status == current:
        return
    if status not in ALLOWED_TRANSITIONS[current]:
        raise DomainError(
            f"Transición no permitida: {DeploymentStatus(current).label} → "
            f"{DeploymentStatus(status).label}.",
            code="invalid_transition",
            field="status",
        )
    now = timezone.now()
    if status == DeploymentStatus.RUNNING:
        _ensure_running_slot(deployment)
        deployment.started_at = now
    if status in ALLOWED_TRANSITIONS[DeploymentStatus.RUNNING]:  # terminal
        deployment.finished_at = now
    deployment.status = status
    if message:
        deployment.message = message
    deployment.save()

    environment = deployment.environment
    metadata = {
        "version": deployment.version,
        "commit_sha": deployment.commit_sha,
        "branch": deployment.branch,
        "ci_run_id": deployment.ci_run_id,
        "from_status": current,
        "to_status": status,
    }
    if status == DeploymentStatus.SUCCESS:
        metadata["previous_version"] = environment.deployed_version
        environment.deployed_version = deployment.version
        environment.save(update_fields=["deployed_version", "updated_at"])
    if deployment.duration_seconds is not None and deployment.is_terminal:
        metadata["duration_seconds"] = deployment.duration_seconds
    if message:
        metadata["message"] = message[:500]

    event_type, severity = _EVENT_FOR_STATUS[status]
    trace.emit(
        event_type,
        description=_DESCRIPTION[status].format(v=deployment.version, env=_env_label(environment)),
        environment=environment,
        deployment=deployment,
        severity=severity,
        source=_EVENT_SOURCE[deployment.source],
        correlation_id=deployment.correlation_id,
        metadata=metadata,
        actor=actor,
        actor_label=actor_label,
    )


@transaction.atomic
def create_deployment(
    *,
    environment: Environment,
    version: str,
    status: str = DeploymentStatus.PENDING,
    source: str = DeploymentSource.MANUAL,
    actor=None,
    actor_label: str = "",
    commit_sha: str = "",
    branch: str = "",
    ci_run_id: str = "",
    ci_run_url: str = "",
    message: str = "",
    request=None,
) -> Deployment:
    environment = (
        Environment.objects.select_for_update().select_related("project").get(pk=environment.pk)
    )
    if environment.project.is_archived:
        raise DomainError("El proyecto está archivado.", code="archived", field="environment")
    if environment.status == EnvironmentStatus.INACTIVE:
        raise DomainError(
            "El entorno está inactivo; actívalo antes de desplegar.",
            code="inactive_environment",
            field="environment",
        )
    if actor is not None and getattr(actor, "is_authenticated", False):
        actor_label = actor_label or actor.email
    else:
        actor = None
    try:
        with transaction.atomic():
            deployment = Deployment.objects.create(
                environment=environment,
                version=version,
                commit_sha=commit_sha,
                branch=branch,
                source=source,
                triggered_by=actor,
                triggered_by_label=actor_label[:150],
                ci_run_id=ci_run_id,
                ci_run_url=ci_run_url,
                status=DeploymentStatus.PENDING,
            )
    except IntegrityError as exc:
        raise DomainError(
            "Ya existe un despliegue para esta ejecución de CI en el entorno.",
            code="duplicate",
            field="ci_run_id",
        ) from exc

    # Walk the state machine so every intermediate event is recorded consistently.
    path = {
        DeploymentStatus.PENDING: [],
        DeploymentStatus.RUNNING: [DeploymentStatus.RUNNING],
        DeploymentStatus.SUCCESS: [DeploymentStatus.RUNNING, DeploymentStatus.SUCCESS],
        DeploymentStatus.FAILED: [DeploymentStatus.RUNNING, DeploymentStatus.FAILED],
    }.get(status)
    if path is None:
        raise DomainError("Estado inicial no válido.", code="invalid_status", field="status")
    for step in path:
        _apply_status(
            deployment,
            step,
            message=message if step == path[-1] else "",
            actor=actor,
            actor_label=actor_label,
        )
    if actor is not None:
        audit.record(
            AuditAction.DEPLOYMENT_CREATED,
            actor=actor,
            target=deployment,
            changes={"environment": _env_label(environment), "version": version, "status": status},
            request=request,
        )
    return deployment


@transaction.atomic
def transition_deployment(
    deployment: Deployment,
    *,
    status: str,
    message: str = "",
    actor=None,
    actor_label="",
    request=None,
) -> Deployment:
    deployment = (
        Deployment.objects.select_for_update()
        .select_related("environment__project")
        .get(pk=deployment.pk)
    )
    if actor is not None and getattr(actor, "is_authenticated", False):
        actor_label = actor_label or actor.email
    else:
        actor = None
    previous = deployment.status
    _apply_status(deployment, status, message=message, actor=actor, actor_label=actor_label)
    if actor is not None and previous != status:
        audit.record(
            AuditAction.DEPLOYMENT_STATUS_CHANGED,
            actor=actor,
            target=deployment,
            changes={"status": {"from": previous, "to": status}},
            request=request,
        )
    return deployment


# --- service tokens -------------------------------------------------------------------


@transaction.atomic
def create_service_token(*, name: str, projects, expires_at=None, actor, request=None):
    if expires_at is not None and expires_at <= timezone.now():
        raise DomainError(
            "La fecha de expiración debe ser futura.", code="invalid_date", field="expires_at"
        )
    if not projects:
        raise DomainError("Selecciona al menos un proyecto.", code="required", field="projects")
    raw, prefix, digest = ServiceToken.generate()
    token = ServiceToken.objects.create(
        name=name, key_prefix=prefix, token_hash=digest, created_by=actor, expires_at=expires_at
    )
    token.projects.set(projects)
    audit.record(
        AuditAction.SERVICE_TOKEN_CREATED,
        actor=actor,
        target=token,
        changes={"name": name, "projects": [p.slug for p in projects], "expires_at": expires_at},
        request=request,
    )
    return token, raw


@transaction.atomic
def revoke_service_token(token: ServiceToken, *, actor, request=None) -> ServiceToken:
    if token.revoked_at:
        return token
    token.revoked_at = timezone.now()
    token.save(update_fields=["revoked_at", "updated_at"])
    audit.record(AuditAction.SERVICE_TOKEN_REVOKED, actor=actor, target=token, request=request)
    return token


def authenticate_service_token(raw: str) -> ServiceToken | None:
    if not raw or not raw.startswith(f"{TOKEN_PREFIX}_"):
        return None
    token = ServiceToken.objects.usable().filter(token_hash=hash_token(raw)).first()
    if token is None:
        return None
    ServiceToken.objects.filter(pk=token.pk).update(last_used_at=timezone.now())
    return token
