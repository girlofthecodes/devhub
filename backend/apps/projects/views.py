import django_filters
from django.db.models import Count, F, Func, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from apps.users.roles import Role
from common.permissions import IsAdmin, IsStaffMember

from . import selectors, services
from .models import (
    Project,
    ProjectAccess,
    ProjectMember,
    ProjectStatus,
    ProjectVisibility,
    Release,
)
from .serializers import (
    LogoUploadSerializer,
    ProjectAccessSerializer,
    ProjectAccessUpdateSerializer,
    ProjectMemberSerializer,
    ProjectMemberUpdateSerializer,
    ProjectSerializer,
    ProjectWriteSerializer,
    ReleaseSerializer,
    ReleaseUpdateSerializer,
    ReleaseWriteSerializer,
    VisibilitySerializer,
)


class ProjectFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=ProjectStatus.choices)
    visibility = django_filters.ChoiceFilter(choices=ProjectVisibility.choices)
    archived = django_filters.BooleanFilter(method="filter_archived")
    technology = django_filters.CharFilter(method="filter_technology")
    organization = django_filters.UUIDFilter(method="filter_organization")
    member = django_filters.UUIDFilter(method="filter_member")

    class Meta:
        model = Project
        fields = ["status", "visibility", "owner"]

    def filter_archived(self, qs, name, value):
        return qs.filter(status=ProjectStatus.ARCHIVED) if value else qs.active()

    def filter_technology(self, qs, name, value):
        return qs.filter(technologies__contains=[value])

    def filter_organization(self, qs, name, value):
        grants = ProjectAccess.objects.current().filter(organization_id=value)
        return qs.filter(pk__in=grants.values("project_id"))

    def filter_member(self, qs, name, value):
        return qs.filter(Q(members__user_id=value) | Q(owner_id=value)).distinct()


def _annotated(qs):
    now = timezone.now()
    current_grant = Q(access_grants__revoked_at__isnull=True) & (
        Q(access_grants__expires_at__isnull=True) | Q(access_grants__expires_at__gt=now)
    )
    return qs.select_related("owner").annotate(
        member_count=Count("members", distinct=True),
        organization_count=Count("access_grants", filter=current_grant, distinct=True),
    )


class ProjectViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Projects. Admins see all; developers only those they own or are assigned to.

    Projects are never deleted: they are archived.
    """

    serializer_class = ProjectSerializer
    filterset_class = ProjectFilter
    search_fields = ["name", "slug", "description"]
    ordering_fields = ["name", "created_at", "updated_at", "status"]
    ordering = ["name"]
    admin_actions = {"create", "archive", "restore", "visibility"}

    def get_permissions(self):
        if self.action in self.admin_actions:
            return [IsAdmin()]
        return [IsStaffMember()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Project.objects.none()
        return _annotated(selectors.projects_visible_to(self.request.user))

    def _reload(self, project: Project) -> Response:
        fresh = self.get_queryset().get(pk=project.pk)
        return Response(self.get_serializer(fresh).data)

    def _require_edit(self, project: Project) -> None:
        if not selectors.can_edit_project(self.request.user, project):
            raise PermissionDenied("No tienes permiso para modificar este proyecto.")

    @extend_schema(request=ProjectWriteSerializer, responses={201: ProjectSerializer})
    def create(self, request, *args, **kwargs):
        serializer = ProjectWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = services.create_project(
            actor=request.user, request=request, **serializer.validated_data
        )
        response = self._reload(project)
        response.status_code = status.HTTP_201_CREATED
        return response

    @extend_schema(request=ProjectWriteSerializer, responses=ProjectSerializer)
    def update(self, request, *args, **kwargs):
        project = self.get_object()
        self._require_edit(project)
        serializer = ProjectWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_project(
            project,
            actor=request.user,
            data=dict(serializer.validated_data),
            is_admin=request.user.role == Role.ADMIN,
            request=request,
        )
        return self._reload(project)

    @extend_schema(request=None, responses=ProjectSerializer)
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        return self._reload(
            services.archive_project(self.get_object(), actor=request.user, request=request)
        )

    @extend_schema(request=None, responses=ProjectSerializer)
    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        return self._reload(
            services.restore_project(self.get_object(), actor=request.user, request=request)
        )

    @extend_schema(request=VisibilitySerializer, responses=ProjectSerializer)
    @action(detail=True, methods=["post"])
    def visibility(self, request, pk=None):
        serializer = VisibilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = services.set_visibility(
            self.get_object(),
            visibility=serializer.validated_data["visibility"],
            actor=request.user,
            request=request,
        )
        return self._reload(project)

    @extend_schema(
        methods=["POST"],
        request={"multipart/form-data": LogoUploadSerializer},
        responses=ProjectSerializer,
    )
    @extend_schema(methods=["DELETE"], request=None, responses=ProjectSerializer)
    @action(detail=True, methods=["post", "delete"], parser_classes=[MultiPartParser])
    def logo(self, request, pk=None):
        project = self.get_object()
        self._require_edit(project)
        file = None
        if request.method == "POST":
            serializer = LogoUploadSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            file = serializer.validated_data["logo"]
        services.set_logo(project, file=file, actor=request.user, request=request)
        return self._reload(project)

    @extend_schema(responses=serializers.ListSerializer(child=serializers.CharField()))
    @action(detail=False, methods=["get"], pagination_class=None, filterset_class=None)
    def technologies(self, request):
        values = (
            selectors.projects_visible_to(request.user)
            .annotate(tech=Func(F("technologies"), function="unnest"))
            .values_list("tech", flat=True)
            .distinct()
        )
        return Response(sorted(set(values), key=str.lower))


class ProjectMemberViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Developers assigned to projects. Staff can read (scoped); only admins can modify."""

    serializer_class = ProjectMemberSerializer
    filterset_fields = ["project", "user", "role"]
    ordering_fields = ["created_at", "user__email"]

    def get_permissions(self):
        if self.action in {"list", "retrieve"}:
            return [IsStaffMember()]
        return [IsAdmin()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ProjectMember.objects.none()
        visible = selectors.projects_visible_to(self.request.user)
        return (
            ProjectMember.objects.filter(project__in=visible)
            .select_related("project", "user")
            .prefetch_related("user__groups")
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        member = services.add_member(
            actor=request.user, request=request, **serializer.validated_data
        )
        return Response(ProjectMemberSerializer(member).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=ProjectMemberUpdateSerializer, responses=ProjectMemberSerializer)
    def update(self, request, *args, **kwargs):
        member = self.get_object()
        serializer = ProjectMemberUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        member = services.update_member_role(
            member, role=serializer.validated_data["role"], actor=request.user, request=request
        )
        return Response(ProjectMemberSerializer(member).data)

    def perform_destroy(self, instance):
        services.remove_member(instance, actor=self.request.user, request=self.request)


class ProjectAccessFilter(django_filters.FilterSet):
    state = django_filters.ChoiceFilter(
        choices=[("ACTIVE", "Activo"), ("EXPIRED", "Expirado"), ("REVOKED", "Revocado")],
        method="filter_state",
    )

    class Meta:
        model = ProjectAccess
        fields = ["project", "organization", "state"]

    def filter_state(self, qs, name, value):
        now = timezone.now()
        if value == "ACTIVE":
            return qs.current(now)
        if value == "EXPIRED":
            return qs.filter(revoked_at__isnull=True, expires_at__lte=now)
        return qs.filter(revoked_at__isnull=False)


class ProjectAccessViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Organization access to projects (administrators only). Grants are revoked, not deleted."""

    serializer_class = ProjectAccessSerializer
    permission_classes = [IsAdmin]
    filterset_class = ProjectAccessFilter
    search_fields = ["project__name", "organization__name", "notes"]
    ordering_fields = ["created_at", "expires_at"]

    def get_queryset(self):
        return ProjectAccess.objects.select_related(
            "project", "organization", "granted_by", "revoked_by"
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        grant = services.grant_access(
            actor=request.user, request=request, **serializer.validated_data
        )
        return Response(ProjectAccessSerializer(grant).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=ProjectAccessUpdateSerializer, responses=ProjectAccessSerializer)
    def update(self, request, *args, **kwargs):
        grant = self.get_object()
        serializer = ProjectAccessUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        grant = services.update_access(
            grant, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(ProjectAccessSerializer(grant).data)

    @extend_schema(request=None, responses=ProjectAccessSerializer)
    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        grant = services.revoke_access(self.get_object(), actor=request.user, request=request)
        return Response(ProjectAccessSerializer(grant).data)


class ReleaseViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Versions shared with clients. Staff read (scoped); editors of the project manage them.

    Releases are withdrawn, never deleted.
    """

    serializer_class = ReleaseSerializer
    permission_classes = [IsStaffMember]
    filterset_fields = ["project", "status"]
    search_fields = ["version", "title", "notes"]
    ordering_fields = ["published_at", "created_at", "version"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Release.objects.none()
        visible = selectors.projects_visible_to(self.request.user)
        return Release.objects.filter(project__in=visible).select_related(
            "project", "deployment__environment", "created_by"
        )

    def _require_edit(self, project) -> None:
        if not selectors.can_edit_project(self.request.user, project):
            raise PermissionDenied(
                "No tienes permiso para gestionar las versiones de este proyecto."
            )

    def _respond(self, release: Release, code=status.HTTP_200_OK) -> Response:
        fresh = self.get_queryset().get(pk=release.pk)
        return Response(self.get_serializer(fresh).data, status=code)

    @extend_schema(request=ReleaseWriteSerializer, responses={201: ReleaseSerializer})
    def create(self, request, *args, **kwargs):
        serializer = ReleaseWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        project = data.pop("project")
        if not selectors.projects_visible_to(request.user).filter(pk=project.pk).exists():
            raise serializers.ValidationError({"project": ["Proyecto no válido."]})
        self._require_edit(project)
        release = services.create_release(
            project=project, actor=request.user, request=request, **data
        )
        return self._respond(release, status.HTTP_201_CREATED)

    @extend_schema(request=ReleaseUpdateSerializer, responses=ReleaseSerializer)
    def update(self, request, *args, **kwargs):
        release = self.get_object()
        self._require_edit(release.project)
        serializer = ReleaseUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_release(
            release, actor=request.user, data=dict(serializer.validated_data), request=request
        )
        return self._respond(release)

    @extend_schema(request=None, responses=ReleaseSerializer)
    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        release = self.get_object()
        self._require_edit(release.project)
        return self._respond(services.publish_release(release, actor=request.user, request=request))

    @extend_schema(request=None, responses=ReleaseSerializer)
    @action(detail=True, methods=["post"])
    def withdraw(self, request, pk=None):
        release = self.get_object()
        self._require_edit(release.project)
        return self._respond(
            services.withdraw_release(release, actor=request.user, request=request)
        )
