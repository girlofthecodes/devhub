# Fase 3 — Infraestructura

## Responsabilidad

Este módulo mantiene dos cosas:

- El **inventario de servidores** del Home Lab (Servidor A de aplicaciones, Servidor B de datos y los que se agreguen).
- Los **entornos** de cada proyecto (Development, Demo, Production): en qué servidor corre cada uno, su URL pública, la versión desplegada y su estado.

En el MVP todo esto son **metadatos registrados**. DevHub no ejecuta comandos remotos y no guarda contraseñas ni llaves SSH.

## Modelos

| Modelo | Campos | Notas |
|---|---|---|
| `Server` | `id` (UUID), `name`, `identifier` (único), `location`, `server_type` (`APPLICATION`/`DATABASE`/`MIXED`/`OTHER`), `operating_system`, `vpn_address`, `status` (`ACTIVE`/`MAINTENANCE`/`INACTIVE`), `notes`, `last_checked_at`, `created_at` (fecha de registro), `updated_at` | No guarda credenciales. `last_checked_at` solo lo llenará el monitoreo (Fase 6). |
| `Environment` | `id`, `project` → Project, `server` → Server (opcional, `PROTECT`), `kind` (`DEVELOPMENT`/`DEMO`/`PRODUCTION`), `name`, `public_url`, `deployed_version`, `status`, `updated_at` | Restricción única (`project`, `kind`). |

## Reglas de negocio

1. **Servidores**
   - El identificador es único y usa minúsculas, números y guiones (`homelab-app-01`).
   - Los servidores **no se eliminan**: se pasan a `INACTIVE`.
   - Un servidor no puede pasar a `INACTIVE` mientras aloje entornos **activos** (`server_in_use`).
   - No se pueden asignar entornos nuevos a un servidor inactivo (`inactive_server`).
2. **Dirección VPN**: es opcional. Si se registra, debe ser **privada** (RFC 1918, ULA IPv6 o el rango CGNAT `100.64.0.0/10` que usa Tailscale). Nunca una IP pública, de loopback ni `0.0.0.0`.
3. **Entornos**
   - Cada proyecto tiene como máximo uno de cada tipo.
   - El proyecto y el tipo no se pueden cambiar después de crearlo.
   - Los entornos **no se eliminan**: se desactivan.
   - Si el proyecto está archivado, sus entornos son de solo lectura.
4. **URL pública** (entornos y `site_url` del proyecto): debe ser `https://`, con un **nombre de dominio público** y sin credenciales embebidas.
   - Se rechazan las IPs, `localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa` y los nombres sin punto.
   - Opcionalmente, `DEVHUB_ALLOWED_PUBLIC_DOMAINS` limita los dominios aceptados (incluye subdominios).
   - El objetivo es que el monitoreo de la Fase 6 no pueda usarse para SSRF contra la red interna.
5. **Versión desplegada**: texto de hasta 50 caracteres `[A-Za-z0-9 . _ - +]`. Por ahora se registra a mano; en la Fase 4 la actualizarán los despliegues.
6. **Sincronización con la URL del sitio**: al crear o cambiar la URL del entorno **Production**, el `site_url` del proyecto se actualiza **solo si** estaba vacío o coincidía con la URL de producción anterior. Un valor personalizado nunca se pisa. El cambio queda en la auditoría con `metadata.source = "production_environment"`.
7. Todo cambio queda en la auditoría (`SERVER_CREATED/UPDATED`, `ENVIRONMENT_CREATED/UPDATED`).

## Permisos

| Acción | ADMIN | DEVELOPER | CLIENT / VISITOR |
|---|---|---|---|
| Ver servidores e inventario | ✅ | ✅ (solo lectura) | 403 |
| Registrar o editar servidores | ✅ | 403 | 403 |
| Ver entornos | todos | de proyectos propios o asignados (si no, 404) | 403 |
| Crear o editar entornos | ✅ | si puede editar el proyecto (responsable o `MAINTAINER`) | 403 |

Crear un entorno en un proyecto que el desarrollador **no ve** devuelve `400` («Proyecto no válido»), no `403`, para no revelar que el proyecto existe.

## Endpoints (`/api/v1/`)

| Método | Ruta | Descripción |
|---|---|---|
| GET / POST | `servers/` | Filtros: `status`, `server_type`, `search`, `ordering`. Incluye `environment_count` y `active_environment_count` |
| GET / PATCH | `servers/{id}/` | DELETE → 405 |
| GET / POST | `environments/` | Filtros: `project`, `server`, `kind`, `status`, `search`. Incluye `can_edit` |
| GET / PATCH | `environments/{id}/` | `project` y `kind` inmutables; DELETE → 405 |
| GET | `infrastructure/summary/` | Conteos de servidores por estado y tipo, y de entornos por estado y tipo, más los entornos sin servidor (acotados a los proyectos visibles) |

## Frontend

- **Infraestructura** (`/admin/infrastructure`): indicadores reales del resumen, tarjetas de servidor (tipo, SO, ubicación, VPN, entornos activos/total y *Sin verificar* mientras no haya monitoreo), filtros y registro (solo ADMIN).
- **Detalle de servidor** (`/admin/infrastructure/servers/:id`): ficha y entornos alojados, con aviso cuando hay entornos de proyectos sin acceso.
- **Entornos** (`/admin/environments`): tabla de todos los entornos visibles con filtros por tipo, estado y servidor. La edición solo aparece donde `can_edit` lo permite.
- **Detalle de proyecto**: tarjeta **Entornos** con las tres posiciones (Development, Demo, Production): las configuradas muestran URL, servidor, versión y estado; las que faltan ofrecen *Configurar*.
- Formularios con validación en el cliente equivalente a la del backend (IP privada, URL pública, versión, identificador).

### Mejora de rendimiento en desarrollo

Durante la verificación, la tabla de entornos del servidor tardaba ~2 s en aparecer. El backend respondía en 50–220 ms; el cuello de botella era el **proxy de Vite**, que abría una conexión nueva (DNS + TCP) en cada petición y sumaba 300–600 ms. Con un `http.Agent` *keep-alive* en `vite.config.ts`, la latencia del proxy bajó a ~40 ms y la tabla aparece en ~150 ms. Esto solo afecta al desarrollo: en producción no hay proxy de Vite.

## Verificación realizada (2026-10-12)

| Verificación | Resultado |
|---|---|
| Backend `pytest` | **145 pruebas pasan** (45 nuevas en `tests/test_infrastructure.py`) |
| `ruff check` / `ruff format --check` | Sin hallazgos |
| `spectacular --validate --fail-on-warn` | Válido, sin advertencias |
| Frontend `vitest` | **50 pruebas pasan** (16 nuevas en `infrastructure.test.tsx`) |
| `tsc -b`, `eslint`, `npm run build` | Sin errores |
| E2E contra el stack (script Python vía proxy) | **24/24 verificaciones pasan** |
| Flujo de UI real (Edge headless) | Un desarrollador responsable configura *Development* desde la ficha del proyecto: `https://localhost:3000` se rechaza en el formulario; con una URL válida se crea y las tres posiciones quedan configuradas. El administrador revisa el inventario, el detalle del servidor (5 entornos), la edición y la lista de entornos (5 filas). Sin errores de JavaScript. |

Verificaciones E2E: registro de los servidores A y B; rechazo de una IP pública como VPN; ausencia de verificación simulada y de campos de credenciales; entornos Production y Demo; un entorno por tipo; rechazo de URLs con IP o internas; sincronización de la URL de producción con un `site_url` vacío; negativa a retirar un servidor en uso; contadores; el desarrollador lee el inventario pero no registra servidores; el responsable actualiza la versión; el colaborador no edita (403); IDOR → 404; un desarrollador crea entornos en su proyecto pero no en uno ajeno; el cliente recibe 403 en los tres endpoints; resumen; auditoría.

## Pendiente o diferido

| Tema | Fase |
|---|---|
| Actualizar `deployed_version` automáticamente desde los despliegues | 4 |
| Health checks reales (`last_checked_at`, estado de disponibilidad) | 6 |
| Compose del Home Lab con PostgreSQL en el Servidor B vía VPN | 6 |
