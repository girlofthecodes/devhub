from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from common.views import HealthView

api_v1 = [
    path("health/", HealthView.as_view(), name="health"),
    path("", include("apps.users.urls")),
    path("", include("apps.organizations.urls")),
    path("", include("apps.audit.urls")),
    path("", include("apps.projects.urls")),
    path("", include("apps.infrastructure.urls")),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

urlpatterns = [
    path("api/v1/", include(api_v1)),
]

if settings.DEBUG:
    # Development only. In production the reverse proxy serves MEDIA_ROOT (Fase 6).
    from django.conf.urls.static import static

    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

if getattr(settings, "DJANGO_ADMIN_ENABLED", True):
    urlpatterns.append(path("django-admin/", admin.site.urls))
