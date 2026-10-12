import pytest
from django.core.exceptions import ValidationError

from apps.audit.models import AuditAction, AuditLog
from apps.infrastructure.models import Environment, Server
from apps.projects.models import ProjectMember, ProjectStatus
from apps.users.roles import Role
from common.validators import validate_private_address, validate_public_https_url

pytestmark = pytest.mark.django_db

SERVERS = "/api/v1/servers/"
ENVS = "/api/v1/environments/"
SUMMARY = "/api/v1/infrastructure/summary/"


@pytest.fixture
def make_server(db):
    def _make(identifier="homelab-app-01", **extra) -> Server:
        return Server.objects.create(
            name=extra.pop("name", identifier), identifier=identifier, **extra
        )

    return _make


# --- validators -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://app.example.com",
        "https://192.168.1.10",
        "https://[::1]/",
        "https://localhost:8000",
        "https://db.local",
        "https://intranet",
        "https://user:pass@app.example.com",
        "ftp://app.example.com",
    ],
)
def test_public_url_rejects_unsafe_targets(url):
    with pytest.raises(ValidationError):
        validate_public_https_url(url)


def test_public_url_accepts_domains_and_respects_allowlist(settings):
    validate_public_https_url("https://demo.girlofthecodes.dev/app")
    settings.DEVHUB_ALLOWED_PUBLIC_DOMAINS = ["girlofthecodes.dev"]
    validate_public_https_url("https://demo.girlofthecodes.dev")
    validate_public_https_url("https://girlofthecodes.dev")
    with pytest.raises(ValidationError):
        validate_public_https_url("https://evil-girlofthecodes.dev")


@pytest.mark.parametrize("ip", ["10.0.0.5", "192.168.1.20", "100.101.102.103", "fd7a:115c:a1e0::1"])
def test_private_address_accepts_vpn_ranges(ip):
    validate_private_address(ip)


@pytest.mark.parametrize("ip", ["8.8.8.8", "127.0.0.1", "0.0.0.0", "not-an-ip"])
def test_private_address_rejects_public_or_invalid(ip):
    with pytest.raises(ValidationError):
        validate_private_address(ip)


# --- servers ---------------------------------------------------------------------------


def test_admin_registers_server(as_user, admin_user):
    res = as_user(admin_user).post(
        SERVERS,
        {
            "name": "Servidor A",
            "identifier": "HomeLab-App-01",
            "location": "Casa · rack",
            "server_type": "APPLICATION",
            "operating_system": "Ubuntu Server 24.04",
            "vpn_address": "100.64.0.10",
        },
    )
    assert res.status_code == 201, res.data
    assert res.data["identifier"] == "homelab-app-01"
    assert res.data["last_checked_at"] is None  # set only by monitoring (Fase 6)
    assert res.data["environment_count"] == 0
    assert AuditLog.objects.filter(action=AuditAction.SERVER_CREATED).exists()


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"identifier": "con espacios"}, "identifier"),
        ({"vpn_address": "8.8.8.8"}, "vpn_address"),
        ({"server_type": "MAINFRAME"}, "server_type"),
    ],
)
def test_server_validation(as_user, admin_user, payload, field):
    data = {"name": "Servidor", "identifier": "srv-01", **payload}
    res = as_user(admin_user).post(SERVERS, data)
    assert res.status_code == 400
    assert field in res.data["fields"]


def test_server_identifier_unique(as_user, admin_user, make_server):
    make_server("srv-01")
    res = as_user(admin_user).post(SERVERS, {"name": "Otro", "identifier": "srv-01"})
    assert res.data["code"] == "duplicate"


def test_server_has_no_secret_fields(as_user, admin_user, make_server):
    make_server()
    data = as_user(admin_user).get(SERVERS).data["results"][0]
    assert not any(k in data for k in ("password", "ssh_key", "private_key", "credentials"))


def test_developer_reads_inventory_but_cannot_modify(as_user, developer, make_server):
    server = make_server()
    client = as_user(developer)
    assert client.get(SERVERS).status_code == 200
    assert client.get(f"{SERVERS}{server.id}/").status_code == 200
    assert client.post(SERVERS, {"name": "X", "identifier": "x-1"}).status_code == 403
    assert client.patch(f"{SERVERS}{server.id}/", {"name": "Y"}).status_code == 403


@pytest.mark.parametrize("role", [Role.CLIENT, Role.VISITOR])
def test_clients_cannot_see_infrastructure(as_user, make_user, make_server, role):
    make_server()
    client = as_user(make_user(role))
    assert client.get(SERVERS).status_code == 403
    assert client.get(ENVS).status_code == 403
    assert client.get(SUMMARY).status_code == 403


def test_servers_cannot_be_deleted(as_user, admin_user, make_server):
    server = make_server()
    assert as_user(admin_user).delete(f"{SERVERS}{server.id}/").status_code == 405


def test_cannot_retire_server_with_active_environments(
    as_user, admin_user, make_server, make_project
):
    server = make_server()
    env = Environment.objects.create(project=make_project(), kind="PRODUCTION", server=server)
    client = as_user(admin_user)
    res = client.patch(f"{SERVERS}{server.id}/", {"status": "INACTIVE"})
    assert res.status_code == 400
    assert res.data["code"] == "server_in_use"

    env.status = "INACTIVE"
    env.save()
    res = client.patch(f"{SERVERS}{server.id}/", {"status": "INACTIVE"})
    assert res.data["status"] == "INACTIVE"


def test_server_filters_and_counts(as_user, admin_user, make_server, make_project):
    app = make_server("app-01", server_type="APPLICATION")
    make_server("db-01", server_type="DATABASE", status="MAINTENANCE")
    Environment.objects.create(project=make_project(), kind="DEMO", server=app)
    Environment.objects.create(project=make_project(), kind="DEMO", server=app, status="INACTIVE")
    client = as_user(admin_user)
    assert client.get(SERVERS, {"server_type": "DATABASE"}).data["count"] == 1
    assert client.get(SERVERS, {"status": "MAINTENANCE"}).data["count"] == 1
    row = client.get(f"{SERVERS}{app.id}/").data
    assert (row["environment_count"], row["active_environment_count"]) == (2, 1)


# --- environments ---------------------------------------------------------------------


def test_admin_creates_environment(as_user, admin_user, make_project, make_server):
    project, server = make_project(), make_server()
    res = as_user(admin_user).post(
        ENVS,
        {
            "project": str(project.id),
            "kind": "DEMO",
            "server": str(server.id),
            "public_url": "https://demo.example.com",
            "deployed_version": "v1.2.0",
        },
    )
    assert res.status_code == 201, res.data
    assert res.data["display_name"] == "Demo"
    assert res.data["server_detail"]["identifier"] == server.identifier
    assert res.data["can_edit"] is True
    assert AuditLog.objects.filter(action=AuditAction.ENVIRONMENT_CREATED).exists()


def test_one_environment_per_kind(as_user, admin_user, make_project):
    project = make_project()
    client = as_user(admin_user)
    assert client.post(ENVS, {"project": str(project.id), "kind": "DEMO"}).status_code == 201
    res = client.post(ENVS, {"project": str(project.id), "kind": "DEMO"})
    assert res.data["code"] == "duplicate"
    assert "kind" in res.data["fields"]


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"public_url": "http://demo.example.com"}, "public_url"),
        ({"public_url": "https://10.0.0.5"}, "public_url"),
        ({"deployed_version": "1.0 beta;rm"}, "deployed_version"),
        ({"kind": "STAGING"}, "kind"),
    ],
)
def test_environment_validation(as_user, admin_user, make_project, payload, field):
    data = {"project": str(make_project().id), "kind": "DEMO", **payload}
    res = as_user(admin_user).post(ENVS, data)
    assert res.status_code == 400
    assert field in res.data["fields"]


def test_cannot_assign_inactive_server(as_user, admin_user, make_project, make_server):
    server = make_server(status="INACTIVE")
    res = as_user(admin_user).post(
        ENVS, {"project": str(make_project().id), "kind": "DEMO", "server": str(server.id)}
    )
    assert res.data["code"] == "inactive_server"


def test_archived_project_environments_are_read_only(as_user, admin_user, make_project):
    project = make_project(status=ProjectStatus.ARCHIVED)
    env = Environment.objects.create(project=project, kind="DEMO")
    client = as_user(admin_user)
    assert (
        client.post(ENVS, {"project": str(project.id), "kind": "PRODUCTION"}).data["code"]
        == "archived"
    )
    assert client.patch(f"{ENVS}{env.id}/", {"deployed_version": "v2"}).data["code"] == "archived"
    assert client.get(f"{ENVS}{env.id}/").data["can_edit"] is False


def test_environments_cannot_be_deleted_and_kind_is_immutable(as_user, admin_user, make_project):
    env = Environment.objects.create(project=make_project(), kind="DEMO")
    client = as_user(admin_user)
    assert client.delete(f"{ENVS}{env.id}/").status_code == 405
    res = client.patch(f"{ENVS}{env.id}/", {"kind": "PRODUCTION", "deployed_version": "v3"})
    assert res.status_code == 200
    assert res.data["kind"] == "DEMO"
    assert res.data["deployed_version"] == "v3"


def test_developer_scope_and_permissions(as_user, developer, make_user, make_project):
    mine = make_project("Mio", owner=developer)
    assigned = make_project("Asignado")
    ProjectMember.objects.create(project=assigned, user=developer, role="CONTRIBUTOR")
    other = make_project("Ajeno")
    env_mine = Environment.objects.create(project=mine, kind="DEMO")
    env_assigned = Environment.objects.create(project=assigned, kind="DEMO")
    env_other = Environment.objects.create(project=other, kind="DEMO")
    client = as_user(developer)

    ids = {e["id"] for e in client.get(ENVS).data["results"]}
    assert ids == {str(env_mine.id), str(env_assigned.id)}
    assert client.get(f"{ENVS}{env_other.id}/").status_code == 404

    # Owner can manage; contributor cannot; foreign project looks invalid.
    assert client.post(ENVS, {"project": str(mine.id), "kind": "PRODUCTION"}).status_code == 201
    assert client.patch(f"{ENVS}{env_mine.id}/", {"deployed_version": "v1.1"}).status_code == 200
    assert client.patch(f"{ENVS}{env_assigned.id}/", {"deployed_version": "x"}).status_code == 403
    assert client.post(ENVS, {"project": str(assigned.id), "kind": "PRODUCTION"}).status_code == 403
    res = client.post(ENVS, {"project": str(other.id), "kind": "PRODUCTION"})
    assert res.status_code == 400
    assert "project" in res.data["fields"]


def test_environment_filters(as_user, admin_user, make_project, make_server):
    server = make_server()
    p1, p2 = make_project("Uno"), make_project("Dos")
    Environment.objects.create(project=p1, kind="DEMO", server=server)
    Environment.objects.create(project=p1, kind="PRODUCTION", status="MAINTENANCE")
    Environment.objects.create(project=p2, kind="DEMO", public_url="https://dos.example.com")
    client = as_user(admin_user)
    assert client.get(ENVS, {"project": str(p1.id)}).data["count"] == 2
    assert client.get(ENVS, {"kind": "DEMO"}).data["count"] == 2
    assert client.get(ENVS, {"server": str(server.id)}).data["count"] == 1
    assert client.get(ENVS, {"status": "MAINTENANCE"}).data["count"] == 1
    assert client.get(ENVS, {"search": "dos.example"}).data["count"] == 1


# --- production URL ↔ project site_url ------------------------------------------------


def test_production_url_fills_empty_site_url(as_user, admin_user, make_project):
    project = make_project()
    client = as_user(admin_user)
    res = client.post(
        ENVS,
        {"project": str(project.id), "kind": "PRODUCTION", "public_url": "https://app.example.com"},
    )
    env_id = res.data["id"]
    project.refresh_from_db()
    assert project.site_url == "https://app.example.com"

    # Follows production while it still matches the previous production URL.
    client.patch(f"{ENVS}{env_id}/", {"public_url": "https://www.example.com"})
    project.refresh_from_db()
    assert project.site_url == "https://www.example.com"
    log = AuditLog.objects.filter(action=AuditAction.PROJECT_UPDATED).first()
    assert log.metadata == {"source": "production_environment"}


def test_production_url_does_not_overwrite_custom_site_url(as_user, admin_user, make_project):
    project = make_project(site_url="https://marca.example.com")
    as_user(admin_user).post(
        ENVS,
        {"project": str(project.id), "kind": "PRODUCTION", "public_url": "https://app.example.com"},
    )
    project.refresh_from_db()
    assert project.site_url == "https://marca.example.com"


def test_demo_url_does_not_touch_site_url(as_user, admin_user, make_project):
    project = make_project()
    as_user(admin_user).post(
        ENVS, {"project": str(project.id), "kind": "DEMO", "public_url": "https://demo.example.com"}
    )
    project.refresh_from_db()
    assert project.site_url == ""


def test_project_site_url_now_rejects_internal_hosts(as_user, admin_user, make_project):
    project = make_project()
    res = as_user(admin_user).patch(
        f"/api/v1/projects/{project.id}/", {"site_url": "https://192.168.0.5"}
    )
    assert res.status_code == 400
    assert "site_url" in res.data["fields"]


# --- summary --------------------------------------------------------------------------


def test_summary_counts_are_scoped(as_user, admin_user, developer, make_project, make_server):
    make_server("app-01")
    make_server("db-01", server_type="DATABASE", status="MAINTENANCE")
    mine = make_project("Mio", owner=developer)
    Environment.objects.create(project=mine, kind="DEMO")
    Environment.objects.create(project=make_project("Ajeno"), kind="PRODUCTION", status="INACTIVE")

    data = as_user(admin_user).get(SUMMARY).data
    assert data["servers"]["total"] == 2
    assert data["servers"]["by_status"] == {"ACTIVE": 1, "MAINTENANCE": 1, "INACTIVE": 0}
    assert data["environments"]["total"] == 2
    assert data["environments"]["by_kind"]["PRODUCTION"] == 1
    assert data["environments"]["without_server"] == 2

    data = as_user(developer).get(SUMMARY).data
    assert data["environments"]["total"] == 1
    assert data["environments"]["by_kind"] == {"DEVELOPMENT": 0, "DEMO": 1, "PRODUCTION": 0}
