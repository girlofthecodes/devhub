from datetime import timedelta

import django_filters
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.infrastructure.models import Environment, EnvironmentKind
from apps.projects import selectors as project_selectors
from common.permissions import IsAdmin, IsStaffMember

from . import services
from .authentication import IsServiceToken, ServiceTokenAuthentication
from .models import Deployment, DeploymentSource, ServiceToken
from .serializers import (
    DeploymentCreateSerializer,
    DeploymentSerializer,
    DeploymentStatsSerializer,
    IntegrationDeploymentSerializer,
    ServiceTokenCreatedSerializer,
    ServiceTokenCreateSerializer,
    ServiceTokenSerializer,
    TransitionSerializer,
)


def visible_deployments(user):
    projects = project_selectors.projects_visible_to(user)
    return Deployment.objects.filter(environment__project__in=projects)


class DeploymentFilter(django_filters.FilterSet):
    project = django_filters.UUIDFilter(field_name="environment__project")
    kind = django_filters.ChoiceFilter(
        field_name="environment__kind", choices=EnvironmentKind.choices
    )
    created_from = django_filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_to = django_filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = Deployment
        fields = ["project", "environment", "kind", "status", "source", "ci_run_id"]


class DeploymentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """Deployment history. Records are never edited or deleted; status changes go through
    the `transition` action, which enforces the state machine."""

    serializer_class = DeploymentSerializer
    permission_classes = [IsStaffMember]
    filterset_class = DeploymentFilter
    search_fields = ["version", "commit_sha", "branch", "environment__project__name", "message"]
    ordering_fields = ["created_at", "started_at", "finished_at", "version"]
    ordering = ["-created_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Deployment.objects.none()
        return visible_deployments(self.request.user).select_related(
            "environment__project", "triggered_by"
        )

    def _require_edit(self, project) -> None:
        if not project_selectors.can_edit_project(self.request.user, project):
            raise PermissionDenied("No tienes permiso para registrar despliegues en este proyecto.")

    @extend_schema(request=DeploymentCreateSerializer, responses={201: DeploymentSerializer})
    def create(self, request, *args, **kwargs):
        serializer = DeploymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        environment = data.pop("environment")
        visible = project_selectors.projects_visible_to(request.user)
        if not visible.filter(pk=environment.project_id).exists():
            raise NotFound("Entorno no encontrado.")
        self._require_edit(environment.project)
        deployment = services.create_deployment(
            environment=environment,
            source=DeploymentSource.MANUAL,
            actor=request.user,
            request=request,
            **data,
        )
        return Response(
            self.get_serializer(self.get_queryset().get(pk=deployment.pk)).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(request=TransitionSerializer, responses=DeploymentSerializer)
    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        deployment = self.get_object()
        self._require_edit(deployment.environment.project)
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.transition_deployment(
            deployment, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=deployment.pk)).data)

    @extend_schema(
        parameters=[OpenApiParameter("days", int, description="Ventana en días (1–90).")],
        responses=DeploymentStatsSerializer,
    )
    @action(detail=False, methods=["get"], filterset_class=None, pagination_class=None)
    def stats(self, request):
        try:
            days = max(1, min(int(request.query_params.get("days", 14)), 90))
        except ValueError:
            days = 14
        today = timezone.localdate()
        start = today - timedelta(days=days - 1)
        qs = visible_deployments(request.user).filter(created_at__date__gte=start)
        project = request.query_params.get("project")
        if project:
            qs = qs.filter(environment__project_id=project)
        rows = (
            qs.order_by()
            .annotate(day=TruncDate("created_at"))
            .values("day", "status")
            .annotate(n=Count("id"))
        )
        buckets = {
            start + timedelta(days=i): {"SUCCESS": 0, "FAILED": 0, "CANCELLED": 0, "IN_PROGRESS": 0}
            for i in range(days)
        }
        totals = {"SUCCESS": 0, "FAILED": 0, "CANCELLED": 0, "IN_PROGRESS": 0}
        for row in rows:
            key = row["status"] if row["status"] in totals else "IN_PROGRESS"
            if row["day"] in buckets:
                buckets[row["day"]][key] += row["n"]
            totals[key] += row["n"]
        finished = totals["SUCCESS"] + totals["FAILED"]
        return Response(
            {
                "days": [{"date": day, **counts} for day, counts in buckets.items()],
                "totals": totals,
                "success_rate": round(totals["SUCCESS"] / finished, 4) if finished else None,
            }
        )


class ServiceTokenViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """CI/CD service tokens (administrators only). The secret is returned once on creation."""

    serializer_class = ServiceTokenSerializer
    permission_classes = [IsAdmin]
    ordering = ["-created_at"]

    def get_queryset(self):
        return ServiceToken.objects.select_related("created_by").prefetch_related("projects")

    @extend_schema(
        request=ServiceTokenCreateSerializer, responses={201: ServiceTokenCreatedSerializer}
    )
    def create(self, request, *args, **kwargs):
        serializer = ServiceTokenCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token, raw = services.create_service_token(
            actor=request.user, request=request, **serializer.validated_data
        )
        data = ServiceTokenCreatedSerializer(token, context={"raw_token": raw}).data
        response = Response(data, status=status.HTTP_201_CREATED)
        response["Cache-Control"] = "no-store"
        return response

    @extend_schema(request=None, responses=ServiceTokenSerializer)
    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        token = services.revoke_service_token(
            self.get_object(), actor=request.user, request=request
        )
        return Response(ServiceTokenSerializer(token).data)


# --- integration endpoints (service tokens only) --------------------------------------


class IntegrationView(APIView):
    authentication_classes = [ServiceTokenAuthentication]
    permission_classes = [IsServiceToken]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "integrations"


class IntegrationDeploymentCreateView(IntegrationView):
    """Register a deployment from CI/CD. Idempotent per (environment, ci_run_id)."""

    @extend_schema(
        request=IntegrationDeploymentSerializer,
        responses={201: DeploymentSerializer, 200: DeploymentSerializer},
    )
    def post(self, request):
        serializer = IntegrationDeploymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        project = request.auth.projects.filter(slug=data.pop("project")).first()
        if project is None:
            raise NotFound("Proyecto no encontrado o fuera del alcance del token.")
        environment = Environment.objects.filter(
            project=project, kind=data.pop("environment")
        ).first()
        if environment is None:
            raise NotFound("El proyecto no tiene configurado ese entorno.")
        if data.get("ci_run_id"):
            existing = Deployment.objects.filter(
                environment=environment, ci_run_id=data["ci_run_id"]
            ).first()
            if existing is not None:
                return Response(DeploymentSerializer(existing).data, status=status.HTTP_200_OK)
        label = data.pop("triggered_by", "") or request.user.email
        deployment = services.create_deployment(
            environment=environment, actor=None, actor_label=label, **data
        )
        return Response(DeploymentSerializer(deployment).data, status=status.HTTP_201_CREATED)


class IntegrationDeploymentStatusView(IntegrationView):
    @extend_schema(request=TransitionSerializer, responses=DeploymentSerializer)
    def post(self, request, pk):
        deployment = (
            Deployment.objects.select_related("environment__project")
            .filter(pk=pk, environment__project__in=request.auth.projects.all())
            .first()
        )
        if deployment is None:
            raise NotFound("Despliegue no encontrado o fuera del alcance del token.")
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Keep attributing the run to whoever triggered it (e.g. the GitHub actor).
        label = deployment.triggered_by_label or request.user.email
        deployment = services.transition_deployment(
            deployment, actor=None, actor_label=label, **serializer.validated_data
        )
        return Response(DeploymentSerializer(deployment).data)
