import { GitCommitHorizontal, Plus, Rocket } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { DataTable, Pagination, SearchInput, type Column } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";
import type { EnvironmentKind } from "@/modules/infrastructure/api";
import { ENVIRONMENT_KINDS, kindTone } from "@/modules/infrastructure/constants";
import { useProjects } from "@/modules/projects/hooks";
import { formatRelative } from "@/utils/format";

import type { Deployment, DeploymentSource, DeploymentStatus } from "../api";
import { DeploymentsChart } from "../components/DeploymentsChart";
import { RegisterDeploymentDialog } from "../components/DeploymentDialogs";
import { DEPLOYMENT_SOURCE, DEPLOYMENT_STATUS, DEPLOYMENT_STATUS_OPTIONS, formatDuration } from "../constants";
import { useDeployments } from "../hooks";

const PAGE_SIZE = 20;
const startOfDay = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

export function DeploymentsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [kind, setKind] = useState<EnvironmentKind | "">("");
  const [status, setStatus] = useState<DeploymentStatus | "">("");
  const [source, setSource] = useState<DeploymentSource | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [registering, setRegistering] = useState(false);
  const debounced = useDebounce(search);
  const projects = useProjects({ page_size: 100 });
  const deployments = useDeployments({
    page,
    page_size: PAGE_SIZE,
    search: debounced || undefined,
    project: project || undefined,
    kind: kind || undefined,
    status: status || undefined,
    source: source || undefined,
    created_from: startOfDay(from),
    created_to: endOfDay(to),
  });
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };
  const filtered = Boolean(debounced || project || kind || status || source || from || to);

  const columns: Column<Deployment>[] = [
    {
      key: "version",
      header: "Versión",
      cell: (d) => (
        <div className="min-w-0">
          <p className="font-mono font-medium text-fg">{d.version}</p>
          {d.commit_sha && (
            <p className="flex items-center gap-1 font-mono text-xs text-muted">
              <GitCommitHorizontal className="size-3.5" />
              {d.commit_sha.slice(0, 7)}
              {d.branch && <span className="truncate">· {d.branch}</span>}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "project",
      header: "Proyecto",
      cell: (d) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link to={`/admin/projects/${d.project}`} onClick={(e) => e.stopPropagation()} className="font-medium text-fg hover:text-accent">
            {d.project_name}
          </Link>
          <Badge tone={kindTone(d.environment_kind)}>{d.environment_label}</Badge>
        </div>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (d) => (
        <Badge tone={DEPLOYMENT_STATUS[d.status].tone} dot>
          {d.status_label}
        </Badge>
      ),
    },
    {
      key: "source",
      header: "Origen",
      hideOnMobile: true,
      cell: (d) => (
        <span className="text-muted">
          {d.source_label}
          {d.triggered_by_label && <span className="block truncate text-xs">{d.triggered_by_label}</span>}
        </span>
      ),
    },
    { key: "duration", header: "Duración", hideOnMobile: true, cell: (d) => <span className="tabular-nums text-muted">{formatDuration(d.duration_seconds)}</span> },
    { key: "when", header: "Registrado", hideOnMobile: true, cell: (d) => <span className="text-muted">{formatRelative(d.created_at)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Despliegues"
        description="Historial de versiones por entorno, registrado manualmente o desde GitHub Actions."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setRegistering(true)}>
            Registrar despliegue
          </Button>
        }
      />
      <div className="mb-6">
        <DeploymentsChart project={project || undefined} />
      </div>
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={search} onChange={reset(setSearch)} placeholder="Versión, commit, rama o proyecto…" className="sm:col-span-2" />
          <Select value={project} onChange={(e) => reset(setProject)(e.target.value)} aria-label="Filtrar por proyecto">
            <option value="">Todos los proyectos</option>
            {projects.data?.results.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select value={kind} onChange={(e) => reset(setKind)(e.target.value as EnvironmentKind | "")} aria-label="Filtrar por entorno">
            <option value="">Todos los entornos</option>
            {ENVIRONMENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => reset(setStatus)(e.target.value as DeploymentStatus | "")} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            {DEPLOYMENT_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select value={source} onChange={(e) => reset(setSource)(e.target.value as DeploymentSource | "")} aria-label="Filtrar por origen">
            <option value="">Todos los orígenes</option>
            {(Object.keys(DEPLOYMENT_SOURCE) as DeploymentSource[]).map((s) => (
              <option key={s} value={s}>
                {DEPLOYMENT_SOURCE[s]}
              </option>
            ))}
          </Select>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="Desde" />
          <Input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} aria-label="Hasta" />
        </div>
        <DataTable
          caption="Despliegues"
          columns={columns}
          rows={deployments.data?.results}
          rowKey={(d) => d.id}
          loading={deployments.isPending}
          error={deployments.error}
          onRetry={() => void deployments.refetch()}
          onRowClick={(d) => navigate(`/admin/deployments/${d.id}`)}
          empty={
            <EmptyState
              icon={<Rocket className="size-5" />}
              title={filtered ? "Sin coincidencias" : "Aún no hay despliegues"}
              description={
                filtered ? "Prueba con otros filtros." : "Registra uno manualmente o conecta GitHub Actions desde Configuración → Integraciones."
              }
            />
          }
        />
        {deployments.data && deployments.data.count > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} count={deployments.data.count} onPageChange={setPage} />
        )}
      </Card>
      <RegisterDeploymentDialog open={registering} onClose={() => setRegistering(false)} onCreated={(d) => navigate(`/admin/deployments/${d.id}`)} />
    </>
  );
}
