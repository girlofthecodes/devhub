import { Activity, ArrowLeft, Pencil, Play, Plus } from "lucide-react";
import { useState } from "react";
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

import type { CheckResult, HealthCheck, HealthStatus } from "./api";
import { HealthBadge, HealthCheckDialog, ResponseTimeChart } from "./components";
import { HEALTH } from "./constants";
import { useCheckResults, useHealthCheck, useHealthChecks, useMonitoringSummary, useRunHealthCheck } from "./hooks";

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(v === 1 ? 0 : 1)} %`);
const PAGE_SIZE = 20;

function RunButton({ check, size = "sm" }: { check: HealthCheck; size?: "sm" | "md" }) {
  const run = useRunHealthCheck();
  const toast = useToast();
  return (
    <Button
      size={size}
      variant="outline"
      icon={<Play className="size-3.5" />}
      loading={run.isPending}
      disabled={!check.enabled}
      onClick={(e) => {
        e.stopPropagation();
        run.mutate(check.id, {
          onSuccess: (c) => toast.success("Verificación ejecutada", `${c.effective_status_label}${c.last_response_ms ? ` · ${c.last_response_ms} ms` : ""}`),
          onError: (err) => toast.error("No se pudo verificar", errorMessage(err)),
        });
      }}
    >
      Verificar ahora
    </Button>
  );
}

function Kpi({ status, value, label }: { status: HealthStatus | "STALE"; value: number | undefined; label: string }) {
  const meta = status === "STALE" ? HEALTH.UNKNOWN : HEALTH[status];
  const Icon = meta.icon;
  return (
    <Card className="flex items-center gap-3 p-4">
      <Icon className="size-5" style={{ color: meta.color }} aria-hidden />
      <div>
        <p className="text-2xl font-semibold tabular-nums text-fg">{value ?? "–"}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </Card>
  );
}

export function MonitoringPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search);
  const summary = useMonitoringSummary();
  const checks = useHealthChecks({ page, page_size: PAGE_SIZE, search: debounced || undefined });
  const s = summary.data;

  const columns: Column<HealthCheck>[] = [
    {
      key: "target",
      header: "Servicio",
      cell: (c) => (
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-fg">
            {c.project_name} <Badge tone={kindTone(c.environment_kind)}>{c.environment_label}</Badge>
          </p>
          <p className="truncate font-mono text-xs text-muted">{c.target_url}</p>
        </div>
      ),
    },
    { key: "status", header: "Estado", cell: (c) => <HealthBadge status={c.effective_status} label={c.effective_status_label} stale={c.is_stale} /> },
    {
      key: "latency",
      header: "Respuesta",
      cell: (c) => <span className="tabular-nums text-muted">{c.last_response_ms !== null ? `${c.last_response_ms} ms` : "—"}</span>,
    },
    { key: "uptime", header: "Disp. 24 h", hideOnMobile: true, cell: (c) => <span className="tabular-nums">{pct(c.uptime_24h)}</span> },
    {
      key: "checked",
      header: "Última verificación",
      hideOnMobile: true,
      cell: (c) => <span className={cn("text-muted", c.is_stale && "text-amber-600")}>{c.last_checked_at ? formatRelative(c.last_checked_at) : "Nunca"}</span>,
    },
    { key: "run", header: <span className="sr-only">Acciones</span>, className: "text-right", cell: (c) => c.can_edit && <RunButton check={c} /> },
  ];

  return (
    <>
      <PageHeader
        title="Monitoreo"
        description="Disponibilidad de los entornos según verificaciones periódicas reales. Sin datos recientes se muestra como desactualizado, nunca como disponible."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nuevo health check
          </Button>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi status="HEALTHY" value={s?.by_status.HEALTHY} label="Disponibles" />
        <Kpi status="DEGRADED" value={s?.by_status.DEGRADED} label="Degradados" />
        <Kpi status="UNAVAILABLE" value={s?.by_status.UNAVAILABLE} label="No disponibles" />
        <Kpi status="UNKNOWN" value={s?.by_status.UNKNOWN} label={`Sin datos${s?.stale ? ` (${s.stale} desactualizados)` : ""}`} />
        <Kpi status="STALE" value={s?.environments_without_check} label="Entornos sin monitoreo" />
      </div>
      <Card>
        <div className="border-b border-border p-4">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Buscar por proyecto o URL…"
            className="max-w-md"
          />
        </div>
        <DataTable
          caption="Health checks"
          columns={columns}
          rows={checks.data?.results}
          rowKey={(c) => c.id}
          loading={checks.isPending}
          error={checks.error}
          onRetry={() => void checks.refetch()}
          onRowClick={(c) => navigate(`/admin/monitoring/${c.id}`)}
          empty={
            <EmptyState
              icon={<Activity className="size-5" />}
              title="Sin health checks"
              description="Configura uno para cada entorno con URL pública: el monitor lo verificará periódicamente."
            />
          }
        />
        {checks.data && checks.data.count > PAGE_SIZE && (
          <Pagination page={page} pageSize={PAGE_SIZE} count={checks.data.count} onPageChange={setPage} />
        )}
      </Card>
      {creating && <HealthCheckDialog onClose={() => setCreating(false)} />}
    </>
  );
}

export function HealthCheckDetailPage() {
  const { id = "" } = useParams();
  const check = useHealthCheck(id);
  const [hours, setHours] = useState(24);
  const results = useCheckResults(id, hours);
  const [editing, setEditing] = useState(false);

  if (check.isPending) return <Skeleton className="h-64" />;
  if (check.isError) {
    const notFound = check.error instanceof ApiError && check.error.status === 404;
    return (
      <Card>
        <ErrorState
          title={notFound ? "Health check no encontrado" : "No se pudo cargar"}
          message={notFound ? undefined : check.error.message}
          onRetry={notFound ? undefined : () => void check.refetch()}
        />
      </Card>
    );
  }
  const c = check.data;
  const recent: CheckResult[] = [...(results.data ?? [])].reverse().slice(0, 30);
  const info: [string, React.ReactNode][] = [
    ["URL", <span key="u" className="break-all font-mono">{c.target_url}</span>],
    ["Servidor", c.server_name ?? "—"],
    ["Intervalo", `${c.interval_seconds} s · timeout ${c.timeout_seconds} s`],
    ["Esperado", `HTTP ${c.expected_status_min}–${c.expected_status_max} · lento > ${c.degraded_threshold_ms} ms`],
    ["Caída tras", `${c.failure_threshold} fallo(s) consecutivo(s)`],
    ["Última verificación", c.last_checked_at ? formatDateTime(c.last_checked_at) : "Nunca"],
    ["Último cambio de estado", c.status_changed_at ? formatDateTime(c.status_changed_at) : "—"],
  ];
  return (
    <>
      <Link to="/admin/monitoring" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Monitoreo
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.project_name} · {c.environment_label}
            <HealthBadge status={c.effective_status} label={c.effective_status_label} stale={c.is_stale} />
          </span>
        }
        description={<span className="font-mono">{c.target_url}</span>}
        actions={
          c.can_edit && (
            <>
              <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Editar
              </Button>
              <RunButton check={c} size="md" />
            </>
          )
        }
      />
      {c.is_stale && (
        <div className="mb-6">
          <Alert tone="info">
            La última verificación es de {formatRelative(c.last_checked_at)}. El estado se muestra como desconocido hasta que el monitor vuelva a
            reportar (revisa el contenedor <code className="font-mono">monitor</code>).
          </Alert>
        </div>
      )}
      {c.last_error && !c.is_stale && c.effective_status !== "HEALTHY" && (
        <div className="mb-6">
          <Alert>{c.last_error}</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-2xl font-semibold tabular-nums text-fg">{pct(c.uptime_24h)}</p>
              <p className="text-xs text-muted">Disponibilidad 24 h</p>
            </Card>
            <Card className="p-4">
              <p className="text-2xl font-semibold tabular-nums text-fg">{pct(c.uptime_7d)}</p>
              <p className="text-xs text-muted">Disponibilidad 7 días</p>
            </Card>
          </div>
          <Card>
            <CardHeader title="Configuración" />
            <CardBody>
              <dl className="space-y-3 text-sm">
                {info.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="mt-0.5 text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Tiempo de respuesta"
              description="Los puntos marcan verificaciones degradadas o fallidas."
              actions={
                <div role="radiogroup" aria-label="Ventana" className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
                  {[24, 168].map((h) => (
                    <button
                      key={h}
                      type="button"
                      role="radio"
                      aria-checked={hours === h}
                      onClick={() => setHours(h)}
                      className={cn("rounded-md px-2 py-1 text-muted hover:text-fg", hours === h && "bg-surface text-fg shadow-xs")}
                    >
                      {h === 24 ? "24 h" : "7 días"}
                    </button>
                  ))}
                </div>
              }
            />
            <CardBody>
              {results.isError ? (
                <ErrorState message={results.error.message} onRetry={() => void results.refetch()} />
              ) : results.isPending ? (
                <Skeleton className="h-56 w-full" />
              ) : results.data.length === 0 ? (
                <EmptyState icon={<Activity className="size-5" />} title="Sin verificaciones en este periodo" />
              ) : (
                <ResponseTimeChart results={results.data} />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Últimas verificaciones" />
            <DataTable
              caption="Últimas verificaciones"
              columns={[
                { key: "at", header: "Fecha", cell: (r) => <span className="text-muted">{formatDateTime(r.checked_at)}</span> },
                { key: "status", header: "Estado", cell: (r) => <HealthBadge status={r.status} /> },
                { key: "code", header: "HTTP", cell: (r) => <span className="font-mono text-xs">{r.status_code ?? "—"}</span> },
                { key: "ms", header: "Respuesta", cell: (r) => <span className="tabular-nums">{r.response_ms !== null ? `${r.response_ms} ms` : "—"}</span> },
                { key: "err", header: "Detalle", hideOnMobile: true, cell: (r) => <span className="text-xs text-muted">{r.error || "—"}</span> },
              ]}
              rows={recent}
              rowKey={(r) => r.id}
              loading={results.isPending}
              empty={<EmptyState title="Sin verificaciones" />}
            />
          </Card>
        </div>
      </div>
      {editing && <HealthCheckDialog check={c} onClose={() => setEditing(false)} />}
    </>
  );
}
