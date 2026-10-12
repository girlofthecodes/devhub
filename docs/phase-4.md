# Fase 4 — Despliegues y trazabilidad

## Responsabilidad

Esta fase permite reconstruir **qué ocurrió con una aplicación, cuándo, dónde y qué componente intervino**:

- **Despliegues** (`apps/deployments`): historial de versiones por entorno, con su máquina de estados.
- **Trazabilidad** (`apps/traceability`): eventos inmutables correlacionados entre sí.
- **Integración CI/CD**: tokens de servicio y endpoints para GitHub Actions, junto con un script listo para usar en los workflows.

## Modelos

| Modelo | Campos clave | Notas |
|---|---|---|
| `Deployment` | `environment` → Environment (`PROTECT`), `version`, `commit_sha`, `branch`, `source` (`MANUAL`/`GITHUB_ACTIONS`/`API`), `triggered_by`, `triggered_by_label`, `status`, `started_at`, `finished_at`, `ci_run_id`, `ci_run_url`, `message`, `correlation_id` (`dep-<uuid>`, único) | Único por (`environment`, `ci_run_id`) cuando hay `ci_run_id`. No admite PATCH ni DELETE. |
| `Event` | `occurred_at`, `project`, `environment`, `deployment` (FK `SET NULL`), `event_type`, `severity` (`INFO`/`WARNING`/`ERROR`/`CRITICAL`), `source` (`SYSTEM`/`USER`/`GITHUB_ACTIONS`/`API`/`MONITORING`), `correlation_id`, `description`, `metadata` (saneado), `actor`, `actor_label` | Solo inserción: inmutable en Django **y** en PostgreSQL. |
| `ServiceToken` | `name`, `key_prefix`, `token_hash` (SHA-256), `projects` (M2M), `expires_at`, `last_used_at`, `revoked_at`, `created_by` | El valor del token solo se muestra al crearlo. |

**Tipos de evento:** `PROJECT_CREATED`, `PROJECT_UPDATED`, `DEPLOYMENT_STARTED`, `DEPLOYMENT_SUCCESS`, `DEPLOYMENT_FAILED`, `SERVICE_UNAVAILABLE`, `SERVICE_RECOVERED`, `ACCESS_GRANTED`, `ACCESS_REVOKED` y `CONFIGURATION_CHANGED`. Además, **`DEPLOYMENT_CANCELLED`** es una extensión documentada, para no registrar una cancelación como fallo.

## Reglas de negocio

1. **Máquina de estados**:
   - `PENDING → RUNNING | FAILED | CANCELLED`
   - `RUNNING → SUCCESS | FAILED | CANCELLED`
   - Los estados finales no cambian (`invalid_transition`).
2. **Un despliegue en curso por entorno.** Iniciar otro mientras uno está `RUNNING` devuelve `deployment_in_progress`.
3. Al pasar a `SUCCESS`, la `deployed_version` del entorno se actualiza automáticamente. El evento guarda la `previous_version`.
4. **Registro de despliegues pasados:** se puede crear directamente en estado `SUCCESS` o `FAILED`. El servicio recorre la máquina de estados para emitir los mismos eventos que un despliegue en vivo.
5. No se despliega en entornos `INACTIVE` (`inactive_environment`) ni en proyectos archivados (`archived`).
6. **Validación de campos:**
   - versión: `[A-Za-z0-9._+-]{1,50}`
   - commit: hexadecimal de 7 a 40 caracteres (se normaliza a minúsculas)
   - rama: `[\w./-]{1,120}`
   - `ci_run_url`: URL pública https (con la misma protección contra SSRF de la Fase 3)
7. **Eventos emitidos por el backend:**
   - Proyectos: creación, cambios, archivado o restauración, visibilidad.
   - Accesos: concesión y revocación (la revocación con severidad `WARNING`).
   - Configuración: asignación de miembros y alta o cambio de entornos.
   - Despliegues: cada transición de estado.
   - Sincronización del `site_url` con producción.
   - Los usuarios **no pueden crear eventos** por la API, que es de solo lectura.
8. **Correlación:**
   - Los eventos de un despliegue comparten su `correlation_id`.
   - Los demás eventos usan el `X-Request-ID` de la petición que los originó.
   - Desde la UI, *Ver eventos relacionados* filtra por ese identificador.
9. **Saneamiento:** `metadata` pasa por `common.sanitize`, que redacta tokens, contraseñas, cookies, DSN o cadenas de conexión, `Bearer …` y `ghp_…`.
10. **Inmutabilidad**, protegida en dos niveles (eventos y auditoría):
    - **Django:** `save()` de una fila existente, `delete()`, `QuerySet.update()` y `QuerySet.delete()` lanzan `ImmutableRecordError`.
    - **PostgreSQL:** un trigger `devhub_protect_append_only` rechaza cualquier `UPDATE`, salvo que un FK pase a `NULL` (lo que hace `ON DELETE SET NULL`), y cualquier `DELETE` sin la bandera de sesión de purga. Así se bloquea incluso el SQL directo.
11. **Retención** (`manage.py purge_history`):
    - Por defecto, 365 días para eventos y 730 para auditoría (`TRACE_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS`). El mínimo es 30.
    - `--dry-run` informa sin borrar.
    - Es el **único** camino que activa `SET LOCAL devhub.allow_purge = on`, dentro de su propia transacción.
    - En la Fase 6 se programará con cron o un timer de systemd.
12. **Tokens de servicio:**
    - Formato `dhs_<prefijo>_<secreto>` (256 bits). Solo se guarda el SHA-256.
    - Son obligatoriamente **limitados a proyectos** y pueden expirar y revocarse.
    - Solo autentican en `/integrations/…`. En el resto de la API reciben 403.
    - La respuesta de creación lleva `Cache-Control: no-store`.
    - La auditoría registra su creación y revocación, nunca su valor.
13. **Integración idempotente:** repetir el `start` con el mismo `ci_run_id` en el mismo entorno devuelve el despliegue existente. El script usa `<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>`, así que un reintento de la ejecución crea un registro nuevo y una re-ejecución del mismo intento no.
14. **Autoría en CI:** los cambios de estado reportados por CI conservan como autor a quien disparó el workflow (`GITHUB_ACTOR`), no el nombre del token.

## Permisos

| Acción | ADMIN | DEVELOPER | CLIENT / VISITOR | Token de servicio |
|---|---|---|---|---|
| Ver despliegues | todos | de sus proyectos (si no, 404) | 403 | — |
| Registrar despliegue o cambiar su estado | ✅ | responsable o `MAINTAINER` | 403 | solo en proyectos del token (si no, 404) |
| Ver eventos | todos (incluidos los que no tienen proyecto) | de sus proyectos | 403 | — |
| Gestionar tokens | ✅ | 403 | 403 | 403 |
| Resto de la API | — | — | — | 403 |

## Endpoints (`/api/v1/`)

| Método | Ruta | Descripción |
|---|---|---|
| GET / POST | `deployments/` | Filtros: `project`, `environment`, `kind`, `status`, `source`, `ci_run_id`, `created_from`, `created_to`, `search`, `ordering` |
| GET | `deployments/{id}/` | Incluye `can_manage`, `duration_seconds` y `correlation_id` |
| POST | `deployments/{id}/transition/` | `{status, message}` |
| GET | `deployments/stats/?days=14&project=` | Conteos por día y estado, totales y tasa de éxito |
| GET | `events/` · `events/{id}/` | Filtros: `project`, `environment`, `deployment`, `event_type` y `severity` (separados por comas), `source`, `correlation_id`, `occurred_from`, `occurred_to`, `search` |
| GET / POST | `service-tokens/` | Creación con `{name, projects[], expires_at}`; la respuesta incluye `token` **una sola vez** |
| POST | `service-tokens/{id}/revoke/` | |
| POST | `integrations/deployments/` | **Bearer token**. `{project (slug), environment (tipo), version, status?, commit_sha?, branch?, ci_run_id?, ci_run_url?, triggered_by?, message?}` |
| POST | `integrations/deployments/{id}/status/` | **Bearer token**. `{status, message?}` |

## GitHub Actions

- `scripts/devhub-deploy-report.sh` (`start` / `finish`):
  - Toma commit, rama, ejecución, URL y autor de las variables `GITHUB_*`.
  - Pasa el token **por stdin** a `curl` (`-H @-`), así que no aparece en `ps`, y desactiva `set -x` para que tampoco aparezca en trazas.
  - Construye el JSON escapado con Python, hace reintentos y devuelve errores legibles.
- `docs/examples/github-actions-deploy.yml`: workflow de ejemplo.
  - Se dispara solo con `push` a `main` o con `workflow_dispatch` (**nunca con `pull_request_target`**).
  - Usa un `environment: production` protegido, `concurrency` y `permissions: contents: read`.
  - Reporta el resultado con `if: always()`.

## Frontend

- **Despliegues** (`/admin/deployments`): gráfica de despliegues por día (7, 14 o 30 días) con vista de tabla, filtros (proyecto, entorno, estado, origen, fechas, búsqueda) y registro manual.
- **Detalle de despliegue**: datos, commit (enlazado si el repositorio está en GitHub o GitLab), ejecución de CI, mensaje, eventos correlacionados y transiciones permitidas con confirmación. Mientras el despliegue no termina, la página se refresca cada 10 s.
- **Trazabilidad** (`/admin/traceability`): línea de tiempo agrupada por día con filtros (proyecto, tipo, severidad, origen, fechas, búsqueda), metadatos expandibles y filtrado por correlación (enlazable con `?correlation=`).
- **Integraciones** (`/admin/settings/integrations`): tokens enmascarados, creación con un modal que muestra el token una sola vez (con botón Copiar), revocación con confirmación y guía de conexión.
- **Detalle de proyecto**: tarjetas *Despliegues recientes* (con registro) y *Trazabilidad*.
- **Dashboard**: gráfica de despliegues (todos para ADMIN, los propios para DEVELOPER).

### Accesibilidad y color de la gráfica

La paleta de estados se **validó con el verificador de paletas** (`dataviz/validate_palette.js`), por separado para modo claro y oscuro:

- Exitoso `#0ca30c`, En curso `#3b82f6`, Cancelado `#d4920a` (oscuro: `#c08508`), Fallido `#d03b3b`.
- El orden de apilado evita que verde y rojo queden juntos, porque con deuteranopía se distinguen mal (ΔE 4.1). En el orden final, el par adyacente menos separado tiene ΔE 13.9 en modo claro y 9.0 en oscuro.
- Los fallidos llevan además una **textura rayada**. Hay leyenda con etiquetas y totales, tooltip y una **vista de tabla**, que compensa el contraste bajo del ámbar en modo claro.

## Verificación realizada (2026-10-12)

| Verificación | Resultado |
|---|---|
| Backend `pytest` | **182 pruebas pasan** (37 nuevas en `test_deployments.py` y `test_traceability.py`) |
| `ruff`, `spectacular --validate --fail-on-warn` | Sin hallazgos ni advertencias |
| Frontend `vitest` | **62 pruebas pasan** (12 nuevas en `deployments.test.tsx`) |
| `tsc -b`, `eslint`, `npm run build` | Sin errores |
| Script de integración contra el stack | **12/12**: token, `start`, idempotencia, `finish`, metadatos de GitHub, versión del entorno, eventos correlacionados, estado final inmutable, 401, 404 fuera de alcance, validación de parámetros y token ausente de la salida (incluso con `bash -x`) |
| Flujo real de UI y CI (Edge headless) | El admin crea el token **en la UI** y lo copia; con ese token, dos ejecuciones de CI simuladas (una falla, otra exitosa); un desarrollador registra un despliegue manual desde el proyecto y lo marca exitoso (la versión del entorno pasa a `v2.1.0`); la trazabilidad filtrada por correlación muestra exactamente los 2 eventos del despliegue fallido. Sin errores de JavaScript. |
| Base de datos real | `UPDATE traceability_event …` y `DELETE FROM audit_auditlog` por SQL directo se **rechazan** por el trigger; `purge_history --dry-run` funciona; una retención menor de 30 días se rechaza. |

Problemas encontrados y corregidos durante la verificación:

- **Script en Windows:**
  - `python3` resolvía a un acceso directo de la Microsoft Store; ahora se comprueba que el intérprete funciona.
  - El `curl` nativo no leía `<(…)`; el encabezado pasa ahora por stdin.
  - Las respuestas se leían con cp1252; ahora se fuerza UTF-8.
- **Autoría:** los cambios de estado desde CI aparecían a nombre del token; ahora conservan el autor original.
- **Dependencias del contenedor:** al añadir una dependencia del frontend hay que reinstalarlas también en el contenedor (ver README).
- **Línea de tiempo:** los eventos positivos se mostraban en azul por su severidad informativa; ahora aparecen en verde.

## Pendiente o diferido

| Tema | Fase |
|---|---|
| Eventos `SERVICE_UNAVAILABLE` / `SERVICE_RECOVERED` emitidos por el monitoreo | 6 |
| Programar `purge_history` (cron o timer de systemd) | 6 |
| Workflow de CI/CD del propio DevHub | 6 |
| Rollback automático | Fuera del MVP (por requisito) |
