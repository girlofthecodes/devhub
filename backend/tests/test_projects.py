import io
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image

from apps.audit.models import AuditAction, AuditLog
from apps.projects import selectors
from apps.projects.models import ProjectAccess, ProjectMember, ProjectStatus
from apps.users.roles import Role

pytestmark = pytest.mark.django_db

PROJECTS = "/api/v1/projects/"
MEMBERS = "/api/v1/project-members/"
ACCESS = "/api/v1/project-access/"


def _png(size=(64, 64), fmt="PNG") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (79, 70, 229)).save(buf, format=fmt)
    return buf.getvalue()


# --- creation & validation ----------------------------------------------------------------


def test_admin_creates_project(as_user, admin_user, developer):
    res = as_user(admin_user).post(
        PROJECTS,
        {
            "name": "Portal Ventas",
            "description": "App de ventas",
            "repository_url": "https://github.com/acme/ventas",
            "site_url": "https://ventas.example.com",
            "technologies": ["React", " Django ", "react", "PostgreSQL"],
            "owner": str(developer.id),
            "status": "DEVELOPMENT",
        },
    )
    assert res.status_code == 201, res.data
    assert res.data["slug"] == "portal-ventas"
    assert res.data["site_url"] == "https://ventas.example.com"
    assert res.data["technologies"] == ["React", "Django", "PostgreSQL"]
    assert res.data["owner"]["email"] == developer.email
    assert res.data["visibility"] == "INTERNAL"
    assert res.data["permissions"] == {"can_edit": True, "can_manage": True}
    assert AuditLog.objects.filter(action=AuditAction.PROJECT_CREATED).exists()


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"repository_url": "http://insecure.example.com"}, "repository_url"),
        ({"documentation_url": "javascript:alert(1)"}, "documentation_url"),
        ({"site_url": "http://sitio-sin-tls.example.com"}, "site_url"),
        ({"technologies": ["<script>"]}, "technologies"),
        ({"status": "ARCHIVED"}, "status"),
        ({"name": "x"}, "name"),
    ],
)
def test_create_validation(as_user, admin_user, payload, field):
    data = {"name": "Valido", "owner": str(admin_user.id), **payload}
    res = as_user(admin_user).post(PROJECTS, data)
    assert res.status_code == 400
    assert field in res.data["fields"]


def test_owner_must_be_staff(as_user, admin_user, client_user):
    res = as_user(admin_user).post(PROJECTS, {"name": "App", "owner": str(client_user.id)})
    assert res.status_code == 400
    assert res.data["code"] == "invalid_role"


def test_name_unique_case_insensitive(as_user, admin_user, make_project):
    make_project("Inventario")
    res = as_user(admin_user).post(PROJECTS, {"name": "INVENTARIO", "owner": str(admin_user.id)})
    assert res.status_code == 400
    assert "name" in res.data["fields"]


def test_projects_cannot_be_deleted(as_user, admin_user, make_project):
    project = make_project()
    assert as_user(admin_user).delete(f"{PROJECTS}{project.id}/").status_code == 405


# --- scoping & permissions ----------------------------------------------------------------


def test_developer_sees_only_owned_or_assigned(as_user, developer, make_user, make_project):
    owned = make_project("Propio", owner=developer)
    assigned = make_project("Asignado")
    ProjectMember.objects.create(project=assigned, user=developer)
    other = make_project("Ajeno")

    client = as_user(developer)
    names = [p["name"] for p in client.get(PROJECTS).data["results"]]
    assert names == ["Asignado", "Propio"]
    assert client.get(f"{PROJECTS}{owned.id}/").status_code == 200
    assert client.get(f"{PROJECTS}{other.id}/").status_code == 404  # IDOR


@pytest.mark.parametrize("role", [Role.CLIENT, Role.VISITOR])
def test_clients_have_no_access_to_admin_projects_api(as_user, make_user, make_project, role):
    make_project()
    client = as_user(make_user(role))
    assert client.get(PROJECTS).status_code == 403
    assert client.get(MEMBERS).status_code == 403
    assert client.get(ACCESS).status_code == 403


def test_developer_cannot_create_or_manage(as_user, developer, make_project):
    project = make_project(owner=developer)
    client = as_user(developer)
    assert client.post(PROJECTS, {"name": "X", "owner": str(developer.id)}).status_code == 403
    assert client.post(f"{PROJECTS}{project.id}/archive/").status_code == 403
    res = client.post(f"{PROJECTS}{project.id}/visibility/", {"visibility": "PUBLIC"})
    assert res.status_code == 403
    res = client.post(MEMBERS, {"project": str(project.id), "user": str(developer.id)})
    assert res.status_code == 403


def test_owner_developer_edits_technical_fields_only(as_user, developer, make_user, make_project):
    project = make_project("Mio", owner=developer)
    client = as_user(developer)
    res = client.patch(
        f"{PROJECTS}{project.id}/",
        {"description": "Nueva", "status": "TESTING", "site_url": "https://mio.example.com"},
    )
    assert res.status_code == 200, res.data
    assert res.data["status"] == "TESTING"
    assert res.data["site_url"] == "https://mio.example.com"
    # Sending an unchanged admin-only field is fine; changing it is not.
    assert client.patch(f"{PROJECTS}{project.id}/", {"name": "Mio"}).status_code == 200
    res = client.patch(f"{PROJECTS}{project.id}/", {"name": "Otro nombre"})
    assert res.status_code == 400
    assert res.data["code"] == "permission_denied"
    res = client.patch(f"{PROJECTS}{project.id}/", {"owner": str(make_user(Role.ADMIN).id)})
    assert res.data["code"] == "permission_denied"


def test_contributor_cannot_edit_but_maintainer_can(as_user, developer, make_project):
    project = make_project()
    member = ProjectMember.objects.create(project=project, user=developer, role="CONTRIBUTOR")
    client = as_user(developer)
    res = client.get(f"{PROJECTS}{project.id}/")
    assert res.data["permissions"] == {"can_edit": False, "can_manage": False}
    assert client.patch(f"{PROJECTS}{project.id}/", {"description": "x"}).status_code == 403

    member.role = "MAINTAINER"
    member.save()
    assert client.patch(f"{PROJECTS}{project.id}/", {"description": "x"}).status_code == 200


# --- filters, search, pagination --------------------------------------------------------


def test_filters_search_and_pagination(as_user, admin_user, make_project, make_org):
    for i in range(23):
        make_project(f"App {i:02d}", technologies=["React"] if i % 2 else ["Vue"])
    archived = make_project("Legado", status=ProjectStatus.ARCHIVED)
    org = make_org("Acme")
    ProjectAccess.objects.create(project=archived, organization=org)
    client = as_user(admin_user)

    res = client.get(PROJECTS)
    assert res.data["count"] == 24
    assert len(res.data["results"]) == 20
    assert client.get(PROJECTS, {"archived": "false"}).data["count"] == 23
    assert [p["name"] for p in client.get(PROJECTS, {"archived": "true"}).data["results"]] == [
        "Legado"
    ]
    assert client.get(PROJECTS, {"technology": "React"}).data["count"] == 11
    # Terms are AND-ed: "app" and "1" -> App 01, App 10..19, App 21.
    assert client.get(PROJECTS, {"search": "app 1"}).data["count"] == 12
    assert client.get(PROJECTS, {"search": "legado"}).data["count"] == 1
    assert client.get(PROJECTS, {"organization": str(org.id)}).data["count"] == 1
    assert client.get(PROJECTS, {"status": "PLANNING", "page_size": 5}).data["count"] == 23
    techs = client.get(f"{PROJECTS}technologies/").data
    assert techs == ["React", "Vue"]


def test_member_and_org_counts(as_user, admin_user, developer, make_project, make_org):
    project = make_project()
    ProjectMember.objects.create(project=project, user=developer)
    ProjectAccess.objects.create(project=project, organization=make_org("A"))
    ProjectAccess.objects.create(
        project=project, organization=make_org("B"), revoked_at=timezone.now()
    )
    res = as_user(admin_user).get(f"{PROJECTS}{project.id}/")
    assert res.data["member_count"] == 1
    assert res.data["organization_count"] == 1


# --- archive / restore / visibility -------------------------------------------------------


def test_archive_preserves_history_and_blocks_edits(as_user, admin_user, make_project):
    project = make_project(status=ProjectStatus.AVAILABLE)
    client = as_user(admin_user)
    res = client.post(f"{PROJECTS}{project.id}/archive/")
    assert res.data["status"] == "ARCHIVED"
    assert res.data["archived_at"]
    assert res.data["permissions"]["can_edit"] is False

    res = client.patch(f"{PROJECTS}{project.id}/", {"description": "x"})
    assert res.status_code == 400
    assert res.data["code"] == "archived"

    res = client.post(f"{PROJECTS}{project.id}/restore/")
    assert res.data["status"] == "AVAILABLE"
    assert res.data["archived_at"] is None
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {AuditAction.PROJECT_ARCHIVED, AuditAction.PROJECT_RESTORED} <= actions


def test_publish_and_unpublish(as_user, admin_user, make_project):
    project = make_project()
    client = as_user(admin_user)
    url = f"{PROJECTS}{project.id}/visibility/"
    assert client.post(url, {"visibility": "PUBLIC"}).data["visibility"] == "PUBLIC"
    assert client.post(url, {"visibility": "INTERNAL"}).data["visibility"] == "INTERNAL"
    assert client.post(url, {"visibility": "WORLD"}).status_code == 400


def test_archived_project_cannot_be_published(as_user, admin_user, make_project):
    project = make_project(status=ProjectStatus.ARCHIVED)
    res = as_user(admin_user).post(f"{PROJECTS}{project.id}/visibility/", {"visibility": "PUBLIC"})
    assert res.status_code == 400


# --- logo ---------------------------------------------------------------------------------


def test_logo_upload_and_delete(as_user, admin_user, make_project):
    project = make_project()
    client = as_user(admin_user)
    upload = SimpleUploadedFile("evil name.php.png", _png(), content_type="image/png")
    res = client.post(f"{PROJECTS}{project.id}/logo/", {"logo": upload}, format="multipart")
    assert res.status_code == 200, res.data
    url = res.data["logo_url"]
    assert url.startswith(f"/media/projects/logos/{project.id}/")
    assert url.endswith(".png") and "evil" not in url

    res = client.delete(f"{PROJECTS}{project.id}/logo/")
    assert res.data["logo_url"] is None


@pytest.mark.parametrize(
    ("content", "name"),
    [
        (b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "x.svg"),
        (b"not an image at all", "x.png"),
    ],
)
def test_logo_rejects_invalid_files(as_user, admin_user, make_project, content, name):
    project = make_project()
    res = as_user(admin_user).post(
        f"{PROJECTS}{project.id}/logo/",
        {"logo": SimpleUploadedFile(name, content)},
        format="multipart",
    )
    assert res.status_code == 400
    assert "logo" in res.data["fields"]


def test_logo_rejects_unsupported_format_and_size(as_user, admin_user, make_project):
    project = make_project()
    client = as_user(admin_user)
    gif = SimpleUploadedFile("a.gif", _png(fmt="GIF"))
    res = client.post(f"{PROJECTS}{project.id}/logo/", {"logo": gif}, format="multipart")
    assert res.status_code == 400
    huge = SimpleUploadedFile("big.png", _png(size=(3000, 10)))
    res = client.post(f"{PROJECTS}{project.id}/logo/", {"logo": huge}, format="multipart")
    assert res.status_code == 400


# --- members ------------------------------------------------------------------------------


def test_assign_update_and_remove_developer(as_user, admin_user, developer, make_project):
    project = make_project()
    client = as_user(admin_user)
    res = client.post(
        MEMBERS, {"project": str(project.id), "user": str(developer.id), "role": "MAINTAINER"}
    )
    assert res.status_code == 201, res.data
    member_id = res.data["id"]
    assert (
        client.post(MEMBERS, {"project": str(project.id), "user": str(developer.id)}).data["code"]
        == "duplicate"
    )
    assert client.patch(f"{MEMBERS}{member_id}/", {"role": "CONTRIBUTOR"}).data["role"] == (
        "CONTRIBUTOR"
    )
    assert client.delete(f"{MEMBERS}{member_id}/").status_code == 204
    assert not ProjectMember.objects.exists()


def test_cannot_assign_client_or_inactive(
    as_user, admin_user, client_user, make_user, make_project
):
    project = make_project()
    client = as_user(admin_user)
    res = client.post(MEMBERS, {"project": str(project.id), "user": str(client_user.id)})
    assert res.data["code"] == "invalid_role"
    inactive = make_user(Role.DEVELOPER, is_active=False)
    res = client.post(MEMBERS, {"project": str(project.id), "user": str(inactive.id)})
    assert res.data["code"] == "inactive_user"


def test_developer_reads_members_only_of_visible_projects(
    as_user, developer, make_user, make_project
):
    mine = make_project(owner=developer)
    other = make_project()
    ProjectMember.objects.create(project=mine, user=make_user(Role.DEVELOPER))
    ProjectMember.objects.create(project=other, user=make_user(Role.DEVELOPER))
    res = as_user(developer).get(MEMBERS)
    assert res.status_code == 200
    assert [m["project"] for m in res.data["results"]] == [mine.id]


# --- organization access ------------------------------------------------------------------


def test_grant_and_revoke_access_keeps_history(as_user, admin_user, make_project, make_org):
    project = make_project()
    org = make_org("Acme")
    client = as_user(admin_user)
    expires = (timezone.now() + timedelta(days=30)).isoformat()
    res = client.post(
        ACCESS,
        {"project": str(project.id), "organization": str(org.id), "expires_at": expires},
    )
    assert res.status_code == 201, res.data
    assert res.data["state"] == "ACTIVE"
    grant_id = res.data["id"]

    dup = client.post(ACCESS, {"project": str(project.id), "organization": str(org.id)})
    assert dup.data["code"] == "duplicate"

    res = client.post(f"{ACCESS}{grant_id}/revoke/")
    assert res.data["state"] == "REVOKED"
    assert res.data["revoked_by_email"] == admin_user.email

    # Re-granting creates a new record; history is preserved.
    res = client.post(ACCESS, {"project": str(project.id), "organization": str(org.id)})
    assert res.status_code == 201
    assert ProjectAccess.objects.filter(project=project, organization=org).count() == 2
    assert client.get(ACCESS, {"state": "REVOKED"}).data["count"] == 1
    actions = list(AuditLog.objects.values_list("action", flat=True))
    assert actions.count(AuditAction.ACCESS_GRANTED) == 2
    assert AuditAction.ACCESS_REVOKED in actions


def test_access_validation_rules(as_user, admin_user, make_project, make_org):
    client = as_user(admin_user)
    org = make_org("Acme")
    past = (timezone.now() - timedelta(days=1)).isoformat()
    project = make_project()
    res = client.post(
        ACCESS, {"project": str(project.id), "organization": str(org.id), "expires_at": past}
    )
    assert "expires_at" in res.data["fields"]

    inactive_org = make_org("Cerrada", is_active=False)
    res = client.post(ACCESS, {"project": str(project.id), "organization": str(inactive_org.id)})
    assert res.data["code"] == "inactive_organization"

    archived = make_project(status=ProjectStatus.ARCHIVED)
    res = client.post(ACCESS, {"project": str(archived.id), "organization": str(org.id)})
    assert res.data["code"] == "archived"


def test_expired_grant_can_be_renewed(as_user, admin_user, make_project, make_org):
    project, org = make_project(), make_org("Acme")
    ProjectAccess.objects.create(
        project=project, organization=org, expires_at=timezone.now() - timedelta(hours=1)
    )
    res = as_user(admin_user).post(
        ACCESS, {"project": str(project.id), "organization": str(org.id)}
    )
    assert res.status_code == 201, res.data
    assert ProjectAccess.objects.current().count() == 1


def test_update_access_expiration(as_user, admin_user, make_project, make_org):
    grant = ProjectAccess.objects.create(project=make_project(), organization=make_org("Acme"))
    future = (timezone.now() + timedelta(days=7)).isoformat()
    res = as_user(admin_user).patch(f"{ACCESS}{grant.id}/", {"expires_at": future, "notes": "Demo"})
    assert res.status_code == 200
    assert res.data["notes"] == "Demo"


# --- client visibility rule (used by the portal in Fase 5) --------------------------------


def test_projects_shared_with_client_isolation(make_user, make_org, make_project):
    alice, bob = make_user(Role.CLIENT), make_user(Role.CLIENT)
    org_a = make_org("Alice Inc", members=(alice,))
    org_b = make_org("Bob Inc", members=(bob,))
    inactive_org = make_org("Old", members=(alice,), is_active=False)

    shared = make_project("Compartido")
    expired = make_project("Expirado")
    revoked = make_project("Revocado")
    archived = make_project("Archivado", status=ProjectStatus.ARCHIVED)
    via_inactive = make_project("Via inactiva")
    bobs = make_project("De Bob")

    ProjectAccess.objects.create(project=shared, organization=org_a)
    ProjectAccess.objects.create(
        project=expired, organization=org_a, expires_at=timezone.now() - timedelta(minutes=1)
    )
    ProjectAccess.objects.create(project=revoked, organization=org_a, revoked_at=timezone.now())
    ProjectAccess.objects.create(project=archived, organization=org_a)
    ProjectAccess.objects.create(project=via_inactive, organization=inactive_org)
    ProjectAccess.objects.create(project=bobs, organization=org_b)

    assert [p.name for p in selectors.projects_shared_with_client(alice)] == ["Compartido"]
    assert [p.name for p in selectors.projects_shared_with_client(bob)] == ["De Bob"]


def test_users_filter_by_multiple_roles(as_user, admin_user, developer, client_user):
    res = as_user(admin_user).get("/api/v1/users/", {"roles": "ADMIN,DEVELOPER"})
    assert {u["email"] for u in res.data["results"]} == {admin_user.email, developer.email}
