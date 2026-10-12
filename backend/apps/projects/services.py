"""Business logic for projects, project members and organization access."""

from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify
from PIL import Image, UnidentifiedImageError

from apps.audit import services as audit
from apps.audit.models import AuditAction
from apps.organizations.models import Organization
from apps.traceability import services as trace
from apps.traceability.models import EventType, Severity
from apps.users.models import User
from apps.users.roles import Role
from common.exceptions import DomainError

from .models import (
    Project,
    ProjectAccess,
    ProjectMember,
    ProjectMemberRole,
    ProjectStatus,
    ProjectVisibility,
)

STAFF_ROLES = {Role.ADMIN, Role.DEVELOPER}
# Fields a maintainer (non-admin) may change.
TECHNICAL_FIELDS = (
    "description",
    "repository_url",
    "documentation_url",
    "site_url",
    "technologies",
    "status",
)
ADMIN_FIELDS = (*TECHNICAL_FIELDS, "name", "owner")

LOGO_MAX_BYTES = 1024 * 1024
LOGO_MAX_SIDE = 2048
LOGO_FORMATS = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}


# --- helpers ---------------------------------------------------------------------------


def _unique_slug(base: str, *, exclude_pk=None) -> str:
    root = slugify(base)[:120] or "proyecto"
    slug, n = root, 2
    qs = Project.objects.all()
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    while qs.filter(slug=slug).exists():
        slug = f"{root}-{n}"
        n += 1
    return slug


def _ensure_unique_name(name: str, *, exclude_pk=None) -> None:
    qs = Project.objects.filter(name__iexact=name)
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    if qs.exists():
        raise DomainError("Ya existe un proyecto con este nombre.", code="duplicate", field="name")


def _ensure_staff_user(user: User, field: str) -> None:
    if not user.is_active:
        raise DomainError("El usuario está inactivo.", code="inactive_user", field=field)
    if user.role not in STAFF_ROLES:
        raise DomainError(
            "Debe ser un administrador o desarrollador.", code="invalid_role", field=field
        )


def _ensure_not_archived(project: Project) -> None:
    if project.is_archived:
        raise DomainError(
            "El proyecto está archivado. Restáuralo para modificarlo.", code="archived"
        )


def _ensure_status_allowed(status: str) -> None:
    if status == ProjectStatus.ARCHIVED:
        raise DomainError(
            "Usa la acción «Archivar» para archivar un proyecto.",
            code="invalid_status",
            field="status",
        )


def _audit_value(value):
    return value.email if isinstance(value, User) else value


def _trace(event_type, project, description, *, actor, metadata=None, severity=Severity.INFO):
    trace.emit(
        event_type,
        description=description,
        project=project,
        severity=severity,
        source=trace.source_for(actor),
        actor=actor,
        metadata=metadata,
    )


# --- projects -----------------------------------------------------------------------------


@transaction.atomic
def create_project(*, actor: User, request=None, **data) -> Project:
    data["name"] = data["name"].strip()
    _ensure_unique_name(data["name"])
    _ensure_staff_user(data["owner"], "owner")
    _ensure_status_allowed(data.get("status", ProjectStatus.PLANNING))
    project = Project.objects.create(slug=_unique_slug(data["name"]), **data)
    _trace(
        EventType.PROJECT_CREATED,
        project,
        f"Proyecto «{project.name}» creado",
        actor=actor,
        metadata={"status": project.status, "owner": project.owner.email},
    )
    audit.record(
        AuditAction.PROJECT_CREATED,
        actor=actor,
        target=project,
        changes={k: _audit_value(v) for k, v in data.items()},
        request=request,
    )
    return project


@transaction.atomic
def update_project(
    project: Project, *, actor: User, data: dict, is_admin: bool, request=None
) -> Project:
    _ensure_not_archived(project)
    allowed = ADMIN_FIELDS if is_admin else TECHNICAL_FIELDS
    # Unchanged values are ignored so clients can send the full form.
    data = {k: v for k, v in data.items() if getattr(project, k) != v}
    forbidden = set(data) - set(allowed)
    if forbidden:
        raise DomainError(
            "No tienes permiso para modificar: " + ", ".join(sorted(forbidden)) + ".",
            code="permission_denied",
        )
    if "name" in data:
        data["name"] = data["name"].strip()
        _ensure_unique_name(data["name"], exclude_pk=project.pk)
    if "owner" in data:
        _ensure_staff_user(data["owner"], "owner")
    if "status" in data:
        _ensure_status_allowed(data["status"])

    changes = {
        field: {"from": _audit_value(getattr(project, field)), "to": _audit_value(value)}
        for field, value in data.items()
        if getattr(project, field) != value
    }
    if not changes:
        return project
    for field, value in data.items():
        setattr(project, field, value)
    project.save()
    _trace(
        EventType.PROJECT_UPDATED,
        project,
        "Proyecto actualizado: " + ", ".join(sorted(changes)),
        actor=actor,
        metadata={"changes": changes},
    )
    audit.record(
        AuditAction.PROJECT_UPDATED, actor=actor, target=project, changes=changes, request=request
    )
    return project


@transaction.atomic
def archive_project(project: Project, *, actor: User, request=None) -> Project:
    if project.is_archived:
        return project
    project.status_before_archive = project.status
    project.status = ProjectStatus.ARCHIVED
    project.archived_at = timezone.now()
    project.save(update_fields=["status", "status_before_archive", "archived_at", "updated_at"])
    _trace(
        EventType.PROJECT_UPDATED,
        project,
        "Proyecto archivado",
        actor=actor,
        metadata={"action": "archived"},
    )
    audit.record(AuditAction.PROJECT_ARCHIVED, actor=actor, target=project, request=request)
    return project


@transaction.atomic
def restore_project(project: Project, *, actor: User, request=None) -> Project:
    if not project.is_archived:
        return project
    project.status = project.status_before_archive or ProjectStatus.MAINTENANCE
    project.status_before_archive = ""
    project.archived_at = None
    project.save(update_fields=["status", "status_before_archive", "archived_at", "updated_at"])
    _trace(
        EventType.PROJECT_UPDATED,
        project,
        "Proyecto restaurado",
        actor=actor,
        metadata={"action": "restored", "status": project.status},
    )
    audit.record(
        AuditAction.PROJECT_RESTORED,
        actor=actor,
        target=project,
        changes={"status": project.status},
        request=request,
    )
    return project


@transaction.atomic
def set_visibility(project: Project, *, visibility: str, actor: User, request=None) -> Project:
    if visibility == ProjectVisibility.PUBLIC:
        _ensure_not_archived(project)
    if project.visibility == visibility:
        return project
    project.visibility = visibility
    project.save(update_fields=["visibility", "updated_at"])
    _trace(
        EventType.PROJECT_UPDATED,
        project,
        "Publicado en el portafolio"
        if visibility == ProjectVisibility.PUBLIC
        else "Oculto del portafolio",
        actor=actor,
        metadata={"visibility": visibility},
    )
    audit.record(
        AuditAction.PROJECT_PUBLISHED
        if visibility == ProjectVisibility.PUBLIC
        else AuditAction.PROJECT_UNPUBLISHED,
        actor=actor,
        target=project,
        request=request,
    )
    return project


def _validate_logo(file: UploadedFile) -> str:
    if file.size > LOGO_MAX_BYTES:
        raise DomainError("La imagen supera 1 MB.", code="file_too_large", field="logo")
    try:
        with Image.open(file) as image:
            image_format = image.format
            width, height = image.size
            image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise DomainError(
            "El archivo no es una imagen válida.", code="invalid_image", field="logo"
        ) from exc
    finally:
        file.seek(0)
    if image_format not in LOGO_FORMATS:
        raise DomainError(
            "Formato no permitido. Usa PNG, JPG o WEBP.", code="invalid_image", field="logo"
        )
    if max(width, height) > LOGO_MAX_SIDE:
        raise DomainError(
            f"La imagen no puede superar {LOGO_MAX_SIDE}px por lado.",
            code="invalid_image",
            field="logo",
        )
    return LOGO_FORMATS[image_format]


@transaction.atomic
def set_logo(project: Project, *, file: UploadedFile | None, actor: User, request=None) -> Project:
    _ensure_not_archived(project)
    old = project.logo.name if project.logo else ""
    if file is None:
        if not old:
            return project
        project.logo = ""
    else:
        ext = _validate_logo(file)
        project.logo.save(f"logo.{ext}", file, save=False)
    project.save(update_fields=["logo", "updated_at"])
    if old:
        transaction.on_commit(lambda: project.logo.storage.delete(old))
    audit.record(
        AuditAction.PROJECT_LOGO_UPDATED,
        actor=actor,
        target=project,
        metadata={"removed": file is None},
        request=request,
    )
    return project


# --- members --------------------------------------------------------------------------


@transaction.atomic
def add_member(
    *,
    project: Project,
    user: User,
    role: str = ProjectMemberRole.CONTRIBUTOR,
    actor: User,
    request=None,
) -> ProjectMember:
    _ensure_not_archived(project)
    _ensure_staff_user(user, "user")
    if ProjectMember.objects.filter(project=project, user=user).exists():
        raise DomainError(
            "El usuario ya está asignado al proyecto.", code="duplicate", field="user"
        )
    member = ProjectMember.objects.create(project=project, user=user, role=role)
    _trace(
        EventType.CONFIGURATION_CHANGED,
        project,
        f"Desarrollador asignado: {user.email}",
        actor=actor,
        metadata={"member": user.email, "role": role},
    )
    audit.record(
        AuditAction.PROJECT_MEMBER_ADDED,
        actor=actor,
        target=project,
        changes={"user": user.email, "role": role},
        request=request,
    )
    return member


@transaction.atomic
def update_member_role(member: ProjectMember, *, role: str, actor: User, request=None):
    _ensure_not_archived(member.project)
    if member.role == role:
        return member
    old = member.role
    member.role = role
    member.save(update_fields=["role", "updated_at"])
    audit.record(
        AuditAction.PROJECT_MEMBER_UPDATED,
        actor=actor,
        target=member.project,
        changes={"user": member.user.email, "role": {"from": old, "to": role}},
        request=request,
    )
    return member


@transaction.atomic
def remove_member(member: ProjectMember, *, actor: User, request=None) -> None:
    project, email = member.project, member.user.email
    _ensure_not_archived(project)
    member.delete()
    _trace(
        EventType.CONFIGURATION_CHANGED,
        project,
        f"Desarrollador removido: {email}",
        actor=actor,
        metadata={"member": email},
    )
    audit.record(
        AuditAction.PROJECT_MEMBER_REMOVED,
        actor=actor,
        target=project,
        changes={"user": email},
        request=request,
    )


# --- organization access ----------------------------------------------------------------


def _validate_expiration(expires_at) -> None:
    if expires_at is not None and expires_at <= timezone.now():
        raise DomainError(
            "La fecha de expiración debe ser futura.", code="invalid_date", field="expires_at"
        )


@transaction.atomic
def grant_access(
    *,
    project: Project,
    organization: Organization,
    actor: User,
    expires_at=None,
    notes: str = "",
    request=None,
) -> ProjectAccess:
    _ensure_not_archived(project)
    if not organization.is_active:
        raise DomainError(
            "La organización está inactiva.", code="inactive_organization", field="organization"
        )
    _validate_expiration(expires_at)

    open_grant = (
        ProjectAccess.objects.select_for_update()
        .filter(project=project, organization=organization, revoked_at__isnull=True)
        .first()
    )
    if open_grant is not None:
        if open_grant.state == "ACTIVE":
            raise DomainError(
                "La organización ya tiene acceso a este proyecto.",
                code="duplicate",
                field="organization",
            )
        # Close the expired grant so the new one becomes the single open grant.
        open_grant.revoked_at = timezone.now()
        open_grant.save(update_fields=["revoked_at", "updated_at"])

    grant = ProjectAccess.objects.create(
        project=project,
        organization=organization,
        granted_by=actor,
        expires_at=expires_at,
        notes=notes,
    )
    _trace(
        EventType.ACCESS_GRANTED,
        project,
        f"Acceso concedido a {organization.name}",
        actor=actor,
        metadata={"organization": organization.name, "expires_at": expires_at},
    )
    audit.record(
        AuditAction.ACCESS_GRANTED,
        actor=actor,
        target=project,
        changes={"organization": organization.name, "expires_at": expires_at, "notes": notes},
        request=request,
    )
    return grant


@transaction.atomic
def update_access(grant: ProjectAccess, *, actor: User, request=None, **data) -> ProjectAccess:
    if grant.revoked_at:
        raise DomainError("El acceso ya fue revocado.", code="revoked")
    if "expires_at" in data:
        _validate_expiration(data["expires_at"])
    changes = audit.diff(grant, data)
    if not changes:
        return grant
    for field, value in data.items():
        setattr(grant, field, value)
    grant.save(update_fields=[*changes.keys(), "updated_at"])
    audit.record(
        AuditAction.ACCESS_UPDATED,
        actor=actor,
        target=grant.project,
        changes={"organization": grant.organization.name, **changes},
        request=request,
    )
    return grant


@transaction.atomic
def revoke_access(grant: ProjectAccess, *, actor: User, request=None) -> ProjectAccess:
    if grant.revoked_at:
        return grant
    grant.revoked_at = timezone.now()
    grant.revoked_by = actor
    grant.save(update_fields=["revoked_at", "revoked_by", "updated_at"])
    _trace(
        EventType.ACCESS_REVOKED,
        grant.project,
        f"Acceso revocado a {grant.organization.name}",
        actor=actor,
        severity=Severity.WARNING,
        metadata={"organization": grant.organization.name},
    )
    audit.record(
        AuditAction.ACCESS_REVOKED,
        actor=actor,
        target=grant.project,
        changes={"organization": grant.organization.name},
        request=request,
    )
    return grant
