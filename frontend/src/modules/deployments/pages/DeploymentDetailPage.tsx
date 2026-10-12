import { ArrowLeft, ExternalLink, GitBranch, GitCommitHorizontal, History } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { kindTone } from "@/modules/infrastructure/constants";
import { useEvents } from "@/modules/traceability/hooks";
import { EventTimeline } from "@/modules/traceability/components/EventTimeline";
import { ApiError } from "@/services/http";
import { formatDateTime } from "@/utils/format";

import type { DeploymentStatus } from "../api";
import { TransitionDialog } from "../components/DeploymentDialogs";
import { commitUrl, DEPLOYMENT_STATUS, formatDuration, NEXT_STATUSES } from "../constants";
import { useDeployment } from "../hooks";

export function DeploymentDetailPage() {
  const { id = "" } = useParams();
  const deployment = useDeployment(id);
  const events = useEvents({ deployment: id, page_size: 100 }, Boolean(deployment.data));
  const [target, setTarget] = useState<Exclude<DeploymentStatus, "PENDING"> | null>(null);

  if (deployment.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (deployment.isError) {
    const notFound = deployment.error instanceof ApiError && deployment.error.status === 404;
    return (
      <Card>
        <ErrorState
          title={notFound ? "Despliegue no encontrado" : "No se pudo cargar el despliegue"}
          message={notFound ? "No existe o no tienes acceso a su proyecto." : deployment.error.message}
          onRetry={notFound ? undefined : () => void deployment.refetch()}
        />
      </Card>
    );
  }

  const d = deployment.data;
  const next = d.can_manage ? NEXT_STATUSES[d.status] : [];
  const commitLink = commitUrl(d.repository_url, d.commit_sha);
  const rows: [string, React.ReactNode][] = [
    ["Proyecto", <Link key="p" to={`/admin/projects/${d.project}`} className="text-accent hover:underline">{d.project_name}</Link>],
    ["Entorno", <Badge key="e" tone={kindTone(d.environment_kind)}>{d.environment_label}</Badge>],
    ["Origen", `${d.source_label}${d.triggered_by_label ? ` · ${d.triggered_by_label}` : ""}`],
    ["Registrado", formatDateTime(d.created_at)],
    ["Inicio", formatDateTime(d.started_at)],
    ["Fin", formatDateTime(d.finished_at)],
    ["Duración", formatDuration(d.duration_seconds)],
  ];

  return (
    <>
      <Link to="/admin/deployments" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Despliegues
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{d.version}</span>
            <Badge tone={DEPLOYMENT_STATUS[d.status].tone} dot>
              {d.status_label}
            </Badge>
          </span>
        }
        description={`${d.project_name} · ${d.environment_label}`}
        actions={next.map((s) => (
          <Button key={s} variant={s === "FAILED" || s === "CANCELLED" ? "outline" : "primary"} onClick={() => setTarget(s)}>
            {s === "RUNNING" ? "Iniciar" : s === "SUCCESS" ? "Marcar exitoso" : s === "FAILED" ? "Marcar fallido" : "Cancelar"}
          </Button>
        ))}
      />
      {!d.is_terminal && (
        <div className="mb-6">
          <Alert tone="info">Despliegue en curso: esta página se actualiza automáticamente cada 10 s.</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Detalle" />
            <CardBody>
              <dl className="space-y-3 text-sm">
                {rows.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-right text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Código y CI/CD" />
            <CardBody className="space-y-3 text-sm">
              <p className="flex items-center gap-2">
                <GitCommitHorizontal className="size-4 text-muted" />
                {d.commit_sha ? (
                  commitLink ? (
                    <a href={commitLink} target="_blank" rel="noopener noreferrer" className="font-mono text-accent hover:underline">
                      {d.commit_sha.slice(0, 12)}
                    </a>
                  ) : (
                    <span className="font-mono">{d.commit_sha.slice(0, 12)}</span>
                  )
                ) : (
                  <span className="text-muted">Sin commit</span>
                )}
              </p>
              <p className="flex items-center gap-2">
                <GitBranch className="size-4 text-muted" />
                {d.branch ? <span className="font-mono">{d.branch}</span> : <span className="text-muted">Sin rama</span>}
              </p>
              {d.ci_run_url ? (
                <a href={d.ci_run_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline">
                  <ExternalLink className="size-4" /> Ver ejecución {d.ci_run_id && <span className="font-mono">#{d.ci_run_id}</span>}
                </a>
              ) : (
                <p className="text-muted">Sin ejecución de CI asociada</p>
              )}
              <p className="border-t border-border pt-3 text-xs text-muted">
                Correlación <code className="font-mono text-fg">{d.correlation_id}</code>
              </p>
            </CardBody>
          </Card>
          {d.message && (
            <Card>
              <CardHeader title="Mensaje de resultado" />
              <CardBody>
                <p className="whitespace-pre-line text-sm text-fg">{d.message}</p>
              </CardBody>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="Eventos del despliegue" description="Trazabilidad correlacionada con este despliegue." />
          <CardBody>
            {events.isError ? (
              <ErrorState message={events.error.message} onRetry={() => void events.refetch()} />
            ) : events.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : events.data.results.length === 0 ? (
              <EmptyState icon={<History className="size-5" />} title="Sin eventos todavía" description="Los eventos aparecen cuando el despliegue cambia de estado." />
            ) : (
              <EventTimeline events={events.data.results} compact />
            )}
          </CardBody>
        </Card>
      </div>
      <TransitionDialog deployment={d} target={target} onClose={() => setTarget(null)} />
    </>
  );
}
