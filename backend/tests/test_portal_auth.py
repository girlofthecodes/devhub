"""Fase 7 (bloque A): login separado por portal y autorización según el contexto de sesión."""

import pytest
from django.contrib.sessions.models import Session
from rest_framework.test import APIClient

from apps.audit.models import AuditAction, AuditLog
from apps.users import services as user_services
from apps.users.roles import Role

from .conftest import PASSWORD

pytestmark = pytest.mark.django_db

ADMIN_LOGIN = "/api/v1/auth/admin/login/"
CLIENT_LOGIN = "/api/v1/auth/client/login/"
ME = "/api/v1/auth/me/"
PORTAL_SUMMARY = "/api/v1/portal/summary/"
PROJECTS = "/api/v1/projects/"
USERS = "/api/v1/users/"

ADMIN_DENIED = "Tu cuenta no tiene permisos para acceder al panel administrativo."
CLIENT_DENIED = "Tu cuenta no tiene acceso al portal de clientes."


def _login(url, user, client=None, password=PASSWORD):
    client = client or APIClient()
    return client, client.post(url, {"email": user.email, "password": password})


@pytest.fixture
def dual_user(make_user, make_org):
    """Administrator who is also a member of a client organization."""
    user = make_user(Role.ADMIN, email="dual@example.com")
    user_services._apply_client_access(user, True)
    make_org("Acme", members=(user,))
    return user


def test_generic_login_endpoint_no_longer_exists(api_client, admin_user):
    res = api_client.post("/api/v1/auth/login/", {"email": admin_user.email, "password": PASSWORD})
    assert res.status_code == 404


def test_case1_admin_only_rejected_in_client_login(admin_user):
    client, res = _login(CLIENT_LOGIN, admin_user)
    assert res.status_code == 403
    assert res.data == {"code": "portal_not_allowed", "detail": CLIENT_DENIED}
    assert client.get(ME).status_code == 403  # no session was created
    log = AuditLog.objects.get(action=AuditAction.LOGIN_FAILED)
    assert log.metadata["reason"] == "portal_not_allowed"
    assert log.metadata["portal"] == "client"


def test_developer_rejected_in_client_login(developer):
    _, res = _login(CLIENT_LOGIN, developer)
    assert res.status_code == 403
    assert res.data["detail"] == CLIENT_DENIED


@pytest.mark.parametrize("role", [Role.CLIENT, Role.VISITOR])
def test_case2_client_rejected_in_admin_login(make_user, role):
    client, res = _login(ADMIN_LOGIN, make_user(role))
    assert res.status_code == 403
    assert res.data == {"code": "portal_not_allowed", "detail": ADMIN_DENIED}
    assert client.get(ME).status_code == 403


def test_case3_client_logs_into_client_portal(client_user, make_org):
    make_org("Acme", members=(client_user,))
    client, res = _login(CLIENT_LOGIN, client_user)
    assert res.status_code == 200
    assert res.data["role"] == "CLIENT"
    assert res.data["portal"] == "client"
    assert client.get(PORTAL_SUMMARY).status_code == 200
    assert client.get(PROJECTS).status_code == 403


@pytest.mark.parametrize("role", [Role.ADMIN, Role.DEVELOPER])
def test_case4_staff_logs_into_admin_portal(make_user, role):
    client, res = _login(ADMIN_LOGIN, make_user(role))
    assert res.status_code == 200
    assert res.data["role"] == role
    assert res.data["portal"] == "admin"
    assert client.get(PROJECTS).status_code == 200
    assert client.get(PORTAL_SUMMARY).status_code == 403


@pytest.mark.parametrize("url", [ADMIN_LOGIN, CLIENT_LOGIN])
@pytest.mark.parametrize("role", [Role.ADMIN, Role.CLIENT])
def test_case5_inactive_user_rejected_in_any_portal(make_user, url, role):
    _, res = _login(url, make_user(role, is_active=False))
    assert res.status_code == 400
    assert res.data["code"] == "invalid_credentials"


def test_wrong_password_never_reveals_portal_policy(admin_user):
    _, res = _login(CLIENT_LOGIN, admin_user, password="incorrecta")
    assert res.status_code == 400
    assert res.data["code"] == "invalid_credentials"


def test_case6_dual_user_client_session_is_client_only(dual_user):
    client, res = _login(CLIENT_LOGIN, dual_user)
    assert res.status_code == 200
    assert res.data["role"] == "CLIENT"
    assert res.data["portal"] == "client"
    assert set(res.data["available_portals"]) == {"admin", "client"}
    assert client.get(PORTAL_SUMMARY).status_code == 200
    # A session opened in the client portal cannot reach admin endpoints.
    assert client.get(PROJECTS).status_code == 403
    assert client.get(USERS).status_code == 403
    assert client.get(ME).data["role"] == "CLIENT"


def test_case6_dual_user_admin_session_is_admin_only(dual_user):
    client, res = _login(ADMIN_LOGIN, dual_user)
    assert res.status_code == 200
    assert res.data["role"] == "ADMIN"
    assert res.data["portal"] == "admin"
    assert client.get(PROJECTS).status_code == 200
    assert client.get(USERS).status_code == 200
    assert client.get(PORTAL_SUMMARY).status_code == 403


def test_switching_portal_replaces_the_session(dual_user):
    client, _ = _login(CLIENT_LOGIN, dual_user)
    first = client.cookies["devhub_sessionid"].value
    _, res = _login(ADMIN_LOGIN, dual_user, client)
    assert res.status_code == 200
    assert client.cookies["devhub_sessionid"].value != first
    assert not Session.objects.filter(session_key=first).exists()
    assert client.get(PROJECTS).status_code == 200
    assert client.get(PORTAL_SUMMARY).status_code == 403


def test_revoking_client_access_takes_effect_on_open_session(dual_user, admin_user):
    client, _ = _login(CLIENT_LOGIN, dual_user)
    user_services.update_user(dual_user, data={"client_portal_access": False}, actor=admin_user)
    assert client.get(PORTAL_SUMMARY).status_code == 403
    assert client.get(ME).data["role"] is None


def test_demoted_admin_loses_admin_session(make_user, admin_user):
    user = make_user(Role.ADMIN, email="other-admin@example.com")
    client, _ = _login(ADMIN_LOGIN, user)
    user_services.update_user(user, data={"role": Role.CLIENT}, actor=admin_user)
    assert client.get(PROJECTS).status_code == 403
    assert client.get(PORTAL_SUMMARY).status_code == 403


def test_logout_ends_the_portal_session(client_user):
    client, _ = _login(CLIENT_LOGIN, client_user)
    assert client.post("/api/v1/auth/logout/").status_code == 204
    assert client.get(ME).status_code == 403
    assert client.get(PORTAL_SUMMARY).status_code == 403


def test_client_portal_login_requires_csrf(client_user):
    client = APIClient(enforce_csrf_checks=True)
    payload = {"email": client_user.email, "password": PASSWORD}
    assert client.post(CLIENT_LOGIN, payload).status_code == 403
    client.get("/api/v1/auth/csrf/")
    token = client.cookies["devhub_csrftoken"].value
    assert client.post(CLIENT_LOGIN, payload, HTTP_X_CSRFTOKEN=token).status_code == 200


def test_successful_login_audits_portal(client_user):
    _login(CLIENT_LOGIN, client_user)
    log = AuditLog.objects.get(action=AuditAction.LOGIN_SUCCEEDED)
    assert log.metadata == {"portal": "client"}


def test_admin_grants_and_revokes_additional_client_access(as_user, admin_user, developer):
    client = as_user(admin_user)
    res = client.patch(f"{USERS}{developer.pk}/", {"client_portal_access": True})
    assert res.status_code == 200, res.data
    assert res.data["role"] == "DEVELOPER"
    assert res.data["client_portal_access"] is True
    log = AuditLog.objects.filter(action=AuditAction.USER_UPDATED).latest("created_at")
    assert log.changes["client_portal_access"] == {"from": False, "to": True}
    # Changing between internal roles keeps the additional access.
    res = client.patch(f"{USERS}{developer.pk}/", {"role": "ADMIN"})
    assert res.data["client_portal_access"] is True
    res = client.patch(f"{USERS}{developer.pk}/", {"client_portal_access": False})
    assert res.data["client_portal_access"] is False


def test_visitor_cannot_receive_additional_client_access(as_user, admin_user, make_user):
    visitor = make_user(Role.VISITOR)
    res = as_user(admin_user).patch(f"{USERS}{visitor.pk}/", {"client_portal_access": True})
    assert res.status_code == 400
    assert res.data["code"] == "invalid_client_access"
