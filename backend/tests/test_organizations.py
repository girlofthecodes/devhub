import pytest

from apps.audit.models import AuditAction, AuditLog
from apps.organizations.models import Membership
from apps.users.roles import Role

pytestmark = pytest.mark.django_db

ORGS = "/api/v1/organizations/"
MEMBERSHIPS = "/api/v1/memberships/"


def test_admin_creates_organization_with_generated_slug(as_user, admin_user):
    res = as_user(admin_user).post(ORGS, {"name": "Panadería Ñandú", "description": "Cliente"})
    assert res.status_code == 201, res.data
    assert res.data["slug"] == "panaderia-nandu"
    assert res.data["is_active"] is True
    assert AuditLog.objects.filter(action=AuditAction.ORGANIZATION_CREATED).exists()


def test_slug_collision_gets_suffix(as_user, admin_user, make_org):
    make_org("Acme", slug="acme-corp")
    client = as_user(admin_user)
    first = client.post(ORGS, {"name": "Acme Corp"})
    assert first.data["slug"] == "acme-corp-2"


def test_organization_name_is_unique_case_insensitive(as_user, admin_user, make_org):
    make_org("Acme")
    res = as_user(admin_user).post(ORGS, {"name": "ACME"})
    assert res.status_code == 400
    assert "name" in res.data["fields"]


def test_update_organization_records_changes(as_user, admin_user, make_org):
    org = make_org("Acme")
    res = as_user(admin_user).patch(f"{ORGS}{org.id}/", {"description": "Nueva"})
    assert res.status_code == 200
    assert res.data["description"] == "Nueva"
    log = AuditLog.objects.get(action=AuditAction.ORGANIZATION_UPDATED)
    assert log.changes == {"description": {"from": "", "to": "Nueva"}}


def test_deactivate_and_activate(as_user, admin_user, make_org):
    org = make_org("Acme")
    client = as_user(admin_user)
    assert client.post(f"{ORGS}{org.id}/deactivate/").data["is_active"] is False
    assert client.post(f"{ORGS}{org.id}/activate/").data["is_active"] is True


def test_organizations_cannot_be_deleted(as_user, admin_user, make_org):
    org = make_org("Acme")
    assert as_user(admin_user).delete(f"{ORGS}{org.id}/").status_code == 405


def test_filter_and_search(as_user, admin_user, make_org):
    make_org("Alpha")
    make_org("Beta", is_active=False)
    client = as_user(admin_user)
    assert client.get(ORGS, {"is_active": "false"}).data["count"] == 1
    assert client.get(ORGS, {"search": "alp"}).data["results"][0]["name"] == "Alpha"


# --- Isolation between organizations --------------------------------------------------


def test_client_only_sees_own_active_organizations(as_user, make_user, make_org):
    alice = make_user(Role.CLIENT)
    bob = make_user(Role.CLIENT)
    org_a = make_org("Alice Inc", members=(alice,))
    org_b = make_org("Bob Inc", members=(bob,))
    make_org("Alice Old", members=(alice,), is_active=False)

    client = as_user(alice)
    res = client.get(ORGS)
    assert [o["name"] for o in res.data["results"]] == ["Alice Inc"]
    assert client.get(f"{ORGS}{org_a.id}/").status_code == 200
    # IDOR: another organization's ID must look non-existent.
    assert client.get(f"{ORGS}{org_b.id}/").status_code == 404


def test_client_cannot_modify_own_organization(as_user, client_user, make_org):
    org = make_org("Mine", members=(client_user,))
    client = as_user(client_user)
    assert client.patch(f"{ORGS}{org.id}/", {"name": "Hacked"}).status_code == 403
    assert client.post(ORGS, {"name": "New"}).status_code == 403
    assert client.post(f"{ORGS}{org.id}/deactivate/").status_code == 403


@pytest.mark.parametrize("role", [Role.DEVELOPER, Role.CLIENT, Role.VISITOR])
def test_non_admin_cannot_manage_memberships(as_user, make_user, make_org, role):
    user = make_user(role)
    org = make_org("Acme", members=(user,))
    client = as_user(user)
    assert client.get(MEMBERSHIPS).status_code == 403
    res = client.post(MEMBERSHIPS, {"organization": str(org.id), "user": str(user.id)})
    assert res.status_code == 403


# --- Memberships ------------------------------------------------------------------------


def test_admin_adds_updates_and_removes_member(as_user, admin_user, client_user, make_org):
    org = make_org("Acme")
    client = as_user(admin_user)

    res = client.post(
        MEMBERSHIPS, {"organization": str(org.id), "user": str(client_user.id), "role": "OWNER"}
    )
    assert res.status_code == 201, res.data
    membership_id = res.data["id"]
    assert res.data["user_detail"]["email"] == client_user.email

    res = client.get(MEMBERSHIPS, {"organization": str(org.id)})
    assert res.data["count"] == 1

    res = client.patch(f"{MEMBERSHIPS}{membership_id}/", {"role": "MEMBER"})
    assert res.data["role"] == "MEMBER"

    assert client.delete(f"{MEMBERSHIPS}{membership_id}/").status_code == 204
    assert not Membership.objects.exists()
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {
        AuditAction.MEMBERSHIP_ADDED,
        AuditAction.MEMBERSHIP_UPDATED,
        AuditAction.MEMBERSHIP_REMOVED,
    } <= actions


def test_duplicate_membership_rejected(as_user, admin_user, client_user, make_org):
    org = make_org("Acme", members=(client_user,))
    res = as_user(admin_user).post(
        MEMBERSHIPS, {"organization": str(org.id), "user": str(client_user.id)}
    )
    assert res.status_code == 400
    assert res.data["code"] == "duplicate"


def test_inactive_user_cannot_be_added(as_user, admin_user, make_user, make_org):
    inactive = make_user(is_active=False)
    org = make_org("Acme")
    res = as_user(admin_user).post(
        MEMBERSHIPS, {"organization": str(org.id), "user": str(inactive.id)}
    )
    assert res.status_code == 400
    assert res.data["code"] == "inactive_user"


def test_visitor_cannot_be_member(as_user, admin_user, make_user, make_org):
    visitor = make_user(Role.VISITOR)
    org = make_org("Acme")
    res = as_user(admin_user).post(
        MEMBERSHIPS, {"organization": str(org.id), "user": str(visitor.id)}
    )
    assert res.status_code == 400


def test_member_count_annotation(as_user, admin_user, make_user, make_org):
    org = make_org("Acme", members=(make_user(), make_user()))
    res = as_user(admin_user).get(f"{ORGS}{org.id}/")
    assert res.data["member_count"] == 2


def test_users_filter_by_organization(as_user, admin_user, make_user, make_org):
    member = make_user()
    make_user()
    org = make_org("Acme", members=(member,))
    res = as_user(admin_user).get("/api/v1/users/", {"organization": str(org.id)})
    assert [u["email"] for u in res.data["results"]] == [member.email]
