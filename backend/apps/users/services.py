"""Business logic for users, roles, sessions and passwords."""

import logging

from django.conf import settings
from django.contrib.auth import password_validation, update_session_auth_hash
from django.contrib.auth.models import Group
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


@transaction.atomic
def create_user(
    *,
    email: str,
    role: str,
    password: str | None = None,
    first_name: str = "",
    last_name: str = "",
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
    audit.record(
        AuditAction.USER_CREATED,
        actor=actor,
        target=user,
        changes={"email": email, "role": role, "first_name": first_name, "last_name": last_name},
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
        _apply_role(user, new_role)
        audit.record(
            AuditAction.USER_ROLE_CHANGED,
            actor=actor,
            target=user,
            changes={"role": {"from": old_role, "to": new_role}},
            request=request,
        )
    return user


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
