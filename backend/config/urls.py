from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from common.views import HealthView, vigia_verify

api_v1 = [
    path("health/", HealthView.as_view(), name="health"),
    path("", include("apps.users.urls")),
    path("", include("apps.organizations.urls")),
    path("", include("apps.audit.urls")),
    path("", include("apps.projects.urls")),
    path("", include("apps.infrastructure.urls")),
    path("", include("apps.deployments.urls")),
    path("", include("apps.traceability.urls")),
    path("", include("apps.portal.urls")),
    path("", include("apps.monitoring.urls")),
    path("", include("apps.commercial.urls")),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

urlpatterns = [
    path(".well-known/vigia-verify.txt", vigia_verify, name="vigia-verify"),
    path("api/v1/", include(api_v1)),
]

if settings.DEBUG:
    # Development only. In production the reverse proxy serves MEDIA_ROOT (Fase 6).
    from django.conf.urls.static import static

    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

if getattr(settings, "DJANGO_ADMIN_ENABLED", True):
    urlpatterns.append(path("django-admin/", admin.site.urls))

# --- VIGIA: inicio (cambios automáticos; revísalos antes de hacer commit) ---
from django.urls import path as _vigia_path  # noqa: E402
from config.vigia_security_txt import security_txt as _vigia_security_txt  # noqa: E402
urlpatterns = [_vigia_path(".well-known/security.txt", _vigia_security_txt, name="security-txt"), *urlpatterns]
# --- VIGIA: fin ---
