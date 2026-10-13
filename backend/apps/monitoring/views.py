from datetime import timedelta

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.infrastructure.models import Environment, EnvironmentStatus
from apps.projects import selectors as project_selectors
from common.permissions import IsStaffMember

from . import services
from .models import HealthCheck, HealthStatus
from .serializers import (
    CheckResultSerializer,
    HealthCheckSerializer,
    HealthCheckUpdateSerializer,
    HealthCheckWriteSerializer,
    MonitoringSummarySerializer,
)


def visible_checks(user):
    return HealthCheck.objects.filter(
        environment__project__in=project_selectors.projects_visible_to(user)
    ).select_related("environment__project", "environment__server")


class HealthCheckViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Health checks of environments (internal team only; scoped by project)."""

    serializer_class = HealthCheckSerializer
    permission_classes = [IsStaffMember]
    filterset_fields = ["environment", "status", "enabled"]
    search_fields = ["environment__project__name", "environment__public_url", "path"]
    ordering = ["environment__project__name", "environment__kind"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return HealthCheck.objects.none()
        qs = visible_checks(self.request.user)
        project = self.request.query_params.get("project")
        return qs.filter(environment__project_id=project) if project else qs

    def _require_edit(self, project):
        if not project_selectors.can_edit_project(self.request.user, project):
            raise PermissionDenied(
                "No tienes permiso para gestionar el monitoreo de este proyecto."
            )

    def _respond(self, check, code=status.HTTP_200_OK):
        return Response(self.get_serializer(self.get_queryset().get(pk=check.pk)).data, status=code)

    @extend_schema(request=HealthCheckWriteSerializer, responses={201: HealthCheckSerializer})
    def create(self, request, *args, **kwargs):
        serializer = HealthCheckWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        environment = data.pop("environment")
        if (
            not project_selectors.projects_visible_to(request.user)
            .filter(pk=environment.project_id)
            .exists()
        ):
            raise serializers.ValidationError({"environment": ["Entorno no válido."]})
        self._require_edit(environment.project)
        check = services.create_check(
            environment=environment, actor=request.user, request=request, **data
        )
        return self._respond(check, status.HTTP_201_CREATED)

    @extend_schema(request=HealthCheckUpdateSerializer, responses=HealthCheckSerializer)
    def update(self, request, *args, **kwargs):
        check = self.get_object()
        self._require_edit(check.environment.project)
        serializer = HealthCheckUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_check(
            check, actor=request.user, data=dict(serializer.validated_data), request=request
        )
        return self._respond(check)

    @extend_schema(request=None, responses=HealthCheckSerializer)
    @action(detail=True, methods=["post"])
    def run(self, request, pk=None):
        check = self.get_object()
        self._require_edit(check.environment.project)
        return self._respond(services.run_now(check))

    @extend_schema(
        parameters=[OpenApiParameter("hours", int, description="Ventana (1–168 h).")],
        responses=CheckResultSerializer(many=True),
    )
    @action(detail=True, methods=["get"], pagination_class=None)
    def results(self, request, pk=None):
        check = self.get_object()
        try:
            hours = max(1, min(int(request.query_params.get("hours", 24)), 168))
        except ValueError:
            hours = 24
        since = timezone.now() - timedelta(hours=hours)
        rows = check.results.filter(checked_at__gte=since).order_by("checked_at")[:2000]
        return Response(CheckResultSerializer(rows, many=True).data)


class MonitoringSummaryView(APIView):
    permission_classes = [IsStaffMember]

    @extend_schema(responses=MonitoringSummarySerializer)
    def get(self, request):
        checks = list(visible_checks(request.user))
        by_status = dict.fromkeys(HealthStatus.values, 0)
        for c in checks:
            by_status[c.effective_status] += 1
        environments = Environment.objects.filter(
            project__in=project_selectors.projects_visible_to(request.user),
            status=EnvironmentStatus.ACTIVE,
        ).exclude(public_url="")
        return Response(
            {
                "total": len(checks),
                "by_status": by_status,
                "stale": sum(1 for c in checks if c.enabled and c.is_stale),
                "environments_without_check": environments.filter(
                    health_check__isnull=True
                ).count(),
            }
        )
