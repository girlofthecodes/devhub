from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import (
    AlertViewSet,
    HealthCheckViewSet,
    IntegrationMetricsView,
    MetricsOverviewView,
    MonitoringSummaryView,
    ProjectMetricsView,
)

router = SimpleRouter()
router.register("health-checks", HealthCheckViewSet, basename="health-check")
router.register("alerts", AlertViewSet, basename="alert")

urlpatterns = [
    path("monitoring/summary/", MonitoringSummaryView.as_view(), name="monitoring-summary"),
    path("monitoring/projects/", MetricsOverviewView.as_view(), name="monitoring-projects"),
    path(
        "monitoring/projects/<uuid:pk>/",
        ProjectMetricsView.as_view(),
        name="monitoring-project-detail",
    ),
    path("integrations/metrics/", IntegrationMetricsView.as_view(), name="integration-metrics"),
    *router.urls,
]
