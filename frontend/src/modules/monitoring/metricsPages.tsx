import { Activity, ArrowLeft, Bell, BellRing, CheckCheck, CircleCheck, CircleX, Clock, Cpu, FolderKanban, Gauge, MemoryStick, Timer, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { DataTable, Pagination, SearchInput, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { useDebounce } from "@/hooks/useDebounce";
import { kindTone } from "@/modules/infrastructure/constants";
import { ApiError } from "@/services/http";
import { cn } from "@/utils/cn";
import { formatDateTime, formatRelative } from "@/utils/format";
import { errorMessage } from "@/utils/forms";

import { HealthBadge } from "./components";
import type { AlertListParams, EnvironmentMetrics, LatestMetrics, MonitoringAlert, ProjectMetrics } from "./metricsApi";
import {
  AlertCount,
  AlertStatusBadge,
  DailyUptimeChart,
  HistoryLegend,
  HistoryStrip,
  LiveIndicator,
  Meter,
  MetricChart,
  ResponseSeriesChart,
  Segmented,
  SeverityBadge,
  StatTile,
} from "./metricsComponents";
import { duration, num, pct } from "./metricsFormat";
import { useAlertAction, useAlerts, useAlertSummary, useMetricsOverview, useProjectMetrics } from "./metricsHooks";

function useLive() {
  const [live, setLive] = useState(true);
  return { live, toggle: () => setLive((v) => !v) };
}

const uptimeTone = (v: number | null) => (v === null ? undefined : v < 0.95 ? "danger" : v < 0.995 ? "warning" : undefined);

// --- overview: all projects -----------------------------------------------------------

type Filter = "ALL" | "ISSUES" | "DOWN";

export function MetricsOverviewPage() {
  const navigate = useNavigate();
  const { live, toggle } = useLive();
  const overview = useMetricsOverview(live);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const debounced = useDebounce(search).trim().toLowerCase();
  const data = overview.data;
  const t = data?.totals;

  const rows = useMemo(() => {
    let list = data?.projects ?? [];
    if (debounced) list = list.filter((p) => p.name.toLowerCase().includes(debounced));
    if (filter === "DOWN") list = list.filter((p) => p.pages_down > 0);
    if (filter === "ISSUES") list = list.filter((p) => p.pages_down > 0 || p.open_alerts > 0 || p.status === "DEGRADED");
    return list;
  }, [data, debounced, filter]);

  const primaryEnv = (p: ProjectMetrics): EnvironmentMetrics | undefined => p.environments.find((e) => e.id === p.primary_environment);

  const columns: Column<ProjectMetrics>[] = [
    {
      key: "project",
      header: "Proyecto",
      cell: (p) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap font-medium text-fg">{p.name}</p>
          <div className="mt-1 flex gap-1">
            {p.environments.length === 0 ? (
              <span className="text-xs text-muted">Sin monitoreo configurado</span>
            ) : (
              p.environments.map((e) => (
                <Badge key={e.id} tone={kindTone(e.kind)} className={cn(e.status === "UNAVAILABLE" && "ring-1 ring-red-400")}>
                  {e.label}
                </Badge>
              ))
            )}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (p) => (
        <div className="space-y-1">
          {p.environments.length ? <HealthBadge status={p.status} label={p.status_label} /> : <Badge>Sin monitoreo</Badge>}
          <p className="whitespace-nowrap text-xs text-muted">{p.last_update ? formatRelative(p.last_update) : "Sin datos"}</p>
        </div>
      ),
    },
    { key: "history", header: "Últimas 24 h", hideOnMobile: true, cell: (p) => <HistoryStrip cells={primaryEnv(p)?.history_24h ?? []} /> },
    {
      key: "uptime",
      header: "Disponibilidad / resp.",
      cell: (p) => (
        <div className="whitespace-nowrap tabular-nums">
          <p className={cn("text-fg", uptimeTone(p.uptime_24h) === "danger" && "text-red-600 dark:text-red-400")}>{pct(p.uptime_24h, 2)}</p>
          <p className="text-xs text-muted">
            7 d: {pct(p.uptime_7d, 2)} · {num(p.last_response_ms, " ms")}
          </p>
        </div>
      ),
    },
    {
      key: "resources",
      header: "CPU / memoria",
      hideOnMobile: true,
      cell: (p) =>
        p.metrics ? (
          <div className="space-y-1 text-xs">
            <Meter value={p.metrics.cpu_percent} label="CPU" />
            <Meter value={p.metrics.memory_percent} label="Memoria" />
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "traffic",
      header: "Tráfico",
      hideOnMobile: true,
      cell: (p) => (
        <div className="whitespace-nowrap tabular-nums">
          <p className="text-fg">{num(p.metrics?.requests_per_minute, " req/min")}</p>
          <p className={cn("text-xs text-muted", (p.metrics?.error_rate_percent ?? 0) >= 5 && "font-medium text-red-600 dark:text-red-400")}>
            {num(p.metrics?.error_rate_percent, " % errores", 2)}
          </p>
        </div>
      ),
    },
    { key: "alerts", header: "Alertas", cell: (p) => <AlertCount count={p.open_alerts} severity={p.alert_severity} /> },
  ];

  return (
    <>
      <PageHeader
        title="Métricas de aplicaciones"
        description="Todos los proyectos con su disponibilidad, métricas internas reportadas por cada aplicación y alertas activas."
        actions={<LiveIndicator live={live} onToggle={toggle} updatedAt={overview.dataUpdatedAt || undefined} fetching={overview.isFetching} />}
      />
      {overview.isError && !data ? (
        <Card>
          <ErrorState message={overview.error.message} onRetry={() => void overview.refetch()} />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Proyectos monitoreados" icon={<FolderKanban className="size-4 text-muted" aria-hidden />} value={t ? `${t.monitored_projects}/${t.projects}` : "–"} hint={t ? `${t.reporting_metrics} reportando métricas` : undefined} />
            <StatTile label="Páginas activas" icon={<CircleCheck className="size-4" style={{ color: "var(--chart-success)" }} aria-hidden />} value={t ? `${t.pages_up}/${t.pages}` : "–"} hint={t?.pages_degraded ? `${t.pages_degraded} degradada(s)` : "Responden correctamente"} />
            <StatTile label="Páginas caídas" tone={t?.pages_down ? "danger" : undefined} icon={<CircleX className="size-4" style={{ color: "var(--chart-failed)" }} aria-hidden />} value={t?.pages_down ?? "–"} hint={t?.pages_down ? "Requieren atención" : "Todas responden"} />
            <StatTile label="Alertas abiertas" tone={t?.critical_alerts ? "danger" : t?.open_alerts ? "warning" : undefined} icon={<BellRing className="size-4 text-muted" aria-hidden />} value={t?.open_alerts ?? "–"} hint={t ? `${t.critical_alerts} crítica(s)` : undefined} />
            <StatTile label="Disponibilidad 24 h" tone={uptimeTone(t?.avg_uptime_24h ?? null)} icon={<Activity className="size-4 text-muted" aria-hidden />} value={pct(t?.avg_uptime_24h, 2)} hint="Promedio de todas las páginas" />
            <StatTile label="Última actualización" icon={<Clock className="size-4 text-muted" aria-hidden />} value={<span className="text-lg">{t?.last_update ? formatRelative(t.last_update) : "—"}</span>} hint={t?.last_update ? formatDateTime(t.last_update) : undefined} />
          </div>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <SearchInput value={search} onChange={setSearch} placeholder="Buscar proyecto…" className="w-64" />
                <Segmented<Filter>
                  label="Filtro"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "ALL", label: "Todos" },
                    { value: "ISSUES", label: "Con incidencias" },
                    { value: "DOWN", label: "Caídos" },
                  ]}
                />
              </div>
              <HistoryLegend />
            </div>
            <DataTable
              caption="Métricas por proyecto"
              columns={columns}
              rows={data ? rows : undefined}
              rowKey={(p) => p.id}
              loading={overview.isPending}
              onRowClick={(p) => navigate(`/admin/metrics/${p.id}`)}
              empty={<EmptyState icon={<Gauge className="size-5" />} title="Sin proyectos" description="No hay proyectos que coincidan con el filtro." />}
            />
          </Card>
        </>
      )}
    </>
  );
}

// --- project detail: live values, history and statistics ------------------------------

const WINDOWS = [
  { value: 1, label: "1 h" },
  { value: 24, label: "24 h" },
  { value: 168, label: "7 días" },
  { value: 720, label: "30 días" },
];

function LivePanel({ m }: { m: LatestMetrics | null }) {
  if (!m) {
    return (
      <EmptyState
        icon={<Cpu className="size-5" />}
        title="Esta aplicación no reporta métricas internas"
        description="Configura el agente con un token de servicio: POST /api/v1/integrations/metrics/ (ver docs/phase-8.md)."
      />
    );
  }
  const items: { label: string; value: string; sub?: string; icon?: React.ReactNode }[] = [
    { label: "CPU", value: num(m.cpu_percent, " %", 1), icon: <Cpu className="size-4 text-muted" /> },
    { label: "Memoria", value: num(m.memory_percent, " %", 1), sub: m.memory_used_mb !== null ? num(m.memory_used_mb, " MB") : undefined, icon: <MemoryStick className="size-4 text-muted" /> },
    { label: "Peticiones/min", value: num(m.requests_per_minute) },
    { label: "Tasa de errores", value: num(m.error_rate_percent, " %", 2) },
    { label: "Latencia p95", value: num(m.latency_p95_ms, " ms") },
    { label: "Conexiones activas", value: num(m.active_connections) },
    { label: "Proceso activo", value: duration(m.process_uptime_seconds), icon: <Timer className="size-4 text-muted" /> },
  ];
  return (
    <div>
      {m.is_stale && (
        <div className="mb-3">
          <Alert tone="info">La aplicación dejó de reportar: último dato {formatRelative(m.recorded_at)}.</Alert>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
        {items.map(({ label, value, sub, icon }) => (
          <div key={label}>
            <dt className="flex items-center gap-1.5 text-xs text-muted">
              {icon}
              {label}
            </dt>
            <dd className="mt-0.5 whitespace-nowrap text-lg font-semibold tabular-nums text-fg">{value}</dd>
            {sub && <dd className="text-xs text-muted">{sub}</dd>}
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">Último reporte: {formatDateTime(m.recorded_at)}</p>
    </div>
  );
}

export function ProjectMetricsPage() {
  const { id = "" } = useParams();
  const { live, toggle } = useLive();
  const [hours, setHours] = useState(24);
  const [environment, setEnvironment] = useState<string | undefined>();
  const q = useProjectMetrics(id, { hours, environment }, live);

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Card>
        <ErrorState title={notFound ? "Proyecto no encontrado" : "No se pudo cargar"} message={notFound ? undefined : q.error.message} onRetry={notFound ? undefined : () => void q.refetch()} />
      </Card>
    );
  }
  const d = q.data;
  const selected = d.environments.find((e) => e.id === d.selected_environment);
  const s = d.statistics;
  const windowLabel = WINDOWS.find((w) => w.value === hours)?.label ?? `${hours} h`;

  return (
    <>
      <Link to="/admin/metrics" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Métricas
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {d.name}
            {d.environments.length > 0 && <HealthBadge status={d.status} label={d.status_label} />}
          </span>
        }
        description="Monitoreo en tiempo real, historial y estadísticas del proyecto."
        actions={<LiveIndicator live={live} onToggle={toggle} updatedAt={q.dataUpdatedAt || undefined} fetching={q.isFetching} />}
      />
      {d.environments.length === 0 ? (
        <Card>
          <EmptyState icon={<Activity className="size-5" />} title="Proyecto sin monitoreo" description="Crea un health check o configura el agente de métricas para alguno de sus entornos." />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented<string>
              label="Entorno"
              value={d.selected_environment ?? ""}
              onChange={(v) => setEnvironment(v)}
              options={d.environments.map((e) => ({ value: e.id, label: e.label }))}
            />
            <Segmented<number> label="Ventana" value={hours} onChange={setHours} options={WINDOWS} />
          </div>

          {d.open_alerts > 0 && (
            <Alert>
              {d.open_alerts} alerta(s) activa(s) en este proyecto. <a href="#alertas" className="font-medium underline">Ver alertas</a>
            </Alert>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            {d.environments.map((e) => (
              <Card key={e.id} className={cn("p-4", e.id === d.selected_environment && "ring-2 ring-[var(--accent)]")}>
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={kindTone(e.kind)}>{e.label}</Badge>
                  <HealthBadge status={e.status} label={e.status_label} stale={e.is_stale} />
                </div>
                <p className="mt-2 truncate font-mono text-xs text-muted">{e.public_url || "—"}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  {(["uptime_24h", "uptime_7d", "uptime_30d"] as const).map((k, i) => (
                    <div key={k} className="rounded-lg bg-surface-2 px-1 py-1.5">
                      <p className="font-semibold tabular-nums text-fg">{pct(e[k], 2)}</p>
                      <p className="text-muted">{["24 h", "7 d", "30 d"][i]}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3"><HistoryStrip cells={e.history_24h} /></div>
                <p className="mt-2 text-xs text-muted">Actualizado {e.last_update ? formatRelative(e.last_update) : "nunca"}{e.server_name ? ` · ${e.server_name}` : ""}</p>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <span className="relative flex size-2">
                    {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                  </span>
                  Tiempo real · {selected?.label}
                </span>
              }
              description="Último valor reportado por la aplicación."
              actions={selected?.health_check && <Link className="text-sm text-accent hover:underline" to={`/admin/monitoring/${selected.health_check}`}>Ver health check</Link>}
            />
            <CardBody>
              <LivePanel m={selected?.metrics ?? null} />
            </CardBody>
          </Card>

          {s && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-fg">Estadísticas · últimas {windowLabel}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <StatTile label="Disponibilidad" tone={uptimeTone(s.uptime)} value={pct(s.uptime, 2)} hint={`${s.checks} verificaciones · ${s.failures} fallidas`} />
                <StatTile label="Respuesta promedio" value={num(s.avg_response_ms, " ms")} hint={`p95 ${num(s.p95_response_ms, " ms")} · máx. ${num(s.max_response_ms, " ms")}`} />
                <StatTile label="Incidentes" tone={s.incidents ? "danger" : undefined} value={s.incidents} hint={`${s.alerts} alerta(s) en total`} />
                <StatTile label="Tiempo caído" tone={s.downtime_seconds ? "warning" : undefined} value={duration(s.downtime_seconds)} hint={`MTTR ${duration(s.mttr_seconds)} · mayor ${duration(s.longest_outage_seconds)}`} />
                <StatTile label="Peticiones" value={num(s.total_requests)} hint={`${num(s.avg_requests_per_minute, " req/min")} · ${num(s.avg_error_rate_percent, " % errores", 2)}`} />
                <StatTile label="CPU promedio" value={num(s.avg_cpu_percent, " %", 1)} hint={`Pico ${num(s.max_cpu_percent, " %", 1)}`} />
                <StatTile label="Memoria promedio" value={num(s.avg_memory_percent, " %", 1)} hint={`Pico ${num(s.max_memory_percent, " %", 1)}`} />
                <StatTile label="Verificaciones degradadas" value={s.degraded} hint="Lentas o primer fallo" />
                <StatTile label="Disponibilidad 7 días" value={pct(selected?.uptime_7d, 2)} />
                <StatTile label="Disponibilidad 30 días" value={pct(selected?.uptime_30d, 2)} />
              </div>
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="CPU y memoria" description="Uso promedio por intervalo (%)." empty={!d.metric_series.length}>
              <MetricChart
                data={d.metric_series}
                hours={hours}
                unit=" %"
                domain={[0, 100]}
                series={[
                  { key: "cpu_percent", label: "CPU", color: "var(--series-1)" },
                  { key: "memory_percent", label: "Memoria", color: "var(--series-2)" },
                ]}
                threshold={{ value: 85, label: "Umbral 85 %" }}
              />
            </ChartCard>
            <ChartCard title="Peticiones por minuto" description="Tráfico atendido por la aplicación." empty={!d.metric_series.length}>
              <MetricChart data={d.metric_series} hours={hours} unit="" series={[{ key: "requests_per_minute", label: "Peticiones/min", color: "var(--series-1)" }]} />
            </ChartCard>
            <ChartCard title="Tasa de errores" description="Porcentaje de respuestas 5xx." empty={!d.metric_series.length}>
              <MetricChart data={d.metric_series} hours={hours} unit=" %" series={[{ key: "error_rate_percent", label: "Errores", color: "var(--series-2)" }]} threshold={{ value: 5, label: "Umbral 5 %" }} />
            </ChartCard>
            <ChartCard title="Latencia p95 interna" description="Percentil 95 medido por la aplicación (máximo por intervalo)." empty={!d.metric_series.length}>
              <MetricChart data={d.metric_series} hours={hours} unit=" ms" series={[{ key: "latency_p95_ms", label: "p95", color: "var(--series-1)" }]} threshold={{ value: 1500, label: "Umbral 1500 ms" }} />
            </ChartCard>
            <ChartCard title="Tiempo de respuesta externo" description="Health check desde DevHub. Los puntos marcan intervalos degradados o caídos." empty={!d.response_series.length}>
              <ResponseSeriesChart data={d.response_series} hours={hours} />
            </ChartCard>
            <ChartCard title="Disponibilidad diaria" description="Últimos 30 días." empty={!d.daily_uptime.some((x) => x.uptime !== null)}>
              <DailyUptimeChart data={d.daily_uptime} />
            </ChartCard>
          </div>

          <div id="alertas">
            <AlertsTable params={{ project: d.id, page_size: 10 }} title="Alertas del proyecto" live={live} hideProject />
          </div>
        </div>
      )}
    </>
  );
}

function ChartCard({ title, description, empty, children }: { title: string; description: string; empty: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>{empty ? <EmptyState icon={<Activity className="size-5" />} title="Sin datos en esta ventana" /> : children}</CardBody>
    </Card>
  );
}

// --- alerts ---------------------------------------------------------------------------

function AlertActions({ alert }: { alert: MonitoringAlert }) {
  const action = useAlertAction();
  const toast = useToast();
  if (!alert.can_edit || alert.status === "RESOLVED") return null;
  const run = (kind: "acknowledge" | "resolve") =>
    action.mutate(
      { id: alert.id, action: kind },
      {
        onSuccess: () => toast.success(kind === "acknowledge" ? "Alerta reconocida" : "Alerta resuelta", alert.kind_label),
        onError: (e) => toast.error("No se pudo actualizar la alerta", errorMessage(e)),
      },
    );
  return (
    <div className="flex justify-end gap-2">
      {alert.status === "OPEN" && (
        <Button size="sm" variant="outline" loading={action.isPending && action.variables?.action === "acknowledge"} onClick={(e) => (e.stopPropagation(), run("acknowledge"))}>
          Reconocer
        </Button>
      )}
      <Button size="sm" variant="outline" icon={<CheckCheck className="size-3.5" />} loading={action.isPending && action.variables?.action === "resolve"} onClick={(e) => (e.stopPropagation(), run("resolve"))}>
        Resolver
      </Button>
    </div>
  );
}

function AlertsTable({ params, title, live, hideProject = false }: { params: AlertListParams; title?: string; live: boolean; hideProject?: boolean }) {
  const [page, setPage] = useState(1);
  const pageSize = params.page_size ?? 20;
  const alerts = useAlerts({ ...params, page, page_size: pageSize }, live);
  const columns: Column<MonitoringAlert>[] = [
    { key: "sev", header: "Severidad", cell: (a) => <SeverityBadge severity={a.severity} /> },
    {
      key: "alert",
      header: "Alerta",
      cell: (a) => (
        <div className="min-w-52 max-w-sm">
          <p className="font-medium text-fg">{a.kind_label}</p>
          <p className="text-xs text-muted">{a.message}</p>
        </div>
      ),
    },
    ...(hideProject
      ? []
      : [
          {
            key: "project",
            header: "Proyecto",
            cell: (a: MonitoringAlert) => (
              <div className="whitespace-nowrap">
                <p className="text-fg">{a.project_name}</p>
                <Badge tone={kindTone(a.environment_kind)} className="mt-1">
                  {a.environment_label}
                </Badge>
              </div>
            ),
          },
        ]),
    { key: "status", header: "Estado", cell: (a) => <AlertStatusBadge status={a.status} /> },
    {
      key: "opened",
      header: "Abierta",
      hideOnMobile: true,
      cell: (a) => (
        <div className="whitespace-nowrap text-xs">
          <p className="text-fg" title={formatDateTime(a.opened_at)}>
            {formatRelative(a.opened_at)}
          </p>
          <p className="text-muted">
            {a.status === "RESOLVED" ? "Duró" : "Lleva"} {duration(a.duration_seconds)} · {a.hits} detección(es)
          </p>
        </div>
      ),
    },
    { key: "actions", header: <span className="sr-only">Acciones</span>, className: "text-right", cell: (a) => <AlertActions alert={a} /> },
  ];
  return (
    <Card>
      {title && <CardHeader title={title} />}
      <DataTable
        caption={title ?? "Alertas"}
        columns={columns}
        rows={alerts.data?.results}
        rowKey={(a) => a.id}
        loading={alerts.isPending}
        error={alerts.error}
        onRetry={() => void alerts.refetch()}
        empty={<EmptyState icon={<Bell className="size-5" />} title="Sin alertas" description="No hay alertas con este filtro." />}
      />
      {alerts.data && alerts.data.count > pageSize && <Pagination page={page} pageSize={pageSize} count={alerts.data.count} onPageChange={setPage} />}
    </Card>
  );
}

type StatusFilter = "ACTIVE" | "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "ALL";

export function AlertsPage() {
  const { live, toggle } = useLive();
  const summary = useAlertSummary(live);
  const [status, setStatus] = useState<StatusFilter>("ACTIVE");
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search);
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Alertas"
        description="Caídas, degradación y umbrales de métricas internas. Se resuelven solas cuando la condición desaparece."
        actions={<LiveIndicator live={live} onToggle={toggle} updatedAt={summary.dataUpdatedAt || undefined} fetching={summary.isFetching} />}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Abiertas" tone={s?.open ? "warning" : undefined} icon={<Bell className="size-4 text-muted" aria-hidden />} value={s?.open ?? "–"} />
        <StatTile label="Críticas" tone={s?.critical ? "danger" : undefined} icon={<BellRing className="size-4 text-muted" aria-hidden />} value={s?.critical ?? "–"} hint="Activas" />
        <StatTile label="Reconocidas" icon={<TriangleAlert className="size-4 text-muted" aria-hidden />} value={s?.acknowledged ?? "–"} hint="En atención" />
        <StatTile label="Nuevas 24 h" value={s?.opened_24h ?? "–"} />
        <StatTile label="Resueltas 7 días" icon={<CheckCheck className="size-4 text-muted" aria-hidden />} value={s?.resolved_7d ?? "–"} />
        <StatTile label="MTTR 7 días" icon={<Timer className="size-4 text-muted" aria-hidden />} value={duration(s?.mttr_seconds_7d)} hint="Tiempo medio de resolución" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<StatusFilter>
          label="Estado"
          value={status}
          onChange={setStatus}
          options={[
            { value: "ACTIVE", label: "Activas" },
            { value: "OPEN", label: "Abiertas" },
            { value: "ACKNOWLEDGED", label: "Reconocidas" },
            { value: "RESOLVED", label: "Resueltas" },
            { value: "ALL", label: "Todas" },
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por proyecto o mensaje…" className="w-72" />
      </div>
      <AlertsTable key={`${status}-${debounced}`} live={live} params={{ status: status === "ALL" ? undefined : status, search: debounced || undefined }} />
    </>
  );
}
