"""Read-side rules: which projects a user can see or edit. Single source of truth for scoping."""

from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.users.models import User
from apps.users.roles import Role

from .models import Project, ProjectAccess, ProjectMemberRole


def projects_visible_to(user: User) -> QuerySet[Project]:
    """Projects an internal user (admin/developer) may see in the admin panel."""
    if not user.is_authenticated or not user.is_active:
        return Project.objects.none()
    if user.role == Role.ADMIN:
        return Project.objects.all()
    if user.role == Role.DEVELOPER:
        return Project.objects.filter(Q(owner=user) | Q(members__user=user)).distinct()
    return Project.objects.none()


def projects_shared_with_client(user: User) -> QuerySet[Project]:
    """Projects a client may see through a current grant to an active organization they belong to.

    Archived projects are never exposed to clients.
    """
    if not user.is_authenticated or not user.is_active:
        return Project.objects.none()
    grants = ProjectAccess.objects.current(timezone.now()).filter(
        organization__is_active=True, organization__memberships__user=user
    )
    return Project.objects.active().filter(pk__in=grants.values("project_id")).distinct()


def can_edit_project(user: User, project: Project) -> bool:
    if user.role == Role.ADMIN:
        return True
    if user.role != Role.DEVELOPER:
        return False
    if project.owner_id == user.pk:
        return True
    return project.members.filter(user=user, role=ProjectMemberRole.MAINTAINER).exists()


def can_manage_project(user: User) -> bool:
    """Create/archive/publish, owner changes, members and organization access."""
    return user.role == Role.ADMIN
