import { History, Plus, Rocket } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { kindTone } from "@/modules/infrastructure/constants";
import { useEvents } from "@/modules/traceability/hooks";
import { EventTimeline } from "@/modules/traceability/components/EventTimeline";
import { formatRelative } from "@/utils/format";

import { DEPLOYMENT_STATUS } from "../constants";
import { useDeployments } from "../hooks";
import { RegisterDeploymentDialog } from "./DeploymentDialogs";

/** Recent deployments + recent trace events of a project (project detail page). */
export function ProjectActivityCard({ project, canDeploy }: { project: { id: string; is_archived: boolean }; canDeploy: boolean }) {
  const deployments = useDeployments({ project: project.id, page_size: 5 });
  const events = useEvents({ project: project.id, page_size: 8 });
  const [registering, setRegistering] = useState(false);

  return (
    <>
      <Card>
        <CardHeader
          title="Despliegues recientes"
          actions={
            <>
              <Link to="/admin/deployments" className="text-sm font-medium text-accent hover:underline">
                Ver todos
              </Link>
              {canDeploy && !project.is_archived && (
                <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => setRegistering(true)}>
                  Registrar
                </Button>
              )}
            </>
          }
        />
        {deployments.isError ? (
          <ErrorState message={deployments.error.message} onRetry={() => void deployments.refetch()} />
        ) : deployments.isPending ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : deployments.data.results.length === 0 ? (
          <EmptyState icon={<Rocket className="size-5" />} title="Sin despliegues registrados" />
        ) : (
          <ul className="divide-y divide-border">
            {deployments.data.results.map((d) => (
              <li key={d.id}>
                <Link to={`/admin/deployments/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm hover:bg-surface-2/60">
                  <span className="font-mono font-medium text-fg">{d.version}</span>
                  <Badge tone={kindTone(d.environment_kind)}>{d.environment_label}</Badge>
                  <Badge tone={DEPLOYMENT_STATUS[d.status].tone} dot>
                    {d.status_label}
                  </Badge>
                  <span className="ml-auto text-xs text-muted">
                    {d.source_label} · {formatRelative(d.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader
          title="Trazabilidad"
          description="Últimos eventos del proyecto."
          actions={
            <Link to={`/admin/traceability?project=${project.id}`} className="text-sm font-medium text-accent hover:underline">
              Ver línea de tiempo
            </Link>
          }
        />
        <CardBody>
          {events.isError ? (
            <ErrorState message={events.error.message} onRetry={() => void events.refetch()} />
          ) : events.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : events.data.results.length === 0 ? (
            <EmptyState icon={<History className="size-5" />} title="Sin eventos" />
          ) : (
            <EventTimeline events={events.data.results} compact />
          )}
        </CardBody>
      </Card>
      <RegisterDeploymentDialog open={registering} onClose={() => setRegistering(false)} projectId={project.id} />
    </>
  );
}
