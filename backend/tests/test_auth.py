import re

import pytest
from django.contrib.sessions.models import Session
from django.core import mail
from rest_framework.test import APIClient

from apps.audit.models import AuditAction, AuditLog
from apps.users.models import UserSession

from .conftest import PASSWORD

pytestmark = pytest.mark.django_db

LOGIN = "/api/v1/auth/login/"
ME = "/api/v1/auth/me/"


def test_login_success_returns_profile_and_sets_session(api_client, admin_user):
    res = api_client.post(LOGIN, {"email": "ADMIN@example.com", "password": PASSWORD})
    assert res.status_code == 200
    assert res.data["email"] == "admin@example.com"
    assert res.data["role"] == "ADMIN"
    assert "devhub_sessionid" in res.cookies
    assert res.cookies["devhub_sessionid"]["httponly"]
    assert UserSession.objects.filter(user=admin_user).count() == 1
    assert AuditLog.objects.filter(action=AuditAction.LOGIN_SUCCEEDED).exists()


def test_login_wrong_password_is_generic_and_audited(api_client, admin_user):
    res = api_client.post(LOGIN, {"email": admin_user.email, "password": "wrong"})
    assert res.status_code == 400
    assert res.data["code"] == "invalid_credentials"
    assert AuditLog.objects.filter(action=AuditAction.LOGIN_FAILED).count() == 1


def test_login_unknown_user_same_error(api_client):
    res = api_client.post(LOGIN, {"email": "nobody@example.com", "password": "x"})
    assert res.status_code == 400
    assert res.data["code"] == "invalid_credentials"


def test_inactive_user_cannot_login(api_client, make_user):
    user = make_user(is_active=False)
    res = api_client.post(LOGIN, {"email": user.email, "password": PASSWORD})
    assert res.status_code == 400


def test_login_validation_error_format(api_client):
    res = api_client.post(LOGIN, {"email": "not-an-email"})
    assert res.status_code == 400
    assert res.data["code"] == "validation_error"
    assert "email" in res.data["fields"]
    assert "password" in res.data["fields"]


def test_login_requires_csrf_token():
    client = APIClient(enforce_csrf_checks=True)
    res = client.post(LOGIN, {"email": "a@example.com", "password": "x"})
    assert res.status_code == 403

    client.get("/api/v1/auth/csrf/")
    token = client.cookies["devhub_csrftoken"].value
    res = client.post(LOGIN, {"email": "a@example.com", "password": "x"}, HTTP_X_CSRFTOKEN=token)
    assert res.status_code == 400  # CSRF accepted, credentials rejected


def test_me_requires_authentication(api_client):
    res = api_client.get(ME)
    assert res.status_code == 403
    assert res.data["code"] == "not_authenticated"


def test_me_includes_active_organizations(as_user, client_user, make_org):
    make_org("Acme", members=(client_user,))
    make_org("Old Corp", members=(client_user,), is_active=False)
    res = as_user(client_user).get(ME)
    assert res.status_code == 200
    assert [o["name"] for o in res.data["organizations"]] == ["Acme"]


def test_update_profile(as_user, client_user):
    res = as_user(client_user).patch(ME, {"first_name": "Ana", "email": "hack@example.com"})
    assert res.status_code == 200
    client_user.refresh_from_db()
    assert client_user.first_name == "Ana"
    assert client_user.email == "client@example.com"


def test_logout_destroys_session(as_user, client_user):
    client = as_user(client_user)
    assert client.post("/api/v1/auth/logout/").status_code == 204
    assert client.get(ME).status_code == 403
    assert not UserSession.objects.filter(user=client_user).exists()


def test_change_password_keeps_current_session_and_revokes_others(as_user, client_user):
    other = APIClient()
    assert other.login(email=client_user.email, password=PASSWORD)
    client = as_user(client_user)
    res = client.post(
        "/api/v1/auth/change-password/",
        {"current_password": PASSWORD, "new_password": "Otra-Clave-Segura-99"},
    )
    assert res.status_code == 200
    assert client.get(ME).status_code == 200
    assert other.get(ME).status_code == 403
    client_user.refresh_from_db()
    assert client_user.check_password("Otra-Clave-Segura-99")


def test_change_password_wrong_current(as_user, client_user):
    res = as_user(client_user).post(
        "/api/v1/auth/change-password/",
        {"current_password": "bad", "new_password": "Otra-Clave-Segura-99"},
    )
    assert res.status_code == 400
    assert "current_password" in res.data["fields"]


def test_change_password_weak_new_password(as_user, client_user):
    res = as_user(client_user).post(
        "/api/v1/auth/change-password/",
        {"current_password": PASSWORD, "new_password": "123"},
    )
    assert res.status_code == 400
    assert "new_password" in res.data["fields"]


def test_password_reset_full_flow(api_client, client_user):
    res = api_client.post("/api/v1/auth/password-reset/", {"email": client_user.email})
    assert res.status_code == 202
    assert len(mail.outbox) == 1
    match = re.search(r"uid=([^&\s]+)&token=([^\s]+)", mail.outbox[0].body)
    assert match
    uid, token = match.groups()

    res = api_client.post(
        "/api/v1/auth/password-reset/confirm/",
        {"uid": uid, "token": token, "new_password": "Nueva-Clave-2026!"},
    )
    assert res.status_code == 200
    client_user.refresh_from_db()
    assert client_user.check_password("Nueva-Clave-2026!")

    # Token is single-use (password hash changed).
    res = api_client.post(
        "/api/v1/auth/password-reset/confirm/",
        {"uid": uid, "token": token, "new_password": "Otra-Clave-2026!"},
    )
    assert res.status_code == 400
    assert res.data["code"] == "invalid_token"


def test_password_reset_unknown_email_does_not_leak(api_client):
    res = api_client.post("/api/v1/auth/password-reset/", {"email": "ghost@example.com"})
    assert res.status_code == 202
    assert len(mail.outbox) == 0


def test_password_reset_invalid_uid(api_client):
    res = api_client.post(
        "/api/v1/auth/password-reset/confirm/",
        {"uid": "garbage", "token": "x", "new_password": "Nueva-Clave-2026!"},
    )
    assert res.status_code == 400
    assert res.data["code"] == "invalid_token"


def test_login_is_rate_limited(api_client, settings):
    from django.core.cache import cache
    from rest_framework.throttling import ScopedRateThrottle

    cache.clear()
    original = ScopedRateThrottle.THROTTLE_RATES
    ScopedRateThrottle.THROTTLE_RATES = {**original, "login": "3/min"}
    try:
        codes = [
            api_client.post(LOGIN, {"email": "x@example.com", "password": "x"}).status_code
            for _ in range(4)
        ]
    finally:
        ScopedRateThrottle.THROTTLE_RATES = original
        cache.clear()
    assert codes == [400, 400, 400, 429]


def test_sessions_are_db_backed(as_user, client_user):
    as_user(client_user)
    assert Session.objects.count() == 1
