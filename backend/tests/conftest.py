import itertools

import pytest
from rest_framework.test import APIClient

from apps.organizations.models import Membership, Organization
from apps.users import services as user_services
from apps.users.models import User
from apps.users.roles import Role

PASSWORD = "S3guro-Pass-2026!"
_seq = itertools.count(1)


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def make_user(db):
    def _make(role: str = Role.CLIENT, *, email: str | None = None, **extra) -> User:
        email = email or f"user{next(_seq)}@example.com"
        user = User.objects.create_user(email=email, password=PASSWORD, **extra)
        user_services._apply_role(user, role)
        return user

    return _make


@pytest.fixture
def admin_user(make_user) -> User:
    return make_user(Role.ADMIN, email="admin@example.com")


@pytest.fixture
def developer(make_user) -> User:
    return make_user(Role.DEVELOPER, email="dev@example.com")


@pytest.fixture
def client_user(make_user) -> User:
    return make_user(Role.CLIENT, email="client@example.com")


@pytest.fixture
def as_user(api_client):
    """Return an APIClient authenticated (real session) as the given user."""

    def _login(user: User) -> APIClient:
        api_client.force_authenticate(user=None)
        assert api_client.login(email=user.email, password=PASSWORD)
        return api_client

    return _login


@pytest.fixture
def make_org(db):
    def _make(name: str | None = None, *, members: tuple[User, ...] = (), **extra) -> Organization:
        name = name or f"Org {next(_seq)}"
        slug = extra.pop("slug", name.lower().replace(" ", "-"))
        org = Organization.objects.create(name=name, slug=slug, **extra)
        for user in members:
            Membership.objects.create(organization=org, user=user)
        return org

    return _make


@pytest.fixture
def make_project(db, admin_user):
    from apps.projects.models import Project

    def _make(name: str | None = None, *, owner: User | None = None, **extra) -> Project:
        name = name or f"Proyecto {next(_seq)}"
        slug = extra.pop("slug", name.lower().replace(" ", "-"))
        return Project.objects.create(name=name, slug=slug, owner=owner or admin_user, **extra)

    return _make


@pytest.fixture(autouse=True)
def _media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
