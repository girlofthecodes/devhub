import django_filters
from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.projects import selectors as project_selectors
from common.permissions import IsAdmin, IsStaffMember

from . import services
from .models import (
    Environment,
    EnvironmentKind,
    EnvironmentStatus,
    Server,
    ServerStatus,
    ServerType,
)
from .serializers import (
    EnvironmentSerializer,
    EnvironmentUpdateSerializer,
    EnvironmentWriteSerializer,
    InfrastructureSummarySerializer,
    ServerSerializer,
    ServerWriteSerializer,
)


def visible_environments(user):
    visible_projects = project_selectors.projects_visible_to(user)
    return Environment.objects.filter(project__in=visible_projects)


class ServerViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Server inventory. Staff can read; only admins register or modify. No deletion."""

    serializer_class = ServerSerializer
    filterset_fields = ["status", "server_type"]
    search_fields = ["name", "identifier", "location", "operating_system"]
    ordering_fields = ["name", "identifier", "created_at", "status"]
    ordering = ["name"]

    def get_permissions(self):
        if self.action in {"list", "retrieve"}:
            return [IsStaffMember()]
        return [IsAdmin()]

    def get_queryset(self):
        return Server.objects.annotate(
            environment_count=Count("environments", distinct=True),
            active_environment_count=Count(
                "environments",
                filter=Q(environments__status=EnvironmentStatus.ACTIVE),
                distinct=True,
            ),
        )

    def _reload(self, server: Server, code=status.HTTP_200_OK) -> Response:
        return Response(
            self.get_serializer(self.get_queryset().get(pk=server.pk)).data, status=code
        )

    @extend_schema(request=ServerWriteSerializer, responses={201: ServerSerializer})
    def create(self, request, *args, **kwargs):
        serializer = ServerWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        server = services.create_server(
            actor=request.user, request=request, **serializer.validated_data
        )
        return self._reload(server, status.HTTP_201_CREATED)

    @extend_schema(request=ServerWriteSerializer, responses=ServerSerializer)
    def update(self, request, *args, **kwargs):
        server = self.get_object()
        serializer = ServerWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_server(
            server, actor=request.user, data=dict(serializer.validated_data), request=request
        )
        return self._reload(server)


class EnvironmentFilter(django_filters.FilterSet):
    class Meta:
        model = Environment
        fields = ["project", "server", "kind", "status"]


class EnvironmentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Project environments. Scoped to visible projects; editable by those who can edit
    the project. Environments are deactivated, never deleted."""

    serializer_class = EnvironmentSerializer
    permission_classes = [IsStaffMember]
    filterset_class = EnvironmentFilter
    search_fields = ["project__name", "name", "public_url", "deployed_version", "server__name"]
    ordering_fields = ["project__name", "kind", "updated_at", "status"]
    ordering = ["project__name", "kind"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Environment.objects.none()
        return visible_environments(self.request.user).select_related("project", "server")

    def _require_edit(self, project) -> None:
        if not project_selectors.can_edit_project(self.request.user, project):
            raise PermissionDenied(
                "No tienes permiso para gestionar los entornos de este proyecto."
            )

    @extend_schema(request=EnvironmentWriteSerializer, responses={201: EnvironmentSerializer})
    def create(self, request, *args, **kwargs):
        serializer = EnvironmentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = serializer.validated_data["project"]
        # Hide projects the user cannot see (IDOR) and block those they cannot edit.
        if not project_selectors.projects_visible_to(request.user).filter(pk=project.pk).exists():
            return Response(
                {
                    "code": "validation_error",
                    "detail": "Proyecto no válido.",
                    "fields": {"project": ["Proyecto no válido."]},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        self._require_edit(project)
        environment = services.create_environment(
            actor=request.user, request=request, **serializer.validated_data
        )
        return Response(self.get_serializer(environment).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=EnvironmentUpdateSerializer, responses=EnvironmentSerializer)
    def update(self, request, *args, **kwargs):
        environment = self.get_object()
        self._require_edit(environment.project)
        serializer = EnvironmentUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        environment = services.update_environment(
            environment, actor=request.user, data=dict(serializer.validated_data), request=request
        )
        return Response(self.get_serializer(environment).data)


def _counts(qs, field: str, choices) -> dict[str, int]:
    rows = dict(qs.order_by().values(field).annotate(n=Count("id")).values_list(field, "n"))
    return {value: rows.get(value, 0) for value, _ in choices}


class InfrastructureSummaryView(APIView):
    """Inventory summary for dashboards (environments scoped to visible projects)."""

    permission_classes = [IsStaffMember]

    @extend_schema(responses=InfrastructureSummarySerializer)
    def get(self, request):
        servers = Server.objects.all()
        environments = visible_environments(request.user)
        return Response(
            {
                "servers": {
                    "total": servers.count(),
                    "by_status": _counts(servers, "status", ServerStatus.choices),
                    "by_type": _counts(servers, "server_type", ServerType.choices),
                },
                "environments": {
                    "total": environments.count(),
                    "by_status": _counts(environments, "status", EnvironmentStatus.choices),
                    "by_kind": _counts(environments, "kind", EnvironmentKind.choices),
                    "without_server": environments.filter(server__isnull=True).count(),
                },
            }
        )
