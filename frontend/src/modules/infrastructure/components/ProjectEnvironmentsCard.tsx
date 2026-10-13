import { ExternalLink, Layers, Pencil, Plus, Server as ServerIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { HealthBadge } from "@/modules/monitoring/components";
import { useHealthChecks } from "@/modules/monitoring/hooks";
import { formatRelative } from "@/utils/format";
import { displayUrl } from "@/utils/urls";

import type { Environment, EnvironmentKind } from "../api";
import { ENVIRONMENT_KINDS, INFRA_STATUS, kindTone } from "../constants";
import { useEnvironments } from "../hooks";
import { EnvironmentFormDialog } from "./EnvironmentFormDialog";

interface Props {
  project: { id: string; name: string; is_archived: boolean };
  canEdit: boolean;
}

/** The three environment slots (Development, Demo, Production) of a project. */
export function ProjectEnvironmentsCard({ project, canEdit }: Props) {
  const environments = useEnvironments({ project: project.id, page_size: 10 });
  const [editing, setEditing] = useState<Environment | null>(null);
  const [creating, setCreating] = useState<EnvironmentKind | null>(null);
  const byKind = new Map((environments.data?.results ?? []).map((e) => [e.kind, e]));
  const checks = useHealthChecks({ project: project.id, page_size: 10 });
  const checkByEnv = new Map((checks.data?.results ?? []).map((c) => [c.environment, c]));
  const editable = canEdit && !project.is_archived;

  return (
    <Card>
      <CardHeader title="Entornos" description="Dónde corre cada entorno del proyecto y con qué versión." />
      {environments.isError ? (
        <ErrorState message={environments.error.message} onRetry={() => void environments.refetch()} />
      ) : (
        <ul className="divide-y divide-border">
          {ENVIRONMENT_KINDS.map(({ value, label }) => {
            const env = byKind.get(value);
            return (
              <li key={value} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <Badge tone={kindTone(value)} className="w-28 justify-center">
                  {label}
                </Badge>
                {environments.isPending ? (
                  <Skeleton className="h-5 flex-1" />
                ) : env ? (
                  <>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {env.public_url ? (
                          <a
                            href={env.public_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 truncate font-medium text-accent hover:underline"
                          >
                            {displayUrl(env.public_url)} <ExternalLink className="size-3.5" />
                          </a>
                        ) : (
                          <span className="text-muted">Sin URL pública</span>
                        )}
                        <Badge tone={INFRA_STATUS[env.status].tone} dot>
                          {env.status_label}
                        </Badge>
                        {checkByEnv.get(env.id) ? (
                          <Link to={`/admin/monitoring/${checkByEnv.get(env.id)!.id}`}>
                            <HealthBadge
                              status={checkByEnv.get(env.id)!.effective_status}
                              label={checkByEnv.get(env.id)!.effective_status_label}
                              stale={checkByEnv.get(env.id)!.is_stale}
                            />
                          </Link>
                        ) : (
                          env.public_url && <Badge>Sin monitoreo</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                        <span className="inline-flex items-center gap-1">
                          <ServerIcon className="size-3.5" />
                          {env.server_detail ? (
                            <Link to={`/admin/infrastructure/servers/${env.server_detail.id}`} className="hover:text-fg">
                              {env.server_detail.name}
                            </Link>
                          ) : (
                            "Sin servidor"
                          )}
                        </span>
                        <span className="font-mono">{env.deployed_version || "sin versión"}</span>
                        <span>Actualizado {formatRelative(env.updated_at)}</span>
                      </div>
                    </div>
                    {editable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Editar entorno ${label}`}
                        title="Editar"
                        onClick={() => setEditing(env)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-muted">No configurado</span>
                    {editable && (
                      <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => setCreating(value)}>
                        Configurar
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!environments.isPending && !environments.isError && byKind.size === 0 && !editable && (
        <p className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted">
          <Layers className="size-4" /> Aún no hay entornos registrados para este proyecto.
        </p>
      )}
      <EnvironmentFormDialog open={editing !== null} environment={editing ?? undefined} onClose={() => setEditing(null)} />
      <EnvironmentFormDialog
        open={creating !== null}
        project={{ id: project.id, name: project.name }}
        kind={creating ?? undefined}
        onClose={() => setCreating(null)}
      />
    </Card>
  );
}
