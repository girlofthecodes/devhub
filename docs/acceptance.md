# Criterios de aceptación del MVP

Cada criterio se relaciona con la verificación que lo demuestra. Las pruebas automatizadas se ejecutan contra PostgreSQL real. Las verificaciones E2E se hicieron contra el stack en ejecución; su detalle está en el documento de cada fase.

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Levantar frontend, backend y base de datos localmente | ✅ | `docker compose up --build` ([README](../README.md#inicio-rápido-desarrollo-local)); [phase-1.md](phase-1.md#verificación-realizada) |
| 2 | Iniciar sesión como administrador | ✅ | `test_auth.py`; E2E de la Fase 1; login con la configuración de producción en el Home Lab simulado ([phase-6.md](phase-6.md#pruebas-reales-no-simuladas)) |
| 3 | Crear usuarios y organizaciones | ✅ | `test_users.py`, `test_organizations.py`; E2E de la Fase 1 |
| 4 | Crear un proyecto | ✅ | `test_projects.py`, `projects.test.tsx`; E2E de la Fase 2 |
| 5 | Asignar desarrolladores | ✅ | `test_projects.py` (miembros, responsable, MAINTAINER); E2E de la Fase 2 |
| 6 | Registrar un servidor | ✅ | `test_infrastructure.py`; E2E de la Fase 3 (servidores A y B) |
| 7 | Crear un entorno demo | ✅ | `test_infrastructure.py`, `infrastructure.test.tsx`; E2E de la Fase 3 |
| 8 | Asociar una URL de demostración | ✅ | Validación anti-SSRF de URLs públicas (Fase 3); demo real protegida (Fase 5) |
| 9 | Registrar un despliegue | ✅ | `test_deployments.py` (panel y token de servicio desde CI), `deployments.test.tsx`; E2E de la Fase 4 con `devhub-deploy-report.sh` |
| 10 | Consultar el historial de despliegues | ✅ | `test_deployments.py`; E2E de la Fase 4 |
| 11 | Consultar eventos de trazabilidad | ✅ | `test_traceability.py` (inmutabilidad, trigger de PostgreSQL, correlación); eventos de monitoreo reales en la Fase 6 |
| 12 | Crear un cliente | ✅ | `test_users.py` (rol CLIENT y membresía) |
| 13 | Asignarle acceso a un proyecto | ✅ | `test_projects.py` (acceso por organización, revocación y expiración) |
| 14 | Iniciar sesión como cliente | ✅ | `test_auth.py`, `portal.test.tsx`; E2E de la Fase 5 |
| 15 | Visualizar únicamente los proyectos autorizados | ✅ | `test_portal.py` (404 en proyectos ajenos, campos internos ausentes); E2E de la Fase 5 |
| 16 | Abrir una demostración protegida | ✅ | `test_portal.py` (ticket de un solo uso, revocación entre emisión y canje); E2E de la Fase 5 con una aplicación demo real y `examples/demo-guard` |
| 17 | Consultar disponibilidad | ✅ | `test_monitoring.py`; verificación real de `https://example.com`, caída y recuperación controladas, datos obsoletos ([phase-6.md](phase-6.md#verificación-realizada)) |
| 18 | Ejecutar pruebas automatizadas | ✅ | 370 pruebas de backend y 96 de frontend (al cierre de la Fase 7), más lint, typecheck, OpenAPI, ShellCheck y actionlint; todo automatizado en `.github/workflows/ci.yml` |
| 19 | Desplegar mediante Docker | ✅ (simulado) | `scripts/deploy.sh` con los compose de los servidores A y B en un solo equipo, repetible y con caída/recuperación de la base. En dos hosts reales falta lo indicado en [phase-6.md](phase-6.md#qué-requiere-infraestructura-real-preparado-no-ejecutable-aquí). |
| 20 | Documentar la comunicación segura entre ambos servidores | ✅ | [homelab.md](homelab.md): WireGuard o Tailscale, firewall, PostgreSQL solo en la IP de la VPN, `pg_hba` con `scram-sha-256` y roles por aplicación |

## Fase 7: accesos por portal y gestión comercial

| Criterio | Estado | Evidencia |
|---|---|---|
| Pantalla de bienvenida con selección de portal | ✅ | `WelcomePage.test.tsx`; capturas en claro, oscuro y 400 px |
| Admin rechazado en el login de clientes; cliente rechazado en el login administrativo (validado en el servidor) | ✅ | `test_portal_auth.py` (casos 1–6, sesión ligada al portal, CSRF, logout); E2E A1–A4 |
| Registrar ventas y rentas | ✅ | `test_commercial.py`; E2E B2–B11 |
| Registrar contratos y cobros | ✅ | `test_commercial.py` (transiciones, cobros por periodo, pagos parciales, vencidos, correcciones) |
| Registrar gastos | ✅ | `test_commercial.py` (ciclo de vida, anulación, reparto); E2E B12–B13 |
| Rentabilidad por aplicación y global | ✅ | `test_commercial_metrics.py` (ganancia, margen, gastos compartidos sin duplicar); E2E B14–B17 |
| MRR y ARR correctos | ✅ | `test_commercial_metrics.py` (4 periodicidades, ejemplo de $9,000, exclusiones, cambio de precio, histórico, ARR global, crecimiento); E2E B18–B21 |
| Evolución de ingresos recurrentes y comparación renta/venta | ✅ | Resumen y Reportes (gráficas con vista de tabla y movimientos del MRR) |
| Indicadores actualizados con los datos registrados | ✅ | Cada escritura invalida las consultas del módulo; E2E con datos reales |
| Métricas financieras protegidas por permisos | ✅ | `test_commercial.py` (DEVELOPER, CLIENT, VISITOR y anónimos con 403; permiso explícito de consulta o gestión; sesión de cliente de un usuario dual); E2E B26–B29 |
| Portal sin información financiera interna | ✅ | `test_commercial.py` (`portal/contracts` sin importes, solo su organización y solo los visibles); E2E B23–B25 |
| Pruebas automatizadas de los cálculos | ✅ | 28 pruebas de cálculo, más 71 de operaciones e integridad |
