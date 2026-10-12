# Protección de demostraciones con DevHub

Iniciar sesión en DevHub **no** concede acceso a la URL de una demo. Cada demostración debe validar el acceso por su cuenta, con una de estas dos opciones (o las dos combinadas, como defensa en profundidad):

## Opción A — Ticket de DevHub (incluida)

1. El cliente pulsa **Abrir demo** en el portal. DevHub comprueba que su organización tiene un acceso vigente al proyecto y redirige a la demo con `?devhub_demo_token=<ticket>`.
2. La demo canjea el ticket contra DevHub, servidor a servidor:

   ```http
   POST /api/v1/integrations/demo-access/redeem/
   Authorization: Bearer dhs_…            # token de servicio limitado al proyecto
   Content-Type: application/json

   {"token": "<ticket>"}
   ```

   - Respuesta `200`: `{valid: true, user, organization, project, environment, session_expires_at}`.
   - Respuesta `403`: `{valid: false, code: "invalid_ticket"}` si el ticket no existe, expiró, ya se usó, el acceso se revocó o el token de servicio no cubre ese proyecto. Todos los casos devuelven el mismo error para no dar pistas.
3. La demo abre su propia sesión, con una duración acotada.

`devhub_demo_guard.py` implementa este flujo como middleware WSGI (solo biblioteca estándar):

```python
from devhub_demo_guard import DemoGuard
application = DemoGuard(application)
```

Variables necesarias: `DEVHUB_URL`, `DEVHUB_TOKEN` (token de servicio del proyecto), `DEMO_SESSION_SECRET` (≥ 32 caracteres) y, opcionalmente, `DEVHUB_PORTAL_URL`. Para aplicaciones en otros lenguajes, basta con replicar la llamada al endpoint de canje.

Propiedades de seguridad del ticket:

- 256 bits aleatorios y de un solo uso. DevHub solo guarda su SHA-256.
- Expira en `DEMO_TOKEN_TTL_SECONDS` (300 s por defecto).
- La autorización se vuelve a comprobar **en el momento del canje**: si el acceso se revocó entre el clic y la apertura, el ticket ya no sirve.
- Tras el canje, el middleware quita el ticket de la URL (redirección 303 con `Referrer-Policy: no-referrer`) para que no quede en el historial ni en los encabezados `Referer`.

## Opción B — Cloudflare Access (recomendada además, en el borde)

Con Cloudflare Tunnel (Fase 6), crea en Zero Trust una *Application* de tipo self-hosted para el subdominio de la demo, con una política que permita solo los correos o dominios de la organización cliente (o un grupo de Access). Así, una petición sin identidad nunca llega al servidor.

> Este paso requiere una cuenta de Cloudflare con el dominio configurado; los detalles se documentan en la Fase 6.
