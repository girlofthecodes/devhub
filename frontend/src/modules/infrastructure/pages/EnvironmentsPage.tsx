import { Layers, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { DataTable, Pagination, SearchInput, type Column } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";
import { formatRelative } from "@/utils/format";
import { displayUrl } from "@/utils/urls";

import type { Environment, EnvironmentKind, InfraStatus } from "../api";
import { EnvironmentFormDialog } from "../components/EnvironmentFormDialog";
import { ENVIRONMENT_KINDS, INFRA_STATUS, INFRA_STATUS_OPTIONS, kindTone } from "../constants";
import { useEnvironments, useServers } from "../hooks";

const PAGE_SIZE = 20;

export function EnvironmentsPage() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<EnvironmentKind | "">("");
  const [status, setStatus] = useState<InfraStatus | "">("");
  const [server, setServer] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Environment | null>(null);
  const debounced = useDebounce(search);
  const servers = useServers({ page_size: 100 });
  const environments = useEnvironments({
    page,
    page_size: PAGE_SIZE,
    search: debounced || undefined,
    kind: kind || undefined,
    status: status || undefined,
    server: server || undefined,
  });
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };
  const filtered = Boolean(debounced || kind || status || server);

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
      key: "server",
      header: "Servidor",
      hideOnMobile: true,
      cell: (e) =>
        e.server_detail ? (
          <Link to={`/admin/infrastructure/servers/${e.server_detail.id}`} className="hover:text-accent">
            {e.server_detail.name}
          </Link>
        ) : (
          <span className="text-muted">Sin asignar</span>
        ),
    },
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
    {
      key: "updated",
      header: "Actualizado",
      hideOnMobile: true,
      cell: (e) => <span className="text-muted">{formatRelative(e.updated_at)}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (e) =>
        e.can_edit && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Editar ${e.project_name} ${e.display_name}`}
            onClick={() => setEditing(e)}
          >
            <Pencil className="size-4" />
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Entornos"
        description="Development, Demo y Production de cada proyecto: servidor, URL y versión."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nuevo entorno
          </Button>
        }
      />
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_12rem]">
          <SearchInput value={search} onChange={reset(setSearch)} placeholder="Buscar por proyecto, URL o versión…" />
          <Select value={kind} onChange={(e) => reset(setKind)(e.target.value as EnvironmentKind | "")} aria-label="Filtrar por tipo">
            <option value="">Todos los tipos</option>
            {ENVIRONMENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => reset(setStatus)(e.target.value as InfraStatus | "")} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            {INFRA_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select value={server} onChange={(e) => reset(setServer)(e.target.value)} aria-label="Filtrar por servidor">
            <option value="">Todos los servidores</option>
            {servers.data?.results.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          caption="Entornos"
          columns={columns}
          rows={environments.data?.results}
          rowKey={(e) => e.id}
          loading={environments.isPending}
          error={environments.error}
          onRetry={() => void environments.refetch()}
          empty={
            <EmptyState
              icon={<Layers className="size-5" />}
              title={filtered ? "Sin coincidencias" : "Aún no hay entornos"}
              description={filtered ? "Prueba con otros filtros." : "Configura los entornos desde aquí o desde el detalle de cada proyecto."}
            />
          }
        />
        {environments.data && environments.data.count > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} count={environments.data.count} onPageChange={setPage} />
        )}
      </Card>
      <EnvironmentFormDialog open={creating} onClose={() => setCreating(false)} />
      <EnvironmentFormDialog open={editing !== null} environment={editing ?? undefined} onClose={() => setEditing(null)} />
    </>
  );
}
