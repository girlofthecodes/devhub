# Fase 1 — Base del sistema

## Alcance entregado

| # | Ítem | Resultado |
|---|---|---|
| 1 | Estructura del repositorio | Monorepo `backend/`, `frontend/`, `docs/`, `infrastructure/`, `scripts/` |
| 2 | React y DRF | Vite + React 19 + TS; Django 5.2 + DRF con settings por entorno |
| 3 | PostgreSQL | PostgreSQL 17 con timeouts y health checks de conexión |
| 4 | Docker Compose local | `compose.yaml`: `db`, `backend` (runserver) y `frontend` (Vite), con health checks y sin exponer la BD |
| 5 | Usuarios y autenticación | Usuario personalizado (email + UUID), login/logout, perfil, cambio y recuperación de contraseña |
| 6 | Roles y permisos | Groups + permisos de modelo, permisos DRF, querysets acotados, revocación de sesiones |
| 7 | Organizaciones | CRUD sin borrado, activar/desactivar, membresías con rol, aislamiento |
| 8 | Layouts | `AdminLayout` (sidebar colapsable, breadcrumbs, tema), `PortalLayout` (navegación superior, identidad teal) y `AuthLayout` |

Además: auditoría inmutable con su pantalla de consulta, dashboard con métricas reales y estado de la API, y modo claro/oscuro/sistema.

Los módulos de fases posteriores aparecen en la navegación **deshabilitados** con la etiqueta de la fase en que llegarán (`F2`…`F6`). No navegan a ninguna parte ni simulan datos.

## Endpoints (`/api/v1/`)

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `health/` | público | Estado de API y BD (200/503) |
| GET | `auth/csrf/` | público | Emite la cookie `devhub_csrftoken` |
| POST | `auth/login/` | público + CSRF, rate limit | `{email, password}` → usuario actual |
| POST | `auth/logout/` | autenticado | Cierra la sesión |
| GET/PATCH | `auth/me/` | autenticado | Perfil (+ organizaciones activas) / editar nombre |
| POST | `auth/change-password/` | autenticado | Cierra las demás sesiones |
| POST | `auth/password-reset/` | público + CSRF, rate limit | Siempre 202 |
| POST | `auth/password-reset/confirm/` | público + CSRF, rate limit | `{uid, token, new_password}` |
| GET | `roles/` | ADMIN | Catálogo de roles |
| GET/POST | `users/` | ADMIN | Filtros: `role`, `is_active`, `organization`, `search`, `ordering`, `page`, `page_size` |
| GET/PATCH | `users/{id}/` | ADMIN | Nombre y rol (DELETE → 405) |
| POST | `users/{id}/activate/` · `deactivate/` · `revoke-sessions/` | ADMIN | |
| GET/POST | `organizations/` | lectura: autenticado (acotado) · escritura: ADMIN | Filtros: `is_active`, `search` |
| GET/PATCH | `organizations/{id}/` | ídem | (DELETE → 405) |
| POST | `organizations/{id}/activate/` · `deactivate/` | ADMIN | |
| GET/POST | `memberships/` | ADMIN | Filtros: `organization`, `user`, `role` |
| PATCH/DELETE | `memberships/{id}/` | ADMIN | Cambiar rol / quitar miembro |
| GET | `audit-logs/` | ADMIN | Filtros: `action`, `actor`, `target_type`, `created_from`, `created_to`, `search` |
| GET | `schema/` · `docs/` | autenticado (público en local) | OpenAPI 3 / Swagger UI |

## Verificación realizada

Todo lo siguiente **se ejecutó** en el entorno de desarrollo (Windows 11 + Docker Desktop) el 2026-10-12:

| Verificación | Resultado |
|---|---|
| Backend `pytest` (PostgreSQL 17 real, en contenedor) | **66 pruebas pasan** |
| Backend `ruff check` + `ruff format --check` | Sin hallazgos |
| `manage.py spectacular --validate --fail-on-warn` | Esquema OpenAPI válido, sin advertencias |
| Frontend `vitest run` | **22 pruebas pasan** |
| Frontend `tsc -b` + `eslint` | Sin errores ni advertencias |
| Frontend `npm run build` | Build correcto |
| `docker compose up --build` | `db`, `backend` (healthy) y `frontend` en ejecución |
| Prueba de humo E2E vía proxy de Vite (curl) | Ver tabla siguiente |
| Revisión visual (Edge headless) | Login, dashboard, usuarios, organizaciones, detalle, modal, auditoría y portal, en claro, oscuro y móvil, sin errores de JavaScript |

Prueba de humo E2E contra el stack real:

| Paso | Esperado | Obtenido |
|---|---|---|
| Login sin token CSRF | 403 | 403 |
| Login administrador | rol ADMIN | ✅ |
| Crear usuario CLIENT, 2 organizaciones y membresía OWNER | 201 | ✅ |
| Login del cliente | rol CLIENT, organizaciones `['Acme Corp']` | ✅ |
| Cliente lista organizaciones | solo `Acme Corp` | ✅ |
| Cliente pide otra organización por ID (IDOR) | 404 | 404 |
| Cliente lista usuarios | 403 | 403 |
| Admin desactiva al cliente → sesión del cliente | 403 | 403 |
| Auditoría registra todas las acciones | ✅ | ✅ |

### Cobertura de pruebas (resumen)

- **Backend**: login (éxito, credenciales erróneas, usuario inactivo, CSRF, rate limit), formato de errores, perfil, logout, cambio de contraseña (revoca otras sesiones), recuperación completa (token de un solo uso, sin enumeración), CRUD de usuarios, roles, filtros, búsqueda, paginación, desactivación con revocación de sesiones, reglas de autoprotección y último administrador, CRUD de organizaciones, slug, unicidad, membresías, **aislamiento entre organizaciones/IDOR**, permisos por rol (parametrizados), inmutabilidad y saneamiento de la auditoría, health check, request ID y esquema OpenAPI.
- **Frontend**: rutas protegidas (anónimo, rol permitido, rol de otra área, carga, error con reintento), formulario de login (validación, error del servidor, redirección por rol), diálogo de confirmación (foco, Escape, bloqueo durante la carga), página de usuarios (listado, vacío, error y reintento, creación con errores de campo del backend, confirmación antes de desactivar) y utilidades.

## Pendiente o diferido (con motivo)

| Tema | Fase | Nota |
|---|---|---|
| CI (GitHub Actions) | 6 | Las pruebas ya corren en local; el workflow se agrega junto con el despliegue controlado. |
| Compose de Home Lab, proxy, VPN, Cloudflare Tunnel, backups | 6 | El backend ya está preparado: settings de producción, gunicorn, WhiteNoise, timeouts de BD y entrypoint con espera limitada. |
| Envío real de correo | 6 | En local, el correo de recuperación se imprime en `docker compose logs backend`. En producción hay que configurar `EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend` y las variables `EMAIL_HOST*`. |
| División del bundle (lazy routes) | 2+ | Vite advierte de un chunk > 500 kB; se resolverá al crecer los módulos. |
| Retención de auditoría | 4 | Junto con la política de retención de eventos de trazabilidad. |
