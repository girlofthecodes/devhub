"""Production settings (Home Lab behind Cloudflare Tunnel + reverse proxy)."""

from django.core.exceptions import ImproperlyConfigured

from common.env import env_bool, env_int

from .base import *  # noqa: F403
from .base import MIDDLEWARE, SECRET_KEY, STORAGES

DEBUG = False

# Static files (Django admin, API docs) are served by WhiteNoise inside gunicorn.
MIDDLEWARE = [
    MIDDLEWARE[0],
    "whitenoise.middleware.WhiteNoiseMiddleware",
    *MIDDLEWARE[1:],
]
STORAGES = {
    **STORAGES,
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

if len(SECRET_KEY) < 50 or "change-me" in SECRET_KEY:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY is insecure for production.")

# TLS terminates at Cloudflare / the reverse proxy, which sets X-Forwarded-Proto.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", False)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = env_int("DJANGO_HSTS_SECONDS", 60 * 60 * 24 * 30)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_HSTS_INCLUDE_SUBDOMAINS", False)
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"
