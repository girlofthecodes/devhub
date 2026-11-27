"""Cabeceras de seguridad agregadas por VIGIA (agente de cabeceras).

- Permissions-Policy en todas las respuestas: desactiva cámara, micrófono, ubicación, etc.
- Content-Security-Policy estricta en las respuestas que NO son HTML (la API JSON):
  una API no necesita cargar scripts, estilos ni imágenes.

Las páginas HTML (admin de Django, documentación Swagger) se dejan sin CSP para no
romperlas: cuando quieras protegerlas, define una CSP a su medida.
"""

API_CSP = "default-src 'none'; frame-ancestors 'none'"
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"


class SecurityHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if "Permissions-Policy" not in response:
            response["Permissions-Policy"] = PERMISSIONS_POLICY
        content_type = response.get("Content-Type", "")
        if "text/html" not in content_type and "Content-Security-Policy" not in response:
            response["Content-Security-Policy"] = API_CSP
        return response
