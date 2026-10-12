# DevHub

Plataforma centralizada para administrar, publicar, monitorear y trazar múltiples aplicaciones
independientes de un equipo de software, desplegada en un Home Lab distribuido. Incluye:

- **DevHub Admin** (`/admin`): panel privado para administradores y desarrolladores.
- **DevHub Client Portal** (`/portal`): portal independiente para clientes.

> Estado: **Fase 1 completada y verificada** (base del sistema). Ver [Hoja de ruta](#hoja-de-ruta).

## Stack

| Capa | Tecnologías |
|---|---|
| Frontend | React 19 + TypeScript, Vite, React Router, Tailwind CSS 4, TanStack Query, React Hook Form + Zod, Axios, Lucide |
| Backend | Python 3.12, Django 5.2, Django REST Framework, django-filter, drf-spectacular, PostgreSQL 17 |
| Pruebas | pytest + pytest-django (backend), Vitest + Testing Library (frontend) |
| Infra local | Docker + Docker Compose |

## Inicio rápido (desarrollo local)

Requisitos: Docker Desktop (o Docker Engine + Compose v2). No se necesita Python ni Node en el host.

```bash
cp .env.example .env          # valores de desarrollo; nunca subas .env
docker compose up --build     # db + backend + frontend
```

| Servicio | URL |
|---|---|
| Panel administrativo | http://localhost:5173/login |
| Portal de clientes | http://localhost:5173/portal/login |
| API | http://localhost:5173/api/v1/ (vía proxy de Vite) o http://localhost:8000/api/v1/ |
| Documentación OpenAPI | http://localhost:8000/api/v1/docs/ |
| Django admin (soporte) | http://localhost:8000/django-admin/ |

Al arrancar, el backend espera a PostgreSQL, aplica migraciones y crea el administrador inicial
definido en `DJANGO_ADMIN_EMAIL` / `DJANGO_ADMIN_PASSWORD` (solo si no existe).

> Si el puerto 5173 u 8000 ya está ocupado en tu equipo, cambia `FRONTEND_PORT` / `BACKEND_PORT`
> en `.env` y actualiza también `DJANGO_CSRF_TRUSTED_ORIGINS` y `FRONTEND_URL`.

PostgreSQL **no** publica puertos en el host; solo es accesible desde la red interna de Compose.

### Comandos habituales

```bash
# Backend
docker compose exec backend pytest                 # pruebas (PostgreSQL real)
docker compose exec backend ruff check .           # lint
docker compose exec backend ruff format --check .  # formato
docker compose exec backend python manage.py makemigrations
docker compose exec backend python manage.py spectacular --validate --file /tmp/schema.yaml

# Frontend (en el host con Node 22, o dentro del contenedor con `docker compose exec frontend ...`)
cd frontend
npm ci
npm test            # Vitest
npm run lint        # ESLint
npm run typecheck   # TypeScript
npm run build       # build de producción
```

## Estructura

```text
devhub/
├── backend/                 Django + DRF (monolito modular)
│   ├── config/              settings (base/local/production/test), urls, wsgi
│   ├── apps/
│   │   ├── users/           usuario personalizado, roles (Groups), auth, sesiones
│   │   ├── organizations/   organizaciones y membresías
│   │   └── audit/           registro de auditoría inmutable
│   ├── common/              errores, permisos, paginación, saneamiento, request-id
│   ├── tests/               pytest
│   └── docker/entrypoint.sh
├── frontend/                React + Vite
│   └── src/
│       ├── app/             router, providers
│       ├── components/      UI reutilizable (Button, Field, Modal, Table, Toast…)
│       ├── layouts/         AdminLayout, PortalLayout, AuthLayout
│       ├── modules/         auth, users, organizations, audit, dashboard, portal
│       ├── services/        cliente HTTP (CSRF, errores normalizados)
│       └── hooks/ types/ utils/ styles/
├── infrastructure/          (Fase 6) compose Home Lab, proxy, VPN, Cloudflare, monitoreo
├── scripts/                 (Fase 6) deploy, backup, restore, healthcheck
├── docs/                    arquitectura y decisiones
└── compose.yaml             entorno de desarrollo local
```

Los módulos `projects`, `infrastructure`, `deployments`, `traceability`, `monitoring` y `portal`
se crean en su fase correspondiente (no se generan apps vacías).

## Documentación

- [Arquitectura, decisiones y reglas de negocio](docs/architecture.md)
- [Fase 1 — alcance, API y verificación](docs/phase-1.md)

## Hoja de ruta

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Repositorio, React + DRF, PostgreSQL, Compose local, usuarios/auth, roles y permisos, organizaciones, layouts panel/portal | ✅ Completada |
| 2 | Proyectos, desarrolladores asignados, acceso por organización | Pendiente |
| 3 | Servidores, entornos, inventario | Pendiente |
| 4 | Despliegues, trazabilidad, integración GitHub Actions | Pendiente |
| 5 | Portal de clientes: apps autorizadas, demos protegidas, versiones | Pendiente |
| 6 | Monitoreo, Docker Home Lab, VPN, Cloudflare Tunnel, scripts, backups, CI/CD | Pendiente |
