# Fase 8 — Métricas internas, alertas y monitoreo en tiempo real

## Alcance

1. **Métricas internas** reportadas por cada aplicación: CPU, memoria, peticiones por minuto, tasa de errores, latencia p95, conexiones activas y tiempo de actividad del proceso.
2. **Alertas** con ciclo de vida (abierta → reconocida → resuelta): caídas, degradación, umbrales de métricas y aplicaciones que dejan de reportar.
3. **Página de métricas** (`/admin/metrics`): todos los proyectos con páginas activas, páginas caídas, alertas, última actualización, disponibilidad y métricas, con actualización en vivo.
4. **Detalle por proyecto** (`/admin/metrics/:id`): valores en tiempo real, historial (1 h, 24 h, 7 días y 30 días) y estadísticas.
5. **Página de alertas** (`/admin/alerts`): KPIs, filtros, reconocer y resolver.
6. **Datos de demostración** (`manage.py seed_demo`) para todos los módulos.

## Modelos (`apps.monitoring`)

| Modelo | Campos | Notas |
|---|---|---|
| `MetricSample` | `environment`, `recorded_at`, `received_at`, `cpu_percent`, `memory_percent`, `memory_used_mb`, `requests_per_minute`, `error_rate_percent`, `latency_p95_ms`, `active_connections`, `process_uptime_seconds` | Todas las métricas son opcionales. Índice `(environment, -recorded_at)`. Se purga a los `METRIC_SAMPLE_RETENTION_DAYS` (30). |
| `Alert` | `environment`, `kind`, `severity`, `status`, `message`, `value`, `threshold`, `hits`, `opened_at`, `last_seen_at`, `acknowledged_at/by`, `resolved_at/by` | Como mucho **una alerta activa** (abierta o reconocida) por `(entorno, tipo)`, garantizado por un índice único parcial. Las resueltas se purgan a los `ALERT_RETENTION_DAYS` (365). |

## Ingesta de métricas (modelo *push*)

`POST /api/v1/integrations/metrics/` con `Authorization: Bearer <token de servicio>`.

```json
{
  "project": "tienda-en-linea",
  "environment": "PRODUCTION",
  "recorded_at": "2026-11-26T17:00:00Z",
  "cpu_percent": 42.5,
  "memory_percent": 61,
  "memory_used_mb": 1250,
  "requests_per_minute": 312,
  "error_rate_percent": 0.4,
  "latency_p95_ms": 380,
  "active_connections": 18,
  "process_uptime_seconds": 7200
}
```

Reglas:

- **Por qué push.** DevHub no se conecta a las aplicaciones para leer sus métricas, así que no se abre otra superficie de SSRF ni se exponen puertos internos.
- **Alcance del token.** Es el mismo token de servicio de la Fase 4, limitado a sus proyectos. Un proyecto fuera de alcance o un entorno inexistente devuelven 404.
- **Validación.**
  - Los porcentajes van de 0 a 100 y ningún valor puede ser negativo.
  - Cada envío debe incluir al menos una métrica.
  - `recorded_at` es opcional (por defecto, el momento de recepción). Se rechaza si está más de 5 min en el futuro o si tiene más de 1 h de antigüedad.
  - No se aceptan muestras de proyectos archivados.
- **Throttle.** Ámbito propio `metrics` (`THROTTLE_METRICS`, 600/min), separado del de despliegues.
- **Agente de referencia.** Está en [examples/metrics-agent](../examples/metrics-agent/) y solo usa la biblioteca estándar.

## Alertas

| Tipo | Origen | Severidad | Se resuelve cuando |
|---|---|---|---|
| `SERVICE_DOWN` (Servicio caído) | Health check pasa a `UNAVAILABLE` | CRITICAL en Production, ERROR en el resto | El health check deja de estar caído |
| `SLOW_RESPONSE` (Servicio degradado) | Health check en `DEGRADED` (lento o primer fallo) | WARNING | El health check vuelve a `HEALTHY` o pasa a caído |
| `HIGH_CPU`, `HIGH_MEMORY` | Muestra ≥ 85 % (crítica ≥ 95 %) | WARNING / CRITICAL | Una muestra posterior queda bajo el umbral |
| `HIGH_ERROR_RATE` | Muestra ≥ 5 % (crítica ≥ 15 %) | WARNING / CRITICAL | Ídem |
| `HIGH_LATENCY` | p95 ≥ 1500 ms (crítica ≥ 3000 ms) | WARNING / CRITICAL | Ídem |
| `METRICS_STALE` (Sin métricas recientes) | Una app que reportó en las últimas 24 h deja de hacerlo durante `MONITOR_METRICS_STALE_SECONDS` (600) | WARNING | Llega una muestra nueva |

Reglas:

1. **Sin duplicados.** Si una condición que ya tiene alerta activa se vuelve a detectar, esa alerta se actualiza (valor, severidad, mensaje, `hits`, `last_seen_at`) en lugar de crear otra.
2. **Muestras fuera de orden.** Una muestra más antigua que la última recibida no abre ni resuelve alertas.
3. **Desactivar un health check** resuelve sus alertas `SERVICE_DOWN` y `SLOW_RESPONSE`.
4. **Acciones manuales** (editor del proyecto: ADMIN, responsable o MAINTAINER):
   - *Reconocer* solo aplica a alertas abiertas.
   - *Resolver* aplica a alertas abiertas o reconocidas. Si la condición persiste, la siguiente evaluación abre una alerta nueva.
   - Las dos acciones se auditan como `ALERT_ACKNOWLEDGED` y `ALERT_RESOLVED`.
5. **Dónde se evalúa.** Los umbrales se configuran con `MONITOR_ALERT_*` (ver `.env.example`). El worker `run_monitor` evalúa `METRICS_STALE` en cada vuelta, y los umbrales se evalúan al recibir cada muestra.

## Estadísticas e historial

| Indicador | Cálculo |
|---|---|
| Disponibilidad (24 h / 7 d / 30 d / ventana) | Verificaciones `HEALTHY` o `DEGRADED` entre el total. Sin datos vale `null` («—»), nunca 100 %. |
| Respuesta promedio, p95 y máxima | Sobre los `CheckResult` de la ventana |
| Incidentes | Alertas `SERVICE_DOWN` abiertas dentro de la ventana |
| Tiempo caído | Parte de cada caída que cae dentro de la ventana |
| MTTR | Duración media de las caídas ya resueltas |
| Peticiones totales | Promedio de peticiones/min × minutos de la ventana (estimación) |
| Historial de 24 h | Una celda por hora. Muestra el peor estado de esa hora: caída > degradada > disponible |
| Series | `date_bin` de PostgreSQL con unas 120 muestras por serie: promedios, y máximo para p95 |
| Disponibilidad diaria | 30 días en `BUSINESS_TIME_ZONE`. El objetivo marcado es 99.5 % |

Rendimiento: el resumen usa un número fijo de consultas sin importar cuántos proyectos haya (agregaciones y `DISTINCT ON`). Una prueba lo limita a 20 consultas.

## Endpoints (`/api/v1/`)

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `monitoring/projects/` | personal (alcance por proyecto) | Totales y todos los proyectos visibles no archivados, con entornos, disponibilidad, historial de 24 h, últimas métricas y alertas |
| GET | `monitoring/projects/{id}/?hours=1..720&environment=` | personal | Detalle, estadísticas de la ventana, series y disponibilidad diaria |
| GET | `alerts/` | personal | Filtros `status` (`ACTIVE`, `OPEN`, `ACKNOWLEDGED`, `RESOLVED`), `project`, `environment`, `kind`, `severity`, `search` |
| GET | `alerts/summary/` | personal | Abiertas, reconocidas, críticas, nuevas en 24 h, resueltas en 7 días y MTTR de 7 días |
| POST | `alerts/{id}/acknowledge/` · `alerts/{id}/resolve/` | editor del proyecto | Acciones manuales |
| POST | `integrations/metrics/` | token de servicio | Ingesta |

Los clientes reciben 403, y un proyecto o una alerta ajenos devuelven 404.

## Frontend

- **Menú.** Nuevas entradas en *Operación*: **Métricas** y **Alertas**.
- **En vivo.** Las tres páginas se refrescan cada 10 s y muestran un indicador «En vivo · actualizado hace…». Se pueden pausar, y TanStack Query también deja de refrescar en pestañas ocultas.
- **Accesibilidad.** Los estados llevan siempre icono y texto. Las gráficas tienen tooltip, leyenda cuando muestran más de una serie y un solo eje Y por gráfica. Los colores son los de la paleta validada (`--series-1/2` y los de estado).

## Datos de demostración

```bash
docker compose stop monitor                         # el worker sobrescribiría los estados simulados
docker compose exec backend python manage.py seed_demo
```

El comando solo corre con `DEBUG=true` (o con `--force`) y se niega a ejecutarse si los datos ya existen. Crea:

- 2 desarrolladores y una clienta. La contraseña es `Demo-DevHub-2026!`.
- 3 organizaciones y 3 servidores.
- 8 proyectos con entornos, despliegues y eventos.
- 30 días de health checks y de métricas.
- Alertas abiertas, reconocidas y resueltas.
- Un token de servicio, acceso al portal y datos comerciales.

Las URLs son ficticias (`*.demo.devhub.test`).

## Verificación

- Backend: `pytest` da 399 pruebas en verde, 29 de ellas nuevas en `tests/test_metrics.py`. `ruff` está limpio y `spectacular --validate --fail-on-warn` no da errores.
- Frontend: Vitest da 102 pruebas en verde, 6 de ellas nuevas en `metrics.test.tsx`. `eslint`, `tsc` y `vite build` pasan.
