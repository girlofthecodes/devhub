# Fase 2 — Proyectos

## Responsabilidad

Cada **proyecto** representa una aplicación independiente que DevHub administra. Este módulo guarda:

- su ficha: nombre, descripción, logotipo, repositorio, documentación, tecnologías, responsable, estado y visibilidad;
- los **desarrolladores asignados**;
- el **acceso explícito por organización**, que más adelante el portal de clientes usará para decidir qué ve cada cliente (Fase 5).

## Modelos

| Modelo | Campos clave | Notas |
|---|---|---|
| `Project` | `id` (UUID), `name` (único sin distinguir mayúsculas), `slug`, `description`, `logo`, `repository_url`, `documentation_url`, `site_url`, `technologies` (ArrayField), `owner` → User, `status`, `status_before_archive`, `visibility`, `archived_at`, `created_at`, `updated_at` | Nunca se elimina. `owner` usa `PROTECT`. |
| `ProjectMember` | `project`, `user`, `role` (`MAINTAINER` \| `CONTRIBUTOR`) | Único por (proyecto, usuario). |
| `ProjectAccess` | `project`, `organization`, `granted_by`, `expires_at`, `notes`, `revoked_at`, `revoked_by` | Restricción única parcial: **un solo acceso abierto** (`revoked_at IS NULL`) por par proyecto-organización. Los accesos revocados se conservan como historial. |

Estados: `PLANNING`, `DEVELOPMENT`, `TESTING`, `AVAILABLE`, `MAINTENANCE`, `ARCHIVED`.
Visibilidad: `INTERNAL`, `PUBLIC` (portafolio público).

## Reglas de negocio

1. El `slug` se genera a partir del nombre, con sufijo `-2`, `-3`… si ya existe.
2. **Archivar** guarda el estado anterior y la fecha. El proyecto queda en **solo lectura**: no admite edición, logotipo, miembros ni nuevos accesos. Tampoco puede publicarse en el portafolio ni aparece en el portal. **Restaurar** devuelve el proyecto a su estado anterior.
3. El estado `ARCHIVED` solo se alcanza con la acción *Archivar*; no puede asignarse editando el proyecto.
4. El responsable y los miembros deben ser usuarios **activos** con rol ADMIN o DEVELOPER.
5. Un DEVELOPER solo ve los proyectos de los que es responsable o miembro. Cualquier otro ID devuelve **404** (protección contra IDOR).
6. Un DEVELOPER responsable, o miembro con rol `MAINTAINER`, puede editar los **datos técnicos**: descripción, URLs (repositorio, documentación y sitio), tecnologías, estado y logotipo. El nombre y el responsable solo los cambia un ADMIN. Si el formulario reenvía esos campos sin cambios, no se trata como error.
7. Las URLs de repositorio, documentación y **sitio** deben ser `https://`. La URL del sitio (`site_url`) es la dirección pública donde ya está desplegada la aplicación: es opcional y la pueden editar el ADMIN y el responsable o un `MAINTAINER`. En la Fase 3 cada entorno (Development, Demo, Production) tendrá además su propia URL.
8. Tecnologías: hasta 20, de 40 caracteres como máximo, con caracteres `[letras números _ . # + - / espacio]` y sin duplicados (sin distinguir mayúsculas).
9. Logotipo: PNG, JPG o WEBP, ≤ 1 MB y ≤ 2048 px por lado. Pillow **verifica el contenido real** (un SVG o un archivo falso con extensión `.png` se rechaza). Se guarda con un nombre aleatorio en `media/projects/logos/<project_id>/`.
10. **Acceso por organización**:
    - Solo se concede a organizaciones **activas** y en proyectos **no archivados**. La expiración, si se indica, debe ser futura.
    - Si ya existe un acceso vigente, se rechaza el duplicado. Si existe uno **expirado**, se cierra automáticamente y se crea uno nuevo.
    - **Revocar** marca `revoked_at`/`revoked_by` sin borrar nada. Volver a conceder crea un registro nuevo.
11. Un cliente ve un proyecto solo si se cumplen **todas** estas condiciones: el acceso no está revocado ni expirado, la organización está activa, el cliente es miembro de ella y el proyecto no está archivado. Lo implementa `selectors.projects_shared_with_client`, que ya está probado y usará el portal en la Fase 5.
12. Todas las operaciones quedan en la auditoría (`PROJECT_*`, `PROJECT_MEMBER_*`, `ACCESS_GRANTED/UPDATED/REVOKED`).

## Permisos

| Acción | ADMIN | DEVELOPER | CLIENT / VISITOR |
|---|---|---|---|
| Listar o ver proyectos | todos | los propios o asignados | 403 |
| Crear, archivar, restaurar, cambiar visibilidad | ✅ | 403 | 403 |
| Editar nombre o responsable | ✅ | ❌ (`permission_denied`) | 403 |
| Editar datos técnicos y logotipo | ✅ | responsable o `MAINTAINER` | 403 |
| Ver miembros | todos | de sus proyectos | 403 |
| Gestionar miembros | ✅ | 403 | 403 |
| Gestionar accesos de organizaciones | ✅ | 403 | 403 |

## Endpoints (`/api/v1/`)

| Método | Ruta | Descripción |
|---|---|---|
| GET / POST | `projects/` | Filtros: `status`, `archived`, `visibility`, `owner`, `technology`, `organization` (acceso vigente), `member`, `search`, `ordering`, `page`, `page_size` |
| GET / PATCH | `projects/{id}/` | DELETE → 405 |
| POST | `projects/{id}/archive/` · `restore/` | ADMIN |
| POST | `projects/{id}/visibility/` | `{visibility: INTERNAL\|PUBLIC}` (ADMIN) |
| POST / DELETE | `projects/{id}/logo/` | `multipart/form-data` (`logo`) / eliminar |
| GET | `projects/technologies/` | Catálogo de tecnologías de los proyectos visibles |
| GET / POST | `project-members/` | Filtros: `project`, `user`, `role` |
| PATCH / DELETE | `project-members/{id}/` | ADMIN |
| GET / POST | `project-access/` | Filtros: `project`, `organization`, `state` (`ACTIVE`/`EXPIRED`/`REVOKED`), `search` (ADMIN) |
| PATCH | `project-access/{id}/` | `expires_at`, `notes` |
| POST | `project-access/{id}/revoke/` | Revocar (se conserva el historial) |
| GET | `users/?roles=ADMIN,DEVELOPER` | Nuevo filtro de varios roles (para elegir responsable y miembros) |

## Frontend

- **Proyectos** (`/admin/projects`): tarjetas o tabla, búsqueda, filtro por estado (activos por defecto, archivados, todos) y por tecnología, paginación, estados vacíos que dependen del rol.
- **Detalle** (`/admin/projects/:id`): cabecera con logotipo y estado, acciones según `permissions` (editar, publicar u ocultar, archivar o restaurar con confirmación), descripción, desarrolladores asignados (con gestión de roles), organizaciones con acceso (conceder con expiración, revocar, ver historial), información y logotipo.
- **Formulario** con validación Zod (https, tecnologías), campo **URL del sitio** y tecnologías tipo *chips* con sugerencias. En el detalle, la URL del sitio aparece en *Enlaces* y como botón **Visitar sitio**.
- **Detalle de organización**: nueva tarjeta *Proyectos autorizados*, que usa el mismo componente de accesos.
- **Dashboard**: indicador *Proyectos activos* (ADMIN) o *Mis proyectos* (DEVELOPER).

## Verificación realizada (2026-10-12)

| Verificación | Resultado |
|---|---|
| Backend `pytest` (PostgreSQL real) | **100 pruebas pasan** (34 nuevas en `tests/test_projects.py`) |
| `ruff check` / `ruff format --check` | Sin hallazgos |
| `spectacular --validate --fail-on-warn` | Válido, sin advertencias |
| Frontend `vitest` | **34 pruebas pasan** (12 nuevas en `projects.test.tsx`) |
| `tsc -b`, `eslint`, `npm run build` | Sin errores |
| Prueba E2E contra el stack (script Python vía proxy de Vite) | **18/18 verificaciones pasan** |
| Revisión visual (Edge headless) | Listado (tarjetas y tabla, claro y oscuro), detalle como admin y como colaborador, edición, diálogo de acceso, organización y móvil, sin errores de JavaScript |

Ajuste posterior (`site_url`): un desarrollador responsable agregó la URL desde el formulario real. El valor `http://` se rechazó en el cliente, el valor `https://` se guardó y el cambio quedó en la auditoría (`PROJECT_UPDATED`, `site_url: "" → https://…`).

Verificaciones E2E: creación con UTF-8, asignación de colaborador, concesión de acceso, subida multipart del logotipo y su descarga vía proxy (`image/png`), rechazo de un SVG disfrazado, alcance del desarrollador responsable, edición técnica permitida, cambio de nombre denegado, archivado denegado, IDOR → 404, colaborador sin edición (403), cliente sin acceso a la API administrativa (403), contadores, catálogo de tecnologías y auditoría. Además, el selector del portal devuelve para el cliente de Acme únicamente el proyecto autorizado.

## Pendiente o diferido

| Tema | Fase |
|---|---|
| Entornos asociados al proyecto | 3 |
| Despliegues y eventos del proyecto | 4 |
| Endpoints del portal que usan `projects_shared_with_client` | 5 |
| Servir `MEDIA_ROOT` en producción mediante el reverse proxy, con volumen persistente | 6 (en desarrollo lo sirve Django con `DEBUG=True`) |
