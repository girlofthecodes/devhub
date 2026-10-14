# DevHub

Plataforma centralizada para administrar, publicar, monitorear y trazar múltiples aplicaciones
independientes de un equipo de software, desplegada en un Home Lab distribuido. Incluye:

- **Pantalla de bienvenida** (`/`): elige el portal al que se ingresa.
- **DevHub Admin** (`/admin`, login en `/admin/login`): panel privado para administradores y desarrolladores.
- **DevHub Client Portal** (`/cliente`, login en `/cliente/login`): portal independiente para clientes.

> Estado: **Fases 1 a 7 completadas y verificadas** (base, proyectos, infraestructura, despliegues, trazabilidad, portal de clientes, monitoreo, Home Lab y gestión comercial con MRR/ARR). Lo que depende de infraestructura real (VPN entre dos equipos, Cloudflare, runner de GitHub) está preparado y documentado en [docs/homelab.md](docs/homelab.md). Ver [Hoja de ruta](#hoja-de-ruta).

## Stack

| Capa | Tecnologías |
|---|---|
| Frontend | React 19 + TypeScript, Vite, React Router, Tailwind CSS 4, TanStack Query, React Hook Form + Zod, Axios, Lucide |
| Backend | Python 3.12, Django 5.2, Django REST Framework, django-filter, drf-spectacular, PostgreSQL 17 |
| Pruebas | pytest + pytest-django (backend), Vitest + Testing Library (frontend) |
| Infra | Docker + Compose, Caddy, Cloudflare Tunnel, WireGuard/Tailscale, GitHub Actions |

## Inicio rápido (desarrollo local)

Requisitos: Docker Desktop (o Docker Engine + Compose v2). No se necesita Python ni Node en el host.

```bash
cp .env.example .env          # valores de desarrollo; nunca subas .env
docker compose up --build     # db + backend + monitor + frontend
```

| Servicio | URL |
|---|---|
| Bienvenida (selección de portal) | http://localhost:5173/ |
| Panel administrativo | http://localhost:5173/admin/login |
| Portal de clientes | http://localhost:5173/cliente/login |
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

> El contenedor `frontend` usa su propio volumen de `node_modules`. Si cambia `package.json`
> (p. ej. tras `git pull`), sincronízalo con `docker compose exec frontend npm ci` y reinicia
> el servicio (`docker compose restart frontend`).

```bash
# Trazabilidad: política de retención (365 días eventos / 730 auditoría / 30 resultados de monitoreo)
docker compose exec backend python manage.py purge_history --dry-run
# Monitoreo: el servicio `monitor` verifica los health checks periódicamente; una pasada manual:
docker compose exec monitor python manage.py run_monitor --once
```

El monitoreo solo consulta URLs públicas `https` registradas en entornos. En local, los
dominios que resuelven a IPs privadas se rechazan a propósito (protección SSRF).

## Estructura

```text
devhub/
├── backend/                 Django + DRF (monolito modular)
│   ├── config/              settings (base/local/production/test), urls, wsgi
│   ├── apps/
│   │   ├── users/           usuario personalizado, roles (Groups), auth, sesiones
│   │   ├── organizations/   organizaciones y membresías
│   │   ├── audit/           registro de auditoría inmutable
│   │   ├── projects/        proyectos, desarrolladores asignados, acceso por organización
│   │   ├── infrastructure/  inventario de servidores y entornos por proyecto
│   │   ├── deployments/     despliegues, tokens de servicio, integración CI/CD
│   │   ├── traceability/    eventos inmutables, línea de tiempo, retención
│   │   ├── portal/          API del portal de clientes, tickets de demo, portafolio público
│   │   ├── monitoring/      health checks, sonda anti-SSRF, worker run_monitor
│   │   └── commercial/      contratos, cobros, pagos, gastos, rentabilidad, MRR/ARR
│   ├── common/              errores, permisos, paginación, saneamiento, request-id
│   ├── tests/               pytest
│   └── docker/entrypoint.sh
├── frontend/                React + Vite
│   └── src/
│       ├── app/             router, providers
│       ├── components/      UI reutilizable (Button, Field, Modal, Table, Toast…)
│       ├── layouts/         AdminLayout, PortalLayout, AuthLayout
│       ├── modules/         auth, users, organizations, projects, infrastructure, deployments,
│       │                    traceability, monitoring, commercial, settings, audit, dashboard, portal
│       ├── services/        cliente HTTP (CSRF, errores normalizados)
│       └── hooks/ types/ utils/ styles/
├── infrastructure/          compose de los servidores A y B, Caddy, pg_hba, VPN, firewall, Cloudflare, systemd
├── scripts/                 setup, build, migrate, deploy, healthcheck, status, backup, restore,
│                            create-app-db, devhub-deploy-report (CI → DevHub)
├── .github/                 CI (ci.yml), despliegue controlado (deploy-demo.yml), Dependabot
├── examples/demo-guard/     middleware de referencia para proteger demos con DevHub
├── docs/                    arquitectura y decisiones
└── compose.yaml             entorno de desarrollo local
```

## Documentación

- [Arquitectura, decisiones y reglas de negocio](docs/architecture.md)
- [Fase 1 — alcance, API y verificación](docs/phase-1.md)
- [Fase 2 — proyectos: reglas, permisos, API y verificación](docs/phase-2.md)
- [Fase 3 — infraestructura: servidores, entornos e inventario](docs/phase-3.md)
- [Fase 4 — despliegues, trazabilidad e integración con GitHub Actions](docs/phase-4.md)
- [Fase 5 — portal de clientes, versiones compartidas y acceso seguro a demos](docs/phase-5.md)
- [Fase 6 — monitoreo, Home Lab, scripts, backups y CI/CD](docs/phase-6.md)
- [Fase 7 — accesos por portal, gestión comercial, rentabilidad, MRR y ARR](docs/phase-7.md)
- [Guía de despliegue en el Home Lab (VPN, túnel, backups, variables, problemas frecuentes)](docs/homelab.md)
- [Criterios de aceptación del MVP y su evidencia](docs/acceptance.md)

## Hoja de ruta

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Repositorio, React + DRF, PostgreSQL, Compose local, usuarios/auth, roles y permisos, organizaciones, layouts panel/portal | ✅ Completada |
| 2 | Proyectos, desarrolladores asignados, acceso por organización | ✅ Completada |
| 3 | Servidores, entornos, inventario | ✅ Completada |
| 4 | Despliegues, trazabilidad, integración GitHub Actions | ✅ Completada |
| 5 | Portal de clientes: apps autorizadas, demos protegidas, versiones | ✅ Completada |
| 6 | Monitoreo, Docker Home Lab, VPN, Cloudflare Tunnel, scripts, backups, CI/CD | ✅ Completada (VPN/túnel/runner: preparados, requieren infraestructura real) |
| 7 | Login separado por portal; contratos de venta y renta, cobros, gastos, rentabilidad, MRR/ARR | ✅ Completada |
