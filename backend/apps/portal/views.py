from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.deployments.authentication import IsServiceToken, ServiceTokenAuthentication
from apps.projects.models import Project, ProjectVisibility, Release, ReleaseStatus
from apps.users.roles import Role
from common.exceptions import DomainError

from . import services
from .serializers import (
    DemoLaunchSerializer,
    DemoRedeemRequestSerializer,
    DemoRedeemResponseSerializer,
    PortalProjectDetailSerializer,
    PortalProjectSerializer,
    PortalReleaseSerializer,
    PortalSummarySerializer,
    PublicProjectSerializer,
)


class IsClient(BasePermission):
    message = "El portal de clientes es solo para cuentas de cliente."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_active and user.role == Role.CLIENT)


class PortalView(APIView):
    permission_classes = [IsClient]

    def project_or_404(self, pk) -> Project:
        project = services.client_projects(self.request.user).filter(pk=pk).first()
        if project is None:
            raise NotFound("Aplicación no encontrada.")
        return project


class PortalSummaryView(PortalView):
    @extend_schema(responses=PortalSummarySerializer)
    def get(self, request):
        projects = services.client_projects(request.user)
        releases = (
            Release.objects.filter(project__in=projects, status=ReleaseStatus.PUBLISHED)
            .select_related("project")
            .order_by("-published_at")[:5]
        )
        organizations = sorted(
            {
                m.organization.name
                for m in request.user.memberships.select_related("organization")
                if m.organization.is_active
            }
        )
        return Response(
            {
                "applications": projects.count(),
                "demos": projects.filter(has_demo=True).count(),
                "organizations": organizations,
                "recent_releases": PortalReleaseSerializer(releases, many=True).data,
            }
        )


class PortalProjectListView(ListAPIView):
    permission_classes = [IsClient]
    serializer_class = PortalProjectSerializer
    search_fields = ["name", "client_description", "technologies"]
    filterset_fields: list[str] = []
    ordering_fields = ["name"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Project.objects.none()
        qs = services.client_projects(self.request.user)
        if self.request.query_params.get("has_demo") == "true":
            qs = qs.filter(has_demo=True)
        return qs


class PortalProjectDetailView(PortalView):
    @extend_schema(responses=PortalProjectDetailSerializer)
    def get(self, request, pk):
        project = self.project_or_404(pk)
        grants = services.access_for(request.user, project)
        return Response(PortalProjectDetailSerializer(project, context={"grants": grants}).data)


class PortalReleaseListView(PortalView):
    @extend_schema(responses=PortalReleaseSerializer(many=True))
    def get(self, request, pk):
        project = self.project_or_404(pk)
        releases = services.published_releases(project).select_related("project")
        return Response(PortalReleaseSerializer(releases, many=True).data)


class PortalDemoAccessView(PortalView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "demo_access"

    @extend_schema(request=None, responses=DemoLaunchSerializer)
    def post(self, request, pk):
        project = self.project_or_404(pk)
        launch_url, token = services.issue_demo_access(
            user=request.user, project=project, request=request
        )
        response = Response({"launch_url": launch_url, "expires_at": token.expires_at})
        response["Cache-Control"] = "no-store"
        return response


class DemoRedeemView(APIView):
    """Called server-to-server by a demo application to validate a client's ticket."""

    authentication_classes = [ServiceTokenAuthentication]
    permission_classes = [IsServiceToken]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "integrations"

    @extend_schema(request=DemoRedeemRequestSerializer, responses=DemoRedeemResponseSerializer)
    def post(self, request):
        serializer = DemoRedeemRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            token = services.redeem_demo_access(
                raw=serializer.validated_data["token"], service_token=request.auth
            )
        except DomainError as exc:
            return Response(
                {"valid": False, "code": exc.code, "detail": exc.message},
                status=status.HTTP_403_FORBIDDEN,
            )
        return Response(
            {
                "valid": True,
                "user": {"email": token.user.email, "full_name": token.user.full_name},
                "organization": token.organization.name if token.organization else None,
                "project": token.environment.project.slug,
                "environment": token.environment.kind,
                "session_expires_at": token.session_expires_at,
            }
        )


class PublicPortfolioView(ListAPIView):
    """Public portfolio (visitors and anonymous users), if enabled."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    serializer_class = PublicProjectSerializer
    pagination_class = None
    filter_backends: list = []

    def get_queryset(self):
        if not settings.PUBLIC_PORTFOLIO_ENABLED:
            raise NotFound("El portafolio público no está habilitado.")
        return Project.objects.active().filter(visibility=ProjectVisibility.PUBLIC).order_by("name")
