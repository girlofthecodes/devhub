"""Business logic for users, roles, sessions and passwords."""

import logging

from django.conf import settings
from django.contrib.auth import password_validation, update_session_auth_hash
from django.contrib.auth.models import Group, Permission
from django.contrib.auth.tokens import default_token_generator
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from apps.audit import services as audit
from apps.audit.models import AuditAction
from common.exceptions import DomainError
from common.permissions import (
    FINANCE_MANAGE_CODENAME,
    FINANCE_VIEW_CODENAME,
    FinanceAccess,
    finance_access_level,
)

from .models import User, UserSession
from .roles import ROLE_NAMES, Role

logger = logging.getLogger(__name__)

PROFILE_FIELDS = ("first_name", "last_name")


def _validate_password(password: str, user: User, field: str) -> None:
    try:
        password_validation.validate_password(password, user)
    except DjangoValidationError as exc:
        raise DjangoValidationError({field: exc.messages}) from exc


def _active_admins_excluding(user: User):
    return User.objects.filter(is_active=True, groups__name=Role.ADMIN).exclude(pk=user.pk)


def _ensure_not_last_admin(user: User) -> None:
    if user.role == Role.ADMIN and not _active_admins_excluding(user).exists():
        raise DomainError("Debe existir al menos un administrador activo.", code="last_admin")


def _apply_role(user: User, role: str) -> None:
    if role not in ROLE_NAMES:
        raise DomainError("Rol no válido.", code="invalid_role", field="role")
    role_groups = Group.objects.filter(name__in=ROLE_NAMES)
    user.groups.remove(*role_groups)
    user.groups.add(Group.objects.get_or_create(name=role)[0])
    # Django admin site access follows the ADMIN role.
    user.is_staff = role == Role.ADMIN
    if role != Role.ADMIN:
        user.is_superuser = False
    user.save(update_fields=["is_staff", "is_superuser"])
    user.clear_role_cache()


def _apply_client_access(user: User, enabled: bool) -> None:
    """Additional client-portal access for internal users (the CLIENT group next to the role)."""
    if user.role == Role.CLIENT:
        return  # inherent to the role
    if enabled and user.role not in {Role.ADMIN, Role.DEVELOPER}:
        raise DomainError(
            "Solo administradores y desarrolladores pueden tener acceso adicional de cliente.",
            code="invalid_client_access",
            field="client_portal_access",
        )
    group = Group.objects.get_or_create(name=Role.CLIENT)[0]
    if enabled:
        user.groups.add(group)
    else:
        user.groups.remove(group)
    user.clear_role_cache()


def _apply_finance_access(user: User, level: str) -> None:
    """Explicit finance permissions. Only developers get them per user; admins always have them."""
    if level not in FinanceAccess.values:
        raise DomainError("Nivel de acceso financiero no válido.", code="invalid_finance_access")
    if level != FinanceAccess.NONE and user.role != Role.DEVELOPER:
        if user.role == Role.ADMIN:
            return  # implicit for administrators
        raise DomainError(
            "Solo los desarrolladores pueden recibir permisos financieros explícitos.",
            code="invalid_finance_access",
            field="finance_access",
        )
    perms = {
        p.codename: p
        for p in Permission.objects.filter(
            content_type__app_label="commercial",
            codename__in=[FINANCE_VIEW_CODENAME, FINANCE_MANAGE_CODENAME],
        )
    }
    user.user_permissions.remove(*perms.values())
    wanted = {
        FinanceAccess.VIEW: [FINANCE_VIEW_CODENAME],
        FinanceAccess.MANAGE: [FINANCE_VIEW_CODENAME, FINANCE_MANAGE_CODENAME],
    }.get(level, [])
    user.user_permissions.add(*(perms[c] for c in wanted if c in perms))
    # Drop Django's per-instance permission caches.
    for attr in ("_perm_cache", "_user_perm_cache", "_group_perm_cache"):
        user.__dict__.pop(attr, None)


@transaction.atomic
def create_user(
    *,
    email: str,
    role: str,
    password: str | None = None,
    first_name: str = "",
    last_name: str = "",
    client_portal_access: bool = False,
    finance_access: str = FinanceAccess.NONE,
    actor: User | None = None,
    request=None,
) -> User:
    email = email.strip().lower()
    if User.objects.filter(email=email).exists():
        raise DomainError("Ya existe un usuario con este correo.", code="duplicate", field="email")
    if password:
        candidate = User(email=email, first_name=first_name, last_name=last_name)
        _validate_password(password, candidate, "password")
    user = User.objects.create_user(
        email=email, password=password, first_name=first_name, last_name=last_name
    )
    _apply_role(user, role)
    _apply_client_access(user, client_portal_access)
    _apply_finance_access(user, finance_access)
    audit.record(
        AuditAction.USER_CREATED,
        actor=actor,
        target=user,
        changes={
            "email": email,
            "role": role,
            "first_name": first_name,
            "last_name": last_name,
            "client_portal_access": client_access_enabled(user),
            "finance_access": finance_access_level(user),
        },
        request=request,
    )
    return user


@transaction.atomic
def update_user(user: User, *, data: dict, actor: User | None = None, request=None) -> User:
    profile_data = {k: v for k, v in data.items() if k in PROFILE_FIELDS}
    changes = audit.diff(user, profile_data)
    for field, value in profile_data.items():
        setattr(user, field, value)
    if changes:
        user.save(update_fields=[*changes.keys()])
        audit.record(
            AuditAction.USER_UPDATED, actor=actor, target=user, changes=changes, request=request
        )

    new_role = data.get("role")
    if new_role and new_role != user.role:
        if actor is not None and actor.pk == user.pk:
            raise DomainError("No puedes cambiar tu propio rol.", code="self_role_change")
        if user.role == Role.ADMIN:
            _ensure_not_last_admin(user)
        old_role = user.role
        old_client_access = client_access_enabled(user)
        _apply_role(user, new_role)
        # Additional client access survives a change between internal roles.
        if new_role in {Role.ADMIN, Role.DEVELOPER} and "client_portal_access" not in data:
            _apply_client_access(user, old_client_access)
        if new_role != Role.DEVELOPER:
            _apply_finance_access(user, FinanceAccess.NONE)
        audit.record(
            AuditAction.USER_ROLE_CHANGED,
            actor=actor,
            target=user,
            changes={"role": {"from": old_role, "to": new_role}},
            request=request,
        )

    access_changes = {}
    if "client_portal_access" in data:
        before = client_access_enabled(user)
        _apply_client_access(user, data["client_portal_access"])
        if client_access_enabled(user) != before:
            access_changes["client_portal_access"] = {
                "from": before,
                "to": client_access_enabled(user),
            }
    if "finance_access" in data:
        before = finance_access_level(user)
        _apply_finance_access(user, data["finance_access"])
        after = finance_access_level(user)
        if after != before:
            access_changes["finance_access"] = {"from": before, "to": after}
    if access_changes:
        audit.record(
            AuditAction.USER_UPDATED,
            actor=actor,
            target=user,
            changes=access_changes,
            request=request,
        )
    return user


def client_access_enabled(user: User) -> bool:
    return user.groups.filter(name=Role.CLIENT).exists()


def revoke_user_sessions(user: User, *, keep_session_key: str | None = None) -> int:
    tracked = UserSession.objects.filter(user=user)
    if keep_session_key:
        tracked = tracked.exclude(session_key=keep_session_key)
    keys = list(tracked.values_list("session_key", flat=True))
    Session.objects.filter(session_key__in=keys).delete()
    tracked.delete()
    return len(keys)


@transaction.atomic
def deactivate_user(user: User, *, actor: User, request=None) -> User:
    if actor.pk == user.pk:
        raise DomainError("No puedes desactivar tu propia cuenta.", code="self_deactivation")
    if not user.is_active:
        return user
    _ensure_not_last_admin(user)
    user.is_active = False
    user.save(update_fields=["is_active"])
    revoked = revoke_user_sessions(user)
    audit.record(
        AuditAction.USER_DEACTIVATED,
        actor=actor,
        target=user,
        metadata={"sessions_revoked": revoked},
        request=request,
    )
    return user


@transaction.atomic
def activate_user(user: User, *, actor: User, request=None) -> User:
    if user.is_active:
        return user
    user.is_active = True
    user.save(update_fields=["is_active"])
    audit.record(AuditAction.USER_ACTIVATED, actor=actor, target=user, request=request)
    return user


def admin_revoke_sessions(user: User, *, actor: User, request=None) -> int:
    revoked = revoke_user_sessions(user)
    audit.record(
        AuditAction.USER_SESSIONS_REVOKED,
        actor=actor,
        target=user,
        metadata={"sessions_revoked": revoked},
        request=request,
    )
    return revoked


@transaction.atomic
def change_password(user: User, *, current_password: str, new_password: str, request) -> None:
    if not user.check_password(current_password):
        raise DomainError(
            "La contraseña actual no es correcta.",
            code="invalid_password",
            field="current_password",
        )
    _validate_password(new_password, user, "new_password")
    user.set_password(new_password)
    user.save(update_fields=["password"])
    # Keep the current session alive; every other session is invalidated.
    update_session_auth_hash(request, user)
    revoke_user_sessions(user, keep_session_key=request.session.session_key)
    audit.record(AuditAction.PASSWORD_CHANGED, actor=user, target=user, request=request)


def request_password_reset(email: str, *, request) -> None:
    """Send a reset link if an active account exists. Never reveals whether it exists."""
    email = email.strip().lower()
    user = User.objects.filter(email=email, is_active=True).first()
    audit.record(
        AuditAction.PASSWORD_RESET_REQUESTED,
        target=user,
        metadata={"email": email, "account_found": user is not None},
        request=request,
    )
    if user is None:
        return
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
    try:
        send_mail(
            subject="DevHub — Restablecer contraseña",
            message=(
                f"Hola {user.full_name},\n\n"
                "Recibimos una solicitud para restablecer tu contraseña de DevHub.\n"
                f"Abre el siguiente enlace (válido por {settings.PASSWORD_RESET_TIMEOUT // 60} "
                f"minutos):\n\n{link}\n\n"
                "Si no solicitaste este cambio, ignora este mensaje."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )
    except Exception:  # pragma: no cover - depends on SMTP availability
        logger.exception("Could not send password reset e-mail")


@transaction.atomic
def confirm_password_reset(*, uid: str, token: str, new_password: str, request=None) -> User:
    invalid = DomainError("El enlace no es válido o ha expirado.", code="invalid_token")
    try:
        user_pk = force_str(urlsafe_base64_decode(uid))
        user = User.objects.get(pk=user_pk, is_active=True)
    except (ValueError, TypeError, OverflowError, User.DoesNotExist) as exc:
        raise invalid from exc
    if not default_token_generator.check_token(user, token):
        raise invalid
    _validate_password(new_password, user, "new_password")
    user.set_password(new_password)
    user.save(update_fields=["password"])
    revoke_user_sessions(user)
    audit.record(AuditAction.PASSWORD_RESET_COMPLETED, actor=None, target=user, request=request)
    return user
