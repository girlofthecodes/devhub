import { ArrowLeft, Layers, Pencil } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { DataTable, type Column } from "@/components/ui/Table";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import { ApiError } from "@/services/http";
import { formatDateTime } from "@/utils/format";
import { displayUrl } from "@/utils/urls";

import type { Environment } from "../api";
import { ServerFormDialog } from "../components/ServerFormDialog";
import { INFRA_STATUS, kindTone } from "../constants";
import { useEnvironments, useServer } from "../hooks";

export function ServerDetailPage() {
  const { id = "" } = useParams();
  const me = useAuthenticatedUser();
  const server = useServer(id);
  const environments = useEnvironments({ server: id, page_size: 100 });
  const [editing, setEditing] = useState(false);

  if (server.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (server.isError) {
    const notFound = server.error instanceof ApiError && server.error.status === 404;
    return (
      <Card>
        <ErrorState
          title={notFound ? "Servidor no encontrado" : "No se pudo cargar el servidor"}
          message={notFound ? undefined : server.error.message}
          onRetry={notFound ? undefined : () => void server.refetch()}
        />
      </Card>
    );
  }

  const s = server.data;
  const hiddenEnvironments = s.environment_count - (environments.data?.count ?? s.environment_count);
  const columns: Column<Environment>[] = [
    {
      key: "project",
      header: "Proyecto",
      cell: (e) => (
        <Link to={`/admin/projects/${e.project}`} className="font-medium text-fg hover:text-accent">
          {e.project_name}
        </Link>
      ),
    },
    { key: "kind", header: "Entorno", cell: (e) => <Badge tone={kindTone(e.kind)}>{e.display_name}</Badge> },
    {
      key: "url",
      header: "URL pública",
      hideOnMobile: true,
      cell: (e) =>
        e.public_url ? (
          <a href={e.public_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            {displayUrl(e.public_url)}
          </a>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: "version", header: "Versión", cell: (e) => <span className="font-mono text-xs">{e.deployed_version || "—"}</span> },
    {
      key: "status",
      header: "Estado",
      cell: (e) => (
        <Badge tone={INFRA_STATUS[e.status].tone} dot>
          {e.status_label}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <Link to="/admin/infrastructure" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Infraestructura
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {s.name}
            <Badge tone={INFRA_STATUS[s.status].tone} dot>
              {s.status_label}
            </Badge>
          </span>
        }
        description={<span className="font-mono">{s.identifier}</span>}
        actions={
          me.role === "ADMIN" && (
            <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Editar
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit">
          <CardHeader title="Ficha del servidor" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              {(
                [
                  ["Tipo", s.server_type_label],
                  ["Sistema operativo", s.operating_system || "—"],
                  ["Ubicación lógica", s.location || "—"],
                  ["Dirección VPN", s.vpn_address ?? "—"],
                  ["Última verificación de sus servicios", s.last_checked_at ? formatDateTime(s.last_checked_at) : "Sin verificar"],
                  ["Registrado", formatDateTime(s.created_at)],
                  ["Actualizado", formatDateTime(s.updated_at)],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted">{label}</dt>
                  <dd className={label === "Dirección VPN" ? "mt-0.5 font-mono text-fg" : "mt-0.5 text-fg"}>{value}</dd>
                </div>
              ))}
              {s.notes && (
                <div>
                  <dt className="text-muted">Notas</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-fg">{s.notes}</dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Entornos alojados"
            description={`${s.active_environment_count} activos de ${s.environment_count} registrados.`}
          />
          <DataTable
            caption="Entornos alojados"
            columns={columns}
            rows={environments.data?.results}
            rowKey={(e) => e.id}
            loading={environments.isPending}
            error={environments.error}
            onRetry={() => void environments.refetch()}
            empty={<EmptyState icon={<Layers className="size-5" />} title="Ningún entorno usa este servidor" />}
          />
          {hiddenEnvironments > 0 && (
            <p className="border-t border-border px-5 py-3 text-xs text-muted">
              {hiddenEnvironments} entorno(s) pertenecen a proyectos a los que no tienes acceso.
            </p>
          )}
        </Card>
      </div>
      <ServerFormDialog open={editing} server={s} onClose={() => setEditing(false)} />
    </>
  );
}
