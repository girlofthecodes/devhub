from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import (
    DeploymentViewSet,
    IntegrationDeploymentCreateView,
    IntegrationDeploymentStatusView,
    ServiceTokenViewSet,
)

router = SimpleRouter()
router.register("deployments", DeploymentViewSet, basename="deployment")
router.register("service-tokens", ServiceTokenViewSet, basename="service-token")

urlpatterns = [
    path(
        "integrations/deployments/",
        IntegrationDeploymentCreateView.as_view(),
        name="integration-deployment-create",
    ),
    path(
        "integrations/deployments/<uuid:pk>/status/",
        IntegrationDeploymentStatusView.as_view(),
        name="integration-deployment-status",
    ),
    *router.urls,
]
