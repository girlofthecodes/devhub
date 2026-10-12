import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.audit.models import AuditAction, AuditLog
from apps.users import services
from apps.users.models import User
from apps.users.roles import Role
from common.exceptions import DomainError

from .conftest import PASSWORD

pytestmark = pytest.mark.django_db

USERS = "/api/v1/users/"


def test_role_groups_are_created_by_migrations():
    assert set(Group.objects.values_list("name", flat=True)) >= set(Role.values)
    admin_perms = set(
        Group.objects.get(name=Role.ADMIN).permissions.values_list("codename", flat=True)
    )
    assert {"add_user", "view_auditlog", "add_membership"} <= admin_perms


def test_create_superuser_gets_admin_role(db):
    user = User.objects.create_superuser(email="Root@Example.com", password=PASSWORD)
    assert user.email == "root@example.com"
    assert user.role == Role.ADMIN


@pytest.mark.parametrize("role", [Role.DEVELOPER, Role.CLIENT, Role.VISITOR])
def test_non_admin_cannot_access_users(as_user, make_user, role):
    client = as_user(make_user(role))
    assert client.get(USERS).status_code == 403
    assert client.post(USERS, {"email": "x@example.com", "role": "ADMIN"}).status_code == 403


def test_anonymous_cannot_access_users(api_client):
    assert api_client.get(USERS).status_code == 403


def test_admin_creates_user_with_role_and_audit(as_user, admin_user):
    client = as_user(admin_user)
    res = client.post(
        USERS,
        {
            "email": "New.Dev@Example.com",
            "first_name": "Nuevo",
            "role": "DEVELOPER",
            "password": "Clave-Segura-2026",
        },
    )
    assert res.status_code == 201, res.data
    assert res.data["email"] == "new.dev@example.com"
    assert res.data["role"] == "DEVELOPER"
    user = User.objects.get(email="new.dev@example.com")
    assert user.check_password("Clave-Segura-2026")
    log = AuditLog.objects.get(action=AuditAction.USER_CREATED)
    assert log.actor == admin_user
    assert "password" not in log.changes


def test_create_user_without_password_has_unusable_password(as_user, admin_user):
    res = as_user(admin_user).post(USERS, {"email": "nopass@example.com", "role": "CLIENT"})
    assert res.status_code == 201
    assert not User.objects.get(email="nopass@example.com").has_usable_password()


def test_create_user_duplicate_email(as_user, admin_user, client_user):
    res = as_user(admin_user).post(USERS, {"email": "CLIENT@example.com", "role": "CLIENT"})
    assert res.status_code == 400
    assert "email" in res.data["fields"]


def test_create_user_weak_password(as_user, admin_user):
    res = as_user(admin_user).post(
        USERS, {"email": "weak@example.com", "role": "CLIENT", "password": "12345"}
    )
    assert res.status_code == 400
    assert "password" in res.data["fields"]


def test_create_user_invalid_role(as_user, admin_user):
    res = as_user(admin_user).post(USERS, {"email": "r@example.com", "role": "ROOT"})
    assert res.status_code == 400
    assert "role" in res.data["fields"]


def test_list_filter_search_and_paginate(as_user, admin_user, make_user):
    for i in range(25):
        make_user(Role.CLIENT, email=f"cliente{i:02d}@example.com")
    make_user(Role.DEVELOPER, email="dev-x@example.com")
    client = as_user(admin_user)

    res = client.get(USERS)
    assert res.data["count"] == 27
    assert len(res.data["results"]) == 20
    assert res.data["next"]

    res = client.get(USERS, {"page_size": 5, "page": 2})
    assert len(res.data["results"]) == 5

    res = client.get(USERS, {"role": "DEVELOPER"})
    assert [u["email"] for u in res.data["results"]] == ["dev-x@example.com"]

    res = client.get(USERS, {"search": "cliente1"})
    assert res.data["count"] == 10


def test_update_user_role_and_profile(as_user, admin_user, client_user):
    res = as_user(admin_user).patch(
        f"{USERS}{client_user.id}/", {"role": "DEVELOPER", "last_name": "Pérez"}
    )
    assert res.status_code == 200
    assert res.data["role"] == "DEVELOPER"
    assert res.data["last_name"] == "Pérez"
    assert AuditLog.objects.filter(action=AuditAction.USER_ROLE_CHANGED).exists()


def test_admin_cannot_change_own_role(as_user, admin_user):
    res = as_user(admin_user).patch(f"{USERS}{admin_user.id}/", {"role": "CLIENT"})
    assert res.status_code == 400
    assert res.data["code"] == "self_role_change"


def test_deactivate_user_revokes_sessions(as_user, admin_user, client_user):
    victim = APIClient()
    assert victim.login(email=client_user.email, password=PASSWORD)
    assert victim.get("/api/v1/auth/me/").status_code == 200

    res = as_user(admin_user).post(f"{USERS}{client_user.id}/deactivate/")
    assert res.status_code == 200
    assert res.data["is_active"] is False
    assert victim.get("/api/v1/auth/me/").status_code == 403
    log = AuditLog.objects.get(action=AuditAction.USER_DEACTIVATED)
    assert log.metadata["sessions_revoked"] == 1


def test_admin_cannot_deactivate_self(as_user, admin_user):
    res = as_user(admin_user).post(f"{USERS}{admin_user.id}/deactivate/")
    assert res.status_code == 400
    assert res.data["code"] == "self_deactivation"


def test_service_refuses_to_deactivate_last_admin(admin_user, developer):
    with pytest.raises(DomainError) as exc:
        services.deactivate_user(admin_user, actor=developer)
    assert exc.value.code == "last_admin"
    admin_user.refresh_from_db()
    assert admin_user.is_active


def test_activate_user(as_user, admin_user, make_user):
    user = make_user(is_active=False)
    res = as_user(admin_user).post(f"{USERS}{user.id}/activate/")
    assert res.data["is_active"] is True


def test_users_cannot_be_deleted(as_user, admin_user, client_user):
    assert as_user(admin_user).delete(f"{USERS}{client_user.id}/").status_code == 405


def test_revoke_sessions_endpoint(as_user, admin_user, client_user):
    victim = APIClient()
    assert victim.login(email=client_user.email, password=PASSWORD)
    res = as_user(admin_user).post(f"{USERS}{client_user.id}/revoke-sessions/")
    assert res.status_code == 200
    assert victim.get("/api/v1/auth/me/").status_code == 403


def test_roles_endpoint(as_user, admin_user):
    res = as_user(admin_user).get("/api/v1/roles/")
    assert {r["value"] for r in res.data} == set(Role.values)
