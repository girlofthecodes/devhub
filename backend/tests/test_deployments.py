from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditAction, AuditLog
from apps.deployments.models import Deployment, ServiceToken
from apps.infrastructure.models import Environment
from apps.projects.models import ProjectMember, ProjectStatus
from apps.traceability.models import Event, EventType
from apps.users.roles import Role

pytestmark = pytest.mark.django_db

DEPLOYS = "/api/v1/deployments/"
TOKENS = "/api/v1/service-tokens/"
INTEGRATION = "/api/v1/integrations/deployments/"


@pytest.fixture
def env(make_project, developer):
    project = make_project("Pedidos", owner=developer, repository_url="https://github.com/acme/p")
    return Environment.objects.create(project=project, kind="PRODUCTION", deployed_version="v1.0.0")


def _deploy(client, env, **extra):
    return client.post(DEPLOYS, {"environment": str(env.id), "version": "v1.1.0", **extra})


# --- manual deployments & state machine ----------------------------------------------


def test_full_lifecycle_updates_version_and_emits_events(as_user, developer, env):
    client = as_user(developer)
    res = _deploy(client, env, commit_sha="ABCDEF1234567", branch="main")
    assert res.status_code == 201, res.data
    dep = res.data
    assert dep["status"] == "PENDING"
    assert dep["commit_sha"] == "abcdef1234567"
    assert dep["source"] == "MANUAL"
    assert dep["triggered_by_label"] == developer.email
    assert dep["correlation_id"].startswith("dep-")

    url = f"{DEPLOYS}{dep['id']}/transition/"
    res = client.post(url, {"status": "RUNNING"})
    assert res.data["status"] == "RUNNING" and res.data["started_at"]
    res = client.post(url, {"status": "SUCCESS", "message": "OK en 42s"})
    assert res.data["status"] == "SUCCESS"
    assert res.data["finished_at"] and res.data["duration_seconds"] is not None
    assert res.data["is_terminal"] is True

    env.refresh_from_db()
    assert env.deployed_version == "v1.1.0"
    events = list(
        Event.objects.filter(deployment_id=dep["id"])
        .order_by("occurred_at")
        .values_list("event_type", "correlation_id")
    )
    assert [e[0] for e in events] == [EventType.DEPLOYMENT_STARTED, EventType.DEPLOYMENT_SUCCESS]
    assert {e[1] for e in events} == {dep["correlation_id"]}
    success = Event.objects.get(deployment_id=dep["id"], event_type=EventType.DEPLOYMENT_SUCCESS)
    assert success.metadata["previous_version"] == "v1.0.0"
    assert success.metadata["message"] == "OK en 42s"
    assert AuditLog.objects.filter(action=AuditAction.DEPLOYMENT_STATUS_CHANGED).count() == 2


def test_terminal_states_are_final(as_user, developer, env):
    client = as_user(developer)
    dep = _deploy(client, env, status="FAILED", message="tests rojos").data
    assert dep["status"] == "FAILED"
    assert Event.objects.filter(deployment_id=dep["id"]).count() == 2  # STARTED + FAILED
    res = client.post(f"{DEPLOYS}{dep['id']}/transition/", {"status": "SUCCESS"})
    assert res.status_code == 400
    assert res.data["code"] == "invalid_transition"
    env.refresh_from_db()
    assert env.deployed_version == "v1.0.0"  # failed deploys do not change the version


def test_record_past_success_directly(as_user, developer, env):
    res = _deploy(as_user(developer), env, status="SUCCESS")
    assert res.data["status"] == "SUCCESS"
    env.refresh_from_db()
    assert env.deployed_version == "v1.1.0"


def test_pending_can_be_cancelled_without_start(as_user, developer, env):
    client = as_user(developer)
    dep = _deploy(client, env).data
    res = client.post(f"{DEPLOYS}{dep['id']}/transition/", {"status": "CANCELLED"})
    assert res.data["status"] == "CANCELLED"
    assert res.data["started_at"] is None
    assert Event.objects.get(deployment_id=dep["id"]).event_type == EventType.DEPLOYMENT_CANCELLED


def test_only_one_running_deployment_per_environment(as_user, developer, env):
    client = as_user(developer)
    _deploy(client, env, status="RUNNING")
    res = _deploy(client, env, status="RUNNING", version="v1.2.0")
    assert res.status_code == 400
    assert res.data["code"] == "deployment_in_progress"


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"version": "v1 beta;rm"}, "version"),
        ({"commit_sha": "xyz"}, "commit_sha"),
        ({"branch": "feat/`whoami`"}, "branch"),
        ({"ci_run_url": "http://ci.example.com/1"}, "ci_run_url"),
        ({"status": "CANCELLED"}, "status"),
    ],
)
def test_deployment_validation(as_user, developer, env, payload, field):
    res = _deploy(as_user(developer), env, **payload)
    assert res.status_code == 400
    assert field in res.data["fields"]


def test_inactive_environment_or_archived_project_rejected(as_user, admin_user, make_project):
    client = as_user(admin_user)
    inactive = Environment.objects.create(project=make_project(), kind="DEMO", status="INACTIVE")
    assert _deploy(client, inactive).data["code"] == "inactive_environment"
    archived_env = Environment.objects.create(
        project=make_project(status=ProjectStatus.ARCHIVED), kind="DEMO"
    )
    assert _deploy(client, archived_env).data["code"] == "archived"


def test_deployments_are_not_editable_or_deletable(as_user, admin_user, env):
    client = as_user(admin_user)
    dep = _deploy(client, env).data
    assert client.patch(f"{DEPLOYS}{dep['id']}/", {"version": "x"}).status_code == 405
    assert client.delete(f"{DEPLOYS}{dep['id']}/").status_code == 405


# --- scoping & permissions -----------------------------------------------------------


def test_developer_scope(as_user, developer, make_user, make_project, env):
    other_env = Environment.objects.create(project=make_project("Ajeno"), kind="DEMO")
    Deployment.objects.create(environment=other_env, version="v9")
    Deployment.objects.create(environment=env, version="v1")
    client = as_user(developer)
    res = client.get(DEPLOYS)
    assert [d["project_name"] for d in res.data["results"]] == ["Pedidos"]
    other = Deployment.objects.get(environment=other_env)
    assert client.get(f"{DEPLOYS}{other.id}/").status_code == 404
    assert _deploy(client, other_env).status_code == 404


def test_contributor_reads_but_cannot_deploy(as_user, make_user, env):
    contributor = make_user(Role.DEVELOPER)
    ProjectMember.objects.create(project=env.project, user=contributor, role="CONTRIBUTOR")
    dep = Deployment.objects.create(environment=env, version="v1")
    client = as_user(contributor)
    res = client.get(f"{DEPLOYS}{dep.id}/")
    assert res.status_code == 200 and res.data["can_manage"] is False
    assert _deploy(client, env).status_code == 403
    assert client.post(f"{DEPLOYS}{dep.id}/transition/", {"status": "RUNNING"}).status_code == 403


@pytest.mark.parametrize("role", [Role.CLIENT, Role.VISITOR])
def test_clients_have_no_access(as_user, make_user, role):
    client = as_user(make_user(role))
    assert client.get(DEPLOYS).status_code == 403
    assert client.get("/api/v1/events/").status_code == 403
    assert client.get(TOKENS).status_code == 403


def test_filters_and_stats(as_user, admin_user, env, make_project):
    client = as_user(admin_user)
    demo = Environment.objects.create(project=env.project, kind="DEMO")
    _deploy(client, env, status="SUCCESS", branch="main")
    _deploy(client, demo, status="FAILED", version="v2.0.0")
    _deploy(client, demo, version="v2.0.1")
    assert client.get(DEPLOYS, {"status": "FAILED"}).data["count"] == 1
    assert client.get(DEPLOYS, {"kind": "DEMO"}).data["count"] == 2
    assert client.get(DEPLOYS, {"project": str(env.project_id)}).data["count"] == 3
    assert client.get(DEPLOYS, {"search": "v2.0"}).data["count"] == 2
    stats = client.get(f"{DEPLOYS}stats/", {"days": 7}).data
    assert len(stats["days"]) == 7
    assert stats["totals"] == {"SUCCESS": 1, "FAILED": 1, "CANCELLED": 0, "IN_PROGRESS": 1}
    assert stats["success_rate"] == 0.5
    assert stats["days"][-1]["SUCCESS"] == 1


# --- service tokens & GitHub Actions integration -------------------------------------


def _create_token(client, projects, **extra):
    res = client.post(
        TOKENS, {"name": "GitHub Actions", "projects": [str(p.id) for p in projects], **extra}
    )
    assert res.status_code == 201, res.data
    return res


def _bearer(raw: str) -> APIClient:
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
    return c


def test_token_shown_once_and_only_hash_stored(as_user, admin_user, env):
    res = _create_token(as_user(admin_user), [env.project])
    raw = res.data["token"]
    assert raw.startswith("dhs_") and res["Cache-Control"] == "no-store"
    token = ServiceToken.objects.get()
    assert raw not in (token.token_hash, token.key_prefix)
    listed = as_user(admin_user).get(TOKENS).data["results"][0]
    assert "token" not in listed and "token_hash" not in listed
    log = AuditLog.objects.get(action=AuditAction.SERVICE_TOKEN_CREATED)
    assert raw not in str(log.changes)


def test_github_actions_flow(as_user, admin_user, env):
    raw = _create_token(as_user(admin_user), [env.project]).data["token"]
    ci = _bearer(raw)
    payload = {
        "project": env.project.slug,
        "environment": "PRODUCTION",
        "version": "v1.2.0",
        "commit_sha": "0123456789abcdef0123456789abcdef01234567",
        "branch": "main",
        "ci_run_id": "987654321",
        "ci_run_url": "https://github.com/acme/p/actions/runs/987654321",
        "triggered_by": "octocat",
    }
    res = ci.post(INTEGRATION, payload, format="json")
    assert res.status_code == 201, res.data
    dep = res.data
    assert dep["status"] == "RUNNING" and dep["source"] == "GITHUB_ACTIONS"
    assert dep["triggered_by_label"] == "octocat"

    # Idempotent re-run of the same workflow step.
    again = ci.post(INTEGRATION, payload, format="json")
    assert again.status_code == 200 and again.data["id"] == dep["id"]
    assert Deployment.objects.count() == 1

    res = ci.post(f"{INTEGRATION}{dep['id']}/status/", {"status": "SUCCESS"}, format="json")
    assert res.data["status"] == "SUCCESS"
    env.refresh_from_db()
    assert env.deployed_version == "v1.2.0"
    sources = set(Event.objects.filter(deployment_id=dep["id"]).values_list("source", flat=True))
    assert sources == {"GITHUB_ACTIONS"}
    actors = set(
        Event.objects.filter(deployment_id=dep["id"]).values_list("actor_label", flat=True)
    )
    assert actors == {"octocat"}  # status updates keep the original CI actor
    token = ServiceToken.objects.get()
    assert token.last_used_at is not None


def test_token_is_scoped_to_its_projects(as_user, admin_user, env, make_project):
    other = make_project("Otro")
    other_env = Environment.objects.create(project=other, kind="PRODUCTION")
    raw = _create_token(as_user(admin_user), [env.project]).data["token"]
    ci = _bearer(raw)
    res = ci.post(
        INTEGRATION,
        {"project": other.slug, "environment": "PRODUCTION", "version": "v1"},
        format="json",
    )
    assert res.status_code == 404
    foreign = Deployment.objects.create(environment=other_env, version="v1")
    res = ci.post(f"{INTEGRATION}{foreign.id}/status/", {"status": "RUNNING"}, format="json")
    assert res.status_code == 404
    res = ci.post(
        INTEGRATION,
        {"project": env.project.slug, "environment": "DEMO", "version": "v1"},
        format="json",
    )
    assert res.status_code == 404  # environment not configured


def test_token_cannot_access_regular_api(as_user, admin_user, env):
    raw = _create_token(as_user(admin_user), [env.project]).data["token"]
    ci = _bearer(raw)
    for path in ("/api/v1/projects/", DEPLOYS, "/api/v1/users/", "/api/v1/auth/me/", TOKENS):
        assert ci.get(path).status_code == 403, path


def test_invalid_revoked_and_expired_tokens(as_user, admin_user, env):
    client = as_user(admin_user)
    body = {"project": env.project.slug, "environment": "PRODUCTION", "version": "v1"}
    assert _bearer("dhs_nope_nope").post(INTEGRATION, body, format="json").status_code == 401
    assert APIClient().post(INTEGRATION, body, format="json").status_code == 401

    res = _create_token(client, [env.project])
    client.post(f"{TOKENS}{res.data['id']}/revoke/")
    assert _bearer(res.data["token"]).post(INTEGRATION, body, format="json").status_code == 401

    raw = _create_token(
        client, [env.project], expires_at=(timezone.now() + timedelta(days=1)).isoformat()
    ).data["token"]
    ServiceToken.objects.filter(key_prefix=raw.split("_")[1]).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    assert _bearer(raw).post(INTEGRATION, body, format="json").status_code == 401


def test_token_requires_projects_and_admin(as_user, admin_user, developer, env):
    res = as_user(admin_user).post(TOKENS, {"name": "x", "projects": []})
    assert res.status_code == 400
    res = as_user(developer).post(TOKENS, {"name": "x", "projects": [str(env.project_id)]})
    assert res.status_code == 403
