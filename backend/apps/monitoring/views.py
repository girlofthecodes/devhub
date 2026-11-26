from datetime import timedelta

import django_filters
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.deployments.authentication import IsServiceToken, ServiceTokenAuthentication
from apps.infrastructure.models import Environment, EnvironmentStatus
from apps.projects import selectors as project_selectors
from common.permissions import IsStaffMember

from . import alerts, metrics, services
from .models import ACTIVE_ALERT_STATUSES, Alert, AlertStatus, HealthCheck, HealthStatus
from .serializers import (
    AlertSerializer,
    AlertSummarySerializer,
    CheckResultSerializer,
    HealthCheckSerializer,
    HealthCheckUpdateSerializer,
    HealthCheckWriteSerializer,
    MetricIngestSerializer,
    MetricSampleSerializer,
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


# --- internal metrics: per-project overview, history and statistics --------------------


class MetricsOverviewView(APIView):
    """All visible projects with availability, internal metrics and active alerts."""

    permission_classes = [IsStaffMember]

    @extend_schema(operation_id="monitoring_projects_list", responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(metrics.overview(project_selectors.projects_visible_to(request.user)))


class ProjectMetricsView(APIView):
    permission_classes = [IsStaffMember]

    @extend_schema(
        operation_id="monitoring_projects_retrieve",
        parameters=[
            OpenApiParameter("hours", int, description="Ventana (1–720 h). Por defecto 24."),
            OpenApiParameter("environment", str, description="Entorno (por defecto el principal)."),
        ],
        responses=OpenApiTypes.OBJECT,
    )
    def get(self, request, pk):
        project = project_selectors.projects_visible_to(request.user).active().filter(pk=pk).first()
        if project is None:
            raise NotFound("Proyecto no encontrado.")
        try:
            hours = int(request.query_params.get("hours", 24))
        except ValueError:
            hours = 24
        return Response(
            metrics.project_detail(
                project,
                environment_id=request.query_params.get("environment") or None,
                hours=hours,
            )
        )


# --- alerts ----------------------------------------------------------------------------


class AlertFilter(django_filters.FilterSet):
    project = django_filters.UUIDFilter(field_name="environment__project_id")
    status = django_filters.CharFilter(method="filter_status")

    class Meta:
        model = Alert
        fields = ["environment", "kind", "severity"]

    def filter_status(self, queryset, name, value):
        if value == "ACTIVE":
            return queryset.filter(status__in=ACTIVE_ALERT_STATUSES)
        return queryset.filter(status=value)


class AlertViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Alerts of visible projects. Editors of the project may acknowledge or resolve them."""

    serializer_class = AlertSerializer
    permission_classes = [IsStaffMember]
    filterset_class = AlertFilter
    search_fields = ["environment__project__name", "message"]
    ordering_fields = ["opened_at", "severity", "last_seen_at"]
    ordering = ["-opened_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Alert.objects.none()
        return Alert.objects.filter(
            environment__project__in=project_selectors.projects_visible_to(self.request.user)
        ).select_related("environment__project", "acknowledged_by", "resolved_by")

    def _edit(self, alert):
        if not project_selectors.can_edit_project(self.request.user, alert.environment.project):
            raise PermissionDenied("No tienes permiso para gestionar las alertas de este proyecto.")

    @extend_schema(request=None, responses=AlertSerializer)
    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        alert = self.get_object()
        self._edit(alert)
        alerts.acknowledge(alert, actor=request.user, request=request)
        return Response(self.get_serializer(self.get_queryset().get(pk=alert.pk)).data)

    @extend_schema(request=None, responses=AlertSerializer)
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        alert = self.get_object()
        self._edit(alert)
        alerts.resolve(alert, actor=request.user, request=request)
        return Response(self.get_serializer(self.get_queryset().get(pk=alert.pk)).data)

    @extend_schema(responses=AlertSummarySerializer)
    @action(detail=False, methods=["get"], filterset_class=None, pagination_class=None)
    def summary(self, request):
        qs = self.get_queryset()
        now = timezone.now()
        week = now - timedelta(days=7)
        durations = [
            (end - start).total_seconds()
            for start, end in qs.filter(
                status=AlertStatus.RESOLVED, resolved_at__gte=week
            ).values_list("opened_at", "resolved_at")
        ]
        mttr = round(sum(durations) / len(durations)) if durations else None
        return Response(
            {
                "open": qs.filter(status=AlertStatus.OPEN).count(),
                "acknowledged": qs.filter(status=AlertStatus.ACKNOWLEDGED).count(),
                "critical": qs.filter(
                    status__in=ACTIVE_ALERT_STATUSES, severity="CRITICAL"
                ).count(),
                "resolved_7d": len(durations),
                "opened_24h": qs.filter(opened_at__gte=now - timedelta(hours=24)).count(),
                "mttr_seconds_7d": mttr,
            }
        )


# --- integration: applications push their own metrics ----------------------------------


class IntegrationMetricsView(APIView):
    """POST a metrics sample. Service token, scoped to the token's projects."""

    authentication_classes = [ServiceTokenAuthentication]
    permission_classes = [IsServiceToken]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "metrics"

    @extend_schema(request=MetricIngestSerializer, responses={201: MetricSampleSerializer})
    def post(self, request):
        serializer = MetricIngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        project = request.auth.projects.filter(slug=data.pop("project")).first()
        if project is None:
            raise NotFound("Proyecto no encontrado o fuera del alcance del token.")
        environment = (
            Environment.objects.select_related("project")
            .filter(project=project, kind=data.pop("environment"))
            .first()
        )
        if environment is None:
            raise NotFound("El proyecto no tiene configurado ese entorno.")
        sample = metrics.ingest_sample(environment, data)
        return Response(MetricSampleSerializer(sample).data, status=status.HTTP_201_CREATED)
