# Fase 5 — Portal de clientes

## Responsabilidad

Es un portal independiente (`/portal`, con identidad visual propia) donde cada cliente consulta **únicamente las aplicaciones compartidas con su organización**: información funcional, versión publicada, notas de versión autorizadas, estado de disponibilidad y acceso seguro a demostraciones.

El cliente **nunca** ve servidores, entornos internos, despliegues, eventos, repositorios, equipos ni datos de otros clientes.

## Modelos

| Modelo | Campos | Notas |
|---|---|---|
| `Project.client_description` | texto | Información funcional para el portal y el portafolio, separada de la descripción interna. |
| `Release` | `project`, `version` (única por proyecto), `title`, `notes`, `status` (`DRAFT`/`PUBLISHED`/`WITHDRAWN`), `published_at`, `deployment` (opcional, del mismo proyecto), `created_by` | Versión compartida con clientes. |
| `DemoAccessToken` | `environment` (Demo), `user`, `organization`, `token_hash` (SHA-256), `expires_at`, `redeemed_at`, `redeemed_by_service`, `session_expires_at`, `issued_ip` | Ticket temporal de un solo uso. |

## Reglas de negocio

1. **Visibilidad**: un cliente ve un proyecto solo si se cumplen todas estas condiciones:
   - su organización tiene un **acceso vigente** (no revocado ni expirado);
   - la organización está **activa** y el cliente es miembro de ella;
   - el proyecto **no está archivado**.

   Cualquier otro ID devuelve **404**. La regla es `projects_shared_with_client` (Fase 2).
2. **Datos expuestos al cliente**: los serializers del portal son propios y solo incluyen nombre, `client_description`, logotipo, estado funcional, tecnologías, URL del sitio, versión publicada, si hay demo y disponibilidad. Las pruebas comprueban que **no** aparecen el repositorio, el responsable, los miembros, los servidores, las URLs internas ni la descripción interna.
3. **Versiones**:
   - Se crean como borrador; publicarlas exige notas (`notes_required`).
   - Retirarlas las oculta del portal sin borrarlas. Una versión retirada no se edita.
   - La versión mostrada es la publicada más reciente.
   - Las gestionan el ADMIN y el responsable o `MAINTAINER`. Publicar y retirar emite un evento de trazabilidad y queda en la auditoría.
4. **Notas de versión**: se muestran como **texto plano** (respetando los saltos de línea), nunca como HTML, lo que evita inyecciones.
5. **Disponibilidad**: hasta que exista el monitoreo (Fase 6) se informa `UNKNOWN` / «Sin monitoreo». **No se inventa** ningún estado.
6. **Acceso seguro a demos**. Iniciar sesión en DevHub **no** autoriza la URL externa de la demo:
   1. *Abrir demo* abre `/portal/apps/:id/demo`, que llama a `POST /portal/projects/{id}/demo-access/`.
   2. DevHub comprueba la autorización y que exista un entorno **Demo activo con URL pública**. Si no, responde `demo_unavailable`.
   3. DevHub emite un **ticket de 256 bits, de un solo uso**, que expira en `DEMO_TOKEN_TTL_SECONDS` (300 s) y del que solo guarda el hash. Responde con la URL de la demo más `?devhub_demo_token=…`, conservando el resto de la query, y con `Cache-Control: no-store`.
   4. La **aplicación demo canjea el ticket** con `POST /integrations/demo-access/redeem/`, usando un **token de servicio limitado al proyecto**. Al canjearlo se **vuelve a comprobar la autorización**: si el acceso se revocó entre el clic y la apertura, el ticket ya no sirve. Además, el canje es atómico (`SELECT … FOR UPDATE`).
   5. Todos los fallos (ticket inexistente, expirado, reutilizado, fuera del alcance del token, acceso revocado, entorno inactivo) devuelven el **mismo** `403 invalid_ticket`, para no dar pistas.
   6. Una sesión de DevHub no basta para canjear un ticket (401).
   7. La emisión queda registrada como evento `ACCESS_GRANTED` (`metadata.kind = demo_ticket`) y en la auditoría (`DEMO_ACCESS_ISSUED`). La emisión está limitada a 30 por hora.
7. **Portafolio público** (`GET /public/portfolio/`): sin autenticación; muestra solo proyectos `PUBLIC` no archivados, con campos mínimos. Se desactiva con `PUBLIC_PORTFOLIO_ENABLED=false` (404). Los usuarios VISITOR lo ven como página de inicio del portal.
8. Las rutas del portal son **solo para el rol CLIENT**: el personal interno usa el panel y los visitantes, el portafolio.

## Endpoints (`/api/v1/`)

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `portal/summary/` | CLIENT | Nº de aplicaciones y demos, organizaciones, últimas 5 versiones publicadas |
| GET | `portal/projects/` | CLIENT | Aplicaciones autorizadas (`search`, `has_demo=true`, paginación) |
| GET | `portal/projects/{id}/` | CLIENT | Detalle con `access` (organización y vigencia) |
| GET | `portal/projects/{id}/releases/` | CLIENT | Solo versiones publicadas |
| POST | `portal/projects/{id}/demo-access/` | CLIENT, límite de peticiones | `{launch_url, expires_at}` |
| POST | `integrations/demo-access/redeem/` | **token de servicio** del proyecto | `{token}` → `{valid, user, organization, project, environment, session_expires_at}` o 403 |
| GET | `public/portfolio/` | público | Portafolio |
| GET / POST | `releases/` | personal (alcance por proyecto) | Filtros `project` y `status` |
| PATCH | `releases/{id}/` | editor del proyecto | |
| POST | `releases/{id}/publish/` · `withdraw/` | editor del proyecto | |

## Middleware de referencia para demos

`examples/demo-guard/devhub_demo_guard.py` es un WSGI que solo usa la biblioteca estándar:
- canjea el ticket;
- abre una sesión **firmada con HMAC** en una cookie `HttpOnly`, `SameSite=Lax` y `Secure` (configurable);
- quita el ticket de la URL con una redirección 303 y `Referrer-Policy: no-referrer`;
- responde 403 a cualquier petición sin una sesión válida.

`examples/demo-guard/README.md` documenta, además, **Cloudflare Access** como capa adicional en el borde (se configurará en la Fase 6).

## Frontend

- **Portal — Inicio**: indicadores reales (aplicaciones y demos), las tres primeras aplicaciones y *Novedades* (últimas versiones). Para los VISITOR, el portafolio público.
- **Mis aplicaciones** y **Demostraciones**: tarjetas con disponibilidad (icono y texto), versión y botón *Abrir demo*; búsqueda y paginación.
- **Detalle**: descripción para clientes, tecnologías, versión, *Abrir aplicación*, *Abrir demo*, historial de versiones y *Tu acceso* (organización y vigencia).
- **Abrir demo** (`/portal/apps/:id/demo`): página intermedia que pide **un solo** ticket (protegida contra el doble efecto de StrictMode) y redirige. Si falla, explica por qué.
- **Panel administrativo**: campo *Descripción para clientes* en el proyecto y tarjeta **Versiones para clientes** (crear borrador, editar, publicar o retirar con confirmación).

## Verificación realizada (2026-10-12)

| Verificación | Resultado |
|---|---|
| Backend `pytest` | **205 pruebas pasan** (23 nuevas en `tests/test_portal.py`) |
| `ruff`, `spectacular --validate --fail-on-warn` | Sin hallazgos ni advertencias |
| Frontend `vitest` | **71 pruebas pasan** (9 nuevas en `portal.test.tsx`) |
| `tsc -b`, `eslint`, `npm run build` | Sin errores |
| Flujo E2E real (Edge headless + **aplicación demo real** protegida con el middleware) | Ver tabla siguiente |

Flujo real:
1. Un desarrollador responsable escribe la descripción para clientes y publica **v1.7.0** desde la UI.
2. El admin crea un token de servicio desde la UI y la demo de referencia arranca protegida con él.
3. La cliente de Acme entra al portal.

| Comprobación | Resultado |
|---|---|
| Detalle: descripción para clientes, v1.7.0 y sus notas, «Sin monitoreo» | ✅ |
| Detalle sin datos internos (repositorio, servidores, VPN, URL de la demo) | ✅ |
| *Abrir demo* → nueva pestaña → redirección con ticket | ✅ |
| Demo **sin ticket** → 403 | ✅ |
| Demo **con ticket** → acceso como `cliente@acme.test`; ticket eliminado de la URL; cookie `HttpOnly` | ✅ |
| **Reutilizar** el ticket → 403 · **cookie falsificada** → 403 | ✅ |
| Cliente → API interna de proyectos o servidores → 403 | ✅ |
| Sin errores de JavaScript (claro, oscuro, móvil) | ✅ |

Hallazgos durante la verificación:

- **Error real corregido**: `SELECT … FOR UPDATE` fallaba con el `LEFT JOIN` de la organización (opcional) al canjear tickets. Ahora el bloqueo se limita a la fila del ticket (`of=("self",)`).
- **Error real corregido**: el navegador avisó de un `<div>` (skeleton) dentro de un `<p>` en el inicio del portal.
- **Diseño**: los hooks de versiones se separaron del cliente de API para que las pruebas puedan simularlo (mismo patrón que el resto de módulos).
- **No era una fuga**: la cliente veía también «App Reservas». La base de datos confirmó que tiene un acceso vigente para Acme, concedido por el admin en una prueba de UI anterior y registrado en la auditoría. «Inventario Interno», que no está compartida, no aparece.

## Pendiente o diferido

| Tema | Fase |
|---|---|
| Disponibilidad real (health checks) en el portal | 6 |
| Cloudflare Access en los subdominios de demo | 6 (requiere cuenta y dominio en Cloudflare) |
