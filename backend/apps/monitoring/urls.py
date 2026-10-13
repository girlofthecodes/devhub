from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import HealthCheckViewSet, MonitoringSummaryView

router = SimpleRouter()
router.register("health-checks", HealthCheckViewSet, basename="health-check")

urlpatterns = [
    path("monitoring/summary/", MonitoringSummaryView.as_view(), name="monitoring-summary"),
    *router.urls,
]
