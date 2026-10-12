from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import EnvironmentViewSet, InfrastructureSummaryView, ServerViewSet

router = SimpleRouter()
router.register("servers", ServerViewSet, basename="server")
router.register("environments", EnvironmentViewSet, basename="environment")

urlpatterns = [
    path(
        "infrastructure/summary/",
        InfrastructureSummaryView.as_view(),
        name="infrastructure-summary",
    ),
    *router.urls,
]
