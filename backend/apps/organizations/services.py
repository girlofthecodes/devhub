"""Business logic for organizations and memberships."""

from django.db import transaction
from django.utils.text import slugify

from apps.audit import services as audit
from apps.audit.models import AuditAction
from apps.users.models import User
from apps.users.roles import Role
from common.exceptions import DomainError

from .models import Membership, MembershipRole, Organization

EDITABLE_FIELDS = ("name", "description", "contact_email")


def _unique_slug(base: str, *, exclude_pk=None) -> str:
    root = slugify(base)[:150] or "organizacion"
    slug, n = root, 2
    qs = Organization.objects.all()
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    while qs.filter(slug=slug).exists():
        slug = f"{root}-{n}"
        n += 1
    return slug


def _ensure_unique_name(name: str, *, exclude_pk=None) -> None:
    qs = Organization.objects.filter(name__iexact=name.strip())
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    if qs.exists():
        raise DomainError(
            "Ya existe una organización con este nombre.", code="duplicate", field="name"
        )


@transaction.atomic
def create_organization(*, actor: User, request=None, slug: str = "", **data) -> Organization:
    data["name"] = data["name"].strip()
    _ensure_unique_name(data["name"])
    if slug:
        if Organization.objects.filter(slug=slug).exists():
            raise DomainError("El identificador ya está en uso.", code="duplicate", field="slug")
    else:
        slug = _unique_slug(data["name"])
    org = Organization.objects.create(slug=slug, **data)
    audit.record(
        AuditAction.ORGANIZATION_CREATED,
        actor=actor,
        target=org,
        changes={"slug": slug, **data},
        request=request,
    )
    return org


@transaction.atomic
def update_organization(org: Organization, *, actor: User, request=None, **data) -> Organization:
    data = {k: v for k, v in data.items() if k in EDITABLE_FIELDS}
    if "name" in data:
        data["name"] = data["name"].strip()
        _ensure_unique_name(data["name"], exclude_pk=org.pk)
    changes = audit.diff(org, data)
    if not changes:
        return org
    for field, value in data.items():
        setattr(org, field, value)
    org.save(update_fields=[*changes.keys(), "updated_at"])
    audit.record(
        AuditAction.ORGANIZATION_UPDATED, actor=actor, target=org, changes=changes, request=request
    )
    return org


@transaction.atomic
def set_organization_active(
    org: Organization, *, active: bool, actor: User, request=None
) -> Organization:
    if org.is_active == active:
        return org
    org.is_active = active
    org.save(update_fields=["is_active", "updated_at"])
    audit.record(
        AuditAction.ORGANIZATION_ACTIVATED if active else AuditAction.ORGANIZATION_DEACTIVATED,
        actor=actor,
        target=org,
        request=request,
    )
    return org


@transaction.atomic
def add_member(
    *,
    organization: Organization,
    user: User,
    role: str = MembershipRole.MEMBER,
    actor: User,
    request=None,
) -> Membership:
    if not user.is_active:
        raise DomainError(
            "No se puede agregar un usuario inactivo.", code="inactive_user", field="user"
        )
    if user.role == Role.VISITOR:
        raise DomainError(
            "Los visitantes no pueden pertenecer a organizaciones.",
            code="invalid_role",
            field="user",
        )
    if Membership.objects.filter(organization=organization, user=user).exists():
        raise DomainError(
            "El usuario ya pertenece a esta organización.", code="duplicate", field="user"
        )
    membership = Membership.objects.create(organization=organization, user=user, role=role)
    audit.record(
        AuditAction.MEMBERSHIP_ADDED,
        actor=actor,
        target=organization,
        changes={"user": user.email, "role": role},
        request=request,
    )
    return membership


@transaction.atomic
def update_member_role(membership: Membership, *, role: str, actor: User, request=None):
    if membership.role == role:
        return membership
    old = membership.role
    membership.role = role
    membership.save(update_fields=["role", "updated_at"])
    audit.record(
        AuditAction.MEMBERSHIP_UPDATED,
        actor=actor,
        target=membership.organization,
        changes={"user": membership.user.email, "role": {"from": old, "to": role}},
        request=request,
    )
    return membership


@transaction.atomic
def remove_member(membership: Membership, *, actor: User, request=None) -> None:
    organization, email = membership.organization, membership.user.email
    membership.delete()
    audit.record(
        AuditAction.MEMBERSHIP_REMOVED,
        actor=actor,
        target=organization,
        changes={"user": email},
        request=request,
    )
