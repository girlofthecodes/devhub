"""security.txt (RFC 9116) agregado por VIGIA.

Indica a investigadores de seguridad cómo reportarte una vulnerabilidad.
Para usar tu correo en lugar del contacto por defecto, define la variable de entorno
SECURITY_TXT_CONTACT, por ejemplo: mailto:seguridad@tudominio.com
"""
import os
from datetime import datetime, timedelta, timezone

from django.http import HttpResponse
from django.views.decorators.http import require_GET

DEFAULT_CONTACT = "https://github.com/girlofthecodes/devhub/security/advisories/new"
VALID_DAYS = 180  # el RFC recomienda que Expires sea menor a un año


@require_GET
def security_txt(request):
    contact = os.environ.get("SECURITY_TXT_CONTACT", "").strip() or DEFAULT_CONTACT
    expires = datetime.now(timezone.utc) + timedelta(days=VALID_DAYS)
    lines = [
        f"Contact: {contact}",
        f"Expires: {expires.strftime('%Y-%m-%dT%H:%M:%S.000Z')}",
        "Preferred-Languages: es, en",
        f"Canonical: {request.build_absolute_uri()}",
    ]
    return HttpResponse("\n".join(lines) + "\n", content_type="text/plain; charset=utf-8")
