"""Business logic for the server inventory and project environments."""

from django.db import transaction

from apps.audit import services as audit
from apps.audit.models import AuditAction
from apps.projects.models import Project
from apps.traceability import services as trace
from apps.traceability.models import EventType
from apps.users.models import User
from common.exceptions import DomainError

from .models import Environment, EnvironmentKind, EnvironmentStatus, Server, ServerStatus

SERVER_FIELDS = (
    "name",
    "identifier",
    "location",
    "server_type",
    "operating_system",
    "vpn_address",
    "status",
    "notes",
)
ENVIRONMENT_FIELDS = ("server", "name", "public_url", "deployed_version", "status")


def _serializable(value):
    if isinstance(value, Server):
        return value.identifier
    return value


def _changes(instance, data: dict) -> dict:
    return {
        field: {"from": _serializable(getattr(instance, field)), "to": _serializable(value)}
        for field, value in data.items()
        if getattr(instance, field) != value
    }


# --- servers --------------------------------------------------------------------------


def _ensure_unique_identifier(identifier: str, *, exclude_pk=None) -> None:
    qs = Server.objects.filter(identifier=identifier)
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    if qs.exists():
        raise DomainError(
            "Ya existe un servidor con este identificador.", code="duplicate", field="identifier"
        )


@transaction.atomic
def create_server(*, actor: User, request=None, **data) -> Server:
    _ensure_unique_identifier(data["identifier"])
    server = Server.objects.create(**data)
    audit.record(
        AuditAction.SERVER_CREATED,
        actor=actor,
        target=server,
        changes={k: v for k, v in data.items() if k != "notes"},
        request=request,
    )
    return server


@transaction.atomic
def update_server(server: Server, *, actor: User, data: dict, request=None) -> Server:
    data = {k: v for k, v in data.items() if k in SERVER_FIELDS}
    if "identifier" in data:
        _ensure_unique_identifier(data["identifier"], exclude_pk=server.pk)
    if data.get("status") == ServerStatus.INACTIVE and server.status != ServerStatus.INACTIVE:
        active = server.environments.filter(status=EnvironmentStatus.ACTIVE).count()
        if active:
            raise DomainError(
                f"El servidor aloja {active} entorno(s) activo(s). Reasígnalos o desactívalos "
                "antes de retirarlo.",
                code="server_in_use",
                field="status",
            )
    changes = _changes(server, data)
    if not changes:
        return server
    for field, value in data.items():
        setattr(server, field, value)
    server.save()
    audit.record(
        AuditAction.SERVER_UPDATED, actor=actor, target=server, changes=changes, request=request
    )
    return server


# --- environments ---------------------------------------------------------------------


def _ensure_project_editable(project: Project) -> None:
    if project.is_archived:
        raise DomainError(
            "El proyecto está archivado; sus entornos son de solo lectura.", code="archived"
        )


def _ensure_server_assignable(server: Server | None, current: Server | None = None) -> None:
    if server is not None and server != current and server.status == ServerStatus.INACTIVE:
        raise DomainError(
            "No se pueden asignar entornos a un servidor inactivo.",
            code="inactive_server",
            field="server",
        )


def _sync_project_site_url(
    environment: Environment, *, old_url: str, actor: User, request=None
) -> None:
    """Keep Project.site_url aligned with the production URL unless it was customized."""
    if environment.kind != EnvironmentKind.PRODUCTION:
        return
    project = environment.project
    new_url = environment.public_url
    if new_url == old_url or project.site_url not in ("", old_url):
        return
    previous = project.site_url
    project.site_url = new_url
    project.save(update_fields=["site_url", "updated_at"])
    trace.emit(
        EventType.PROJECT_UPDATED,
        description="URL del sitio sincronizada con Production",
        project=project,
        environment=environment,
        source=trace.source_for(actor),
        actor=actor,
        metadata={"site_url": {"from": previous, "to": new_url}},
    )
    audit.record(
        AuditAction.PROJECT_UPDATED,
        actor=actor,
        target=project,
        changes={"site_url": {"from": previous, "to": new_url}},
        metadata={"source": "production_environment"},
        request=request,
    )


@transaction.atomic
def create_environment(
    *, project: Project, kind: str, actor: User, request=None, **data
) -> Environment:
    _ensure_project_editable(project)
    _ensure_server_assignable(data.get("server"))
    if Environment.objects.filter(project=project, kind=kind).exists():
        raise DomainError(
            f"El proyecto ya tiene un entorno {EnvironmentKind(kind).label}.",
            code="duplicate",
            field="kind",
        )
    environment = Environment.objects.create(project=project, kind=kind, **data)
    trace.emit(
        EventType.CONFIGURATION_CHANGED,
        description=f"Entorno {environment.get_kind_display()} creado",
        environment=environment,
        source=trace.source_for(actor),
        actor=actor,
        metadata={k: _serializable(v) for k, v in data.items()},
    )
    audit.record(
        AuditAction.ENVIRONMENT_CREATED,
        actor=actor,
        target=environment,
        changes={
            "project": project.name,
            "kind": kind,
            **{k: _serializable(v) for k, v in data.items()},
        },
        request=request,
    )
    _sync_project_site_url(environment, old_url="", actor=actor, request=request)
    return environment


@transaction.atomic
def update_environment(
    environment: Environment, *, actor: User, data: dict, request=None
) -> Environment:
    _ensure_project_editable(environment.project)
    data = {k: v for k, v in data.items() if k in ENVIRONMENT_FIELDS}
    if "server" in data:
        _ensure_server_assignable(data["server"], current=environment.server)
    changes = _changes(environment, data)
    if not changes:
        return environment
    old_url = environment.public_url
    for field, value in data.items():
        setattr(environment, field, value)
    environment.save()
    trace.emit(
        EventType.CONFIGURATION_CHANGED,
        description=f"Entorno {environment.get_kind_display()} actualizado: "
        + ", ".join(sorted(changes)),
        environment=environment,
        source=trace.source_for(actor),
        actor=actor,
        metadata={"changes": changes},
    )
    audit.record(
        AuditAction.ENVIRONMENT_UPDATED,
        actor=actor,
        target=environment,
        changes=changes,
        request=request,
    )
    _sync_project_site_url(environment, old_url=old_url, actor=actor, request=request)
    return environment
