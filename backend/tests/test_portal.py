from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditAction, AuditLog
from apps.infrastructure.models import Environment
from apps.portal.models import DemoAccessToken
from apps.projects.models import ProjectAccess, ProjectMember, ProjectStatus, Release
from apps.traceability.models import Event, EventType
from apps.users.roles import Role

pytestmark = pytest.mark.django_db

PORTAL = "/api/v1/portal/"
RELEASES = "/api/v1/releases/"
REDEEM = "/api/v1/integrations/demo-access/redeem/"
INTERNAL_FIELDS = {
    "description_internal",
    "repository_url",
    "documentation_url",
    "owner",
    "members",
    "member_count",
    "organization_count",
    "permissions",
    "visibility",
    "environments",
    "deployments",
    "servers",
    "server",
    "public_url",
    "deployed_version",
    "logo",
}


@pytest.fixture
def world(make_user, make_org, make_project, developer):
    """Two clients in different organizations, each with their own shared project."""
    alice, bob = (
        make_user(Role.CLIENT, email="alice@acme.test"),
        make_user(Role.CLIENT, email="bob@beta.test"),
    )
    acme, beta = make_org("Acme", members=(alice,)), make_org("Beta", members=(bob,))
    pedidos = make_project(
        "Pedidos",
        owner=developer,
        description="INTERNO: usa la BD del servidor B, credenciales en vault",
        client_description="Gestiona y sigue tus pedidos en línea.",
        repository_url="https://github.com/acme/secret-repo",
        site_url="https://pedidos.example.com",
        technologies=["React", "Django"],
        status=ProjectStatus.AVAILABLE,
    )
    reservas = make_project("Reservas", client_description="Reservas para Beta.")
    oculto = make_project("Oculto")  # never shared
    ProjectAccess.objects.create(
        project=pedidos, organization=acme, expires_at=timezone.now() + timedelta(days=30)
    )
    ProjectAccess.objects.create(project=reservas, organization=beta)
    demo = Environment.objects.create(
        project=pedidos, kind="DEMO", public_url="https://demo-pedidos.example.com/app?lang=es"
    )
    Environment.objects.create(
        project=pedidos, kind="DEVELOPMENT", public_url="https://dev.example.com"
    )
    return {
        "alice": alice,
        "bob": bob,
        "acme": acme,
        "beta": beta,
        "pedidos": pedidos,
        "reservas": reservas,
        "oculto": oculto,
        "demo": demo,
    }


def _service_client(as_user, admin_user, projects) -> APIClient:
    res = as_user(admin_user).post(
        "/api/v1/service-tokens/", {"name": "Demo app", "projects": [str(p.id) for p in projects]}
    )
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['token']}")
    return c


# --- authorized applications & isolation ----------------------------------------------


def test_client_sees_only_projects_shared_with_their_organization(as_user, world):
    res = as_user(world["alice"]).get(f"{PORTAL}projects/")
    assert res.status_code == 200
    assert [p["name"] for p in res.data["results"]] == ["Pedidos"]
    res = as_user(world["bob"]).get(f"{PORTAL}projects/")
    assert [p["name"] for p in res.data["results"]] == ["Reservas"]


def test_other_clients_projects_are_404(as_user, world):
    client = as_user(world["alice"])
    for key in ("reservas", "oculto"):
        pid = world[key].id
        assert client.get(f"{PORTAL}projects/{pid}/").status_code == 404
        assert client.get(f"{PORTAL}projects/{pid}/releases/").status_code == 404
        assert client.post(f"{PORTAL}projects/{pid}/demo-access/").status_code == 404


def test_portal_payload_exposes_no_internal_data(as_user, world):
    res = as_user(world["alice"]).get(f"{PORTAL}projects/{world['pedidos'].id}/")
    assert res.status_code == 200
    data = res.data
    assert data["description"] == "Gestiona y sigue tus pedidos en línea."
    assert not (set(data) & INTERNAL_FIELDS)
    body = str(data)
    for secret in ("INTERNO", "secret-repo", "demo-pedidos", "dev.example.com", "vault"):
        assert secret not in body
    assert data["has_demo"] is True
    assert data["availability"] == {
        "status": "UNKNOWN",
        "label": "Sin monitoreo",
        "checked_at": None,
    }
    assert data["access"][0]["organization"] == "Acme"
    assert data["access"][0]["expires_at"] is not None


@pytest.mark.parametrize("role", [Role.ADMIN, Role.DEVELOPER, Role.VISITOR])
def test_portal_is_for_clients_only(as_user, make_user, role):
    client = as_user(make_user(role))
    assert client.get(f"{PORTAL}projects/").status_code == 403
    assert client.get(f"{PORTAL}summary/").status_code == 403


def test_anonymous_cannot_use_portal(api_client):
    assert api_client.get(f"{PORTAL}projects/").status_code == 403


def test_access_ends_when_revoked_expired_or_org_inactive(as_user, world):
    client = as_user(world["alice"])
    grant = ProjectAccess.objects.get(project=world["pedidos"])
    grant.expires_at = timezone.now() - timedelta(minutes=1)
    grant.save()
    assert client.get(f"{PORTAL}projects/").data["count"] == 0
    grant.expires_at = None
    grant.save()
    world["acme"].is_active = False
    world["acme"].save()
    assert client.get(f"{PORTAL}projects/").data["count"] == 0


def test_archived_projects_disappear_from_portal(as_user, world):
    world["pedidos"].status = ProjectStatus.ARCHIVED
    world["pedidos"].save()
    assert as_user(world["alice"]).get(f"{PORTAL}projects/").data["count"] == 0


def test_summary(as_user, world, developer):
    Release.objects.create(
        project=world["pedidos"],
        version="v1",
        notes="n",
        status="PUBLISHED",
        published_at=timezone.now(),
    )
    Release.objects.create(
        project=world["reservas"],
        version="v9",
        notes="n",
        status="PUBLISHED",
        published_at=timezone.now(),
    )
    data = as_user(world["alice"]).get(f"{PORTAL}summary/").data
    assert data["applications"] == 1 and data["demos"] == 1
    assert data["organizations"] == ["Acme"]
    assert [r["version"] for r in data["recent_releases"]] == ["v1"]


# --- releases -----------------------------------------------------------------------------


def test_only_published_releases_are_visible_to_clients(as_user, world):
    p = world["pedidos"]
    Release.objects.create(
        project=p,
        version="v1.0",
        notes="Primera",
        status="PUBLISHED",
        published_at=timezone.now() - timedelta(days=2),
    )
    Release.objects.create(
        project=p, version="v1.1", notes="Mejoras", status="PUBLISHED", published_at=timezone.now()
    )
    Release.objects.create(project=p, version="v2.0-draft", notes="secreto", status="DRAFT")
    Release.objects.create(project=p, version="v0.9", notes="retirada", status="WITHDRAWN")
    client = as_user(world["alice"])
    res = client.get(f"{PORTAL}projects/{p.id}/releases/")
    assert [r["version"] for r in res.data] == ["v1.1", "v1.0"]
    detail = client.get(f"{PORTAL}projects/{p.id}/").data
    assert detail["published_version"] == "v1.1"


def test_release_management_flow(as_user, developer, world):
    client = as_user(developer)  # owner of Pedidos
    p = world["pedidos"]
    res = client.post(RELEASES, {"project": str(p.id), "version": "v1.2.0", "title": "Pagos"})
    assert res.status_code == 201, res.data
    rid = res.data["id"]
    assert res.data["status"] == "DRAFT" and res.data["can_edit"] is True

    res = client.post(f"{RELEASES}{rid}/publish/")
    assert res.status_code == 400 and res.data["code"] == "notes_required"
    client.patch(f"{RELEASES}{rid}/", {"notes": "Nuevo pago con tarjeta.\n- Corrección de errores"})
    res = client.post(f"{RELEASES}{rid}/publish/")
    assert res.data["status"] == "PUBLISHED" and res.data["published_at"]
    assert Event.objects.filter(project=p, description__contains="v1.2.0 publicada").exists()

    dup = client.post(RELEASES, {"project": str(p.id), "version": "v1.2.0"})
    assert dup.data["code"] == "duplicate"

    res = client.post(f"{RELEASES}{rid}/withdraw/")
    assert res.data["status"] == "WITHDRAWN"
    assert client.patch(f"{RELEASES}{rid}/", {"notes": "x"}).data["code"] == "withdrawn"
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {
        AuditAction.RELEASE_CREATED,
        AuditAction.RELEASE_PUBLISHED,
        AuditAction.RELEASE_WITHDRAWN,
    } <= actions


def test_release_permissions(as_user, make_user, world):
    contributor = make_user(Role.DEVELOPER)
    ProjectMember.objects.create(project=world["pedidos"], user=contributor, role="CONTRIBUTOR")
    client = as_user(contributor)
    assert client.get(RELEASES).status_code == 200
    res = client.post(RELEASES, {"project": str(world["pedidos"].id), "version": "v1"})
    assert res.status_code == 403
    res = client.post(RELEASES, {"project": str(world["oculto"].id), "version": "v1"})
    assert res.status_code == 400  # not visible → looks invalid
    assert as_user(world["alice"]).get(RELEASES).status_code == 403


def test_release_deployment_must_belong_to_project(as_user, admin_user, world):
    from apps.deployments.models import Deployment

    other_env = Environment.objects.create(project=world["reservas"], kind="PRODUCTION")
    dep = Deployment.objects.create(environment=other_env, version="v1")
    res = as_user(admin_user).post(
        RELEASES, {"project": str(world["pedidos"].id), "version": "v1", "deployment": str(dep.id)}
    )
    assert res.data["code"] == "invalid"


def test_client_description_editable_by_maintainer(as_user, developer, world):
    res = as_user(developer).patch(
        f"/api/v1/projects/{world['pedidos'].id}/", {"client_description": "Nueva descripción"}
    )
    assert res.status_code == 200 and res.data["client_description"] == "Nueva descripción"


# --- secure demo access ---------------------------------------------------------------


def _issue(client, project):
    res = client.post(f"{PORTAL}projects/{project.id}/demo-access/")
    assert res.status_code == 200, res.data
    url = res.data["launch_url"]
    return url, parse_qs(urlsplit(url).query)["devhub_demo_token"][0]


def test_demo_ticket_issue_and_single_use_redeem(as_user, admin_user, world):
    url, raw = _issue(as_user(world["alice"]), world["pedidos"])
    parts = urlsplit(url)
    assert parts.netloc == "demo-pedidos.example.com" and parts.path == "/app"
    assert parse_qs(parts.query)["lang"] == ["es"]  # original query preserved
    token = DemoAccessToken.objects.get()
    assert raw not in token.token_hash  # only the hash is stored
    assert Event.objects.filter(
        event_type=EventType.ACCESS_GRANTED, metadata__kind="demo_ticket"
    ).exists()
    assert AuditLog.objects.filter(action=AuditAction.DEMO_ACCESS_ISSUED).exists()

    demo_app = _service_client(as_user, admin_user, [world["pedidos"]])
    res = demo_app.post(REDEEM, {"token": raw}, format="json")
    assert res.status_code == 200, res.data
    assert res.data["valid"] is True
    assert res.data["user"]["email"] == "alice@acme.test"
    assert res.data["organization"] == "Acme"
    assert res.data["project"] == world["pedidos"].slug and res.data["environment"] == "DEMO"

    again = demo_app.post(REDEEM, {"token": raw}, format="json")
    assert again.status_code == 403 and again.data["valid"] is False


def test_demo_ticket_expires(as_user, admin_user, world):
    _, raw = _issue(as_user(world["alice"]), world["pedidos"])
    DemoAccessToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    demo_app = _service_client(as_user, admin_user, [world["pedidos"]])
    assert demo_app.post(REDEEM, {"token": raw}, format="json").status_code == 403


def test_demo_ticket_rejected_after_access_revoked(as_user, admin_user, world):
    _, raw = _issue(as_user(world["alice"]), world["pedidos"])
    ProjectAccess.objects.filter(project=world["pedidos"]).update(revoked_at=timezone.now())
    demo_app = _service_client(as_user, admin_user, [world["pedidos"]])
    res = demo_app.post(REDEEM, {"token": raw}, format="json")
    assert res.status_code == 403
    assert DemoAccessToken.objects.get().redeemed_at is None


def test_demo_ticket_requires_service_token_scoped_to_project(as_user, admin_user, world):
    _, raw = _issue(as_user(world["alice"]), world["pedidos"])
    wrong = _service_client(as_user, admin_user, [world["reservas"]])
    assert wrong.post(REDEEM, {"token": raw}, format="json").status_code == 403
    assert APIClient().post(REDEEM, {"token": raw}, format="json").status_code == 401
    # A logged-in DevHub session is NOT enough to redeem a ticket.
    assert as_user(admin_user).post(REDEEM, {"token": raw}, format="json").status_code == 401


def test_unknown_ticket_gets_generic_error(as_user, admin_user, world):
    demo_app = _service_client(as_user, admin_user, [world["pedidos"]])
    res = demo_app.post(REDEEM, {"token": "x" * 43}, format="json")
    assert res.status_code == 403 and res.data["code"] == "invalid_ticket"


def test_no_demo_when_environment_missing_or_inactive(as_user, world):
    client = as_user(world["bob"])  # Reservas has no demo environment
    res = client.post(f"{PORTAL}projects/{world['reservas'].id}/demo-access/")
    assert res.status_code == 400 and res.data["code"] == "demo_unavailable"
    world["demo"].status = "INACTIVE"
    world["demo"].save()
    res = as_user(world["alice"]).post(f"{PORTAL}projects/{world['pedidos'].id}/demo-access/")
    assert res.data["code"] == "demo_unavailable"
    assert (
        as_user(world["alice"]).get(f"{PORTAL}projects/{world['pedidos'].id}/").data["has_demo"]
        is False
    )


def test_demo_launch_response_not_cached(as_user, world):
    res = as_user(world["alice"]).post(f"{PORTAL}projects/{world['pedidos'].id}/demo-access/")
    assert res["Cache-Control"] == "no-store"


# --- public portfolio -----------------------------------------------------------------


def test_public_portfolio(api_client, make_project, settings):
    make_project(
        "Visible",
        visibility="PUBLIC",
        client_description="Pública",
        repository_url="https://github.com/x/privado",
    )
    make_project("Archivada", visibility="PUBLIC", status=ProjectStatus.ARCHIVED)
    make_project("Interna")
    res = api_client.get("/api/v1/public/portfolio/")
    assert res.status_code == 200
    assert [p["name"] for p in res.data] == ["Visible"]
    assert "repository_url" not in res.data[0] and "privado" not in str(res.data)
    settings.PUBLIC_PORTFOLIO_ENABLED = False
    assert api_client.get("/api/v1/public/portfolio/").status_code == 404
