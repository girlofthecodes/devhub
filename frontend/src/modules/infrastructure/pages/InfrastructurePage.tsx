import { Clock, Cpu, Database, Layers, MapPin, Network, Plus, Server as ServerIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { Pagination, SearchInput } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import { formatRelative } from "@/utils/format";

import type { InfraStatus, Server, ServerType } from "../api";
import { ServerFormDialog } from "../components/ServerFormDialog";
import { INFRA_STATUS, INFRA_STATUS_OPTIONS, SERVER_TYPES } from "../constants";
import { useInfrastructureSummary, useServers } from "../hooks";

const PAGE_SIZE = 12;
const TYPE_ICON: Record<ServerType, LucideIcon> = {
  APPLICATION: Cpu,
  DATABASE: Database,
  MIXED: Layers,
  OTHER: ServerIcon,
};

function Kpi({ label, value, hint, loading }: { label: string; value: number | undefined; hint?: string; loading: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-fg">{loading ? <Skeleton className="h-8 w-12" /> : value}</div>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function ServerCard({ server }: { server: Server }) {
  const Icon = TYPE_ICON[server.server_type];
  return (
    <Link to={`/admin/infrastructure/servers/${server.id}`} className="group block h-full">
      <Card className="flex h-full flex-col p-5 transition-all group-hover:-translate-y-0.5 group-hover:border-border-strong group-hover:shadow-md">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold text-fg group-hover:text-accent">{server.name}</h3>
            <p className="truncate font-mono text-xs text-muted">{server.identifier}</p>
          </div>
          <Badge tone={INFRA_STATUS[server.status].tone} dot>
            {server.status_label}
          </Badge>
        </div>
        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex items-center gap-2 text-muted">
            <Badge>{server.server_type_label}</Badge>
            <span className="truncate">{server.operating_system || "SO no registrado"}</span>
          </div>
          <div className="flex items-center gap-2 text-muted">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{server.location || "Sin ubicación"}</span>
          </div>
          <div className="flex items-center gap-2 text-muted">
            <Network className="size-3.5 shrink-0" />
            <span className="truncate font-mono text-xs">{server.vpn_address ?? "Sin dirección VPN"}</span>
          </div>
        </dl>
        <div className="min-h-4 flex-1" />
        <div className="flex items-center gap-4 border-t border-border pt-3 text-xs text-muted">
          <span title="Entornos activos / total">
            <Layers className="mr-1 inline size-3.5" />
            {server.active_environment_count}/{server.environment_count} entornos
          </span>
          <span className="ml-auto flex items-center gap-1" title="Última verificación de sus servicios (monitoreo)">
            <Clock className="size-3.5" />
            {server.last_checked_at ? formatRelative(server.last_checked_at) : "Sin verificar"}
          </span>
        </div>
      </Card>
    </Link>
  );
}

export function InfrastructurePage() {
  const me = useAuthenticatedUser();
  const isAdmin = me.role === "ADMIN";
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<InfraStatus | "">("");
  const [type, setType] = useState<ServerType | "">("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search);
  const summary = useInfrastructureSummary();
  const servers = useServers({
    page,
    page_size: PAGE_SIZE,
    search: debounced || undefined,
    status: status || undefined,
    server_type: type || undefined,
  });
  const s = summary.data;
  const filtered = Boolean(debounced || status || type);

  return (
    <>
      <PageHeader
        title="Infraestructura"
        description="Inventario de servidores del Home Lab. Solo metadatos: sin credenciales ni ejecución remota."
        actions={
          isAdmin && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Registrar servidor
            </Button>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Servidores activos"
          value={s?.servers.by_status.ACTIVE}
          hint={s ? `${s.servers.total} registrados · ${s.servers.by_status.MAINTENANCE} en mantenimiento` : undefined}
          loading={summary.isPending}
        />
        <Kpi
          label="Entornos activos"
          value={s?.environments.by_status.ACTIVE}
          hint={s ? `${s.environments.total} registrados` : undefined}
          loading={summary.isPending}
        />
        <Kpi
          label="Entornos de producción"
          value={s?.environments.by_kind.PRODUCTION}
          hint={s ? `${s.environments.by_kind.DEMO} demo · ${s.environments.by_kind.DEVELOPMENT} development` : undefined}
          loading={summary.isPending}
        />
        <Kpi
          label="Entornos sin servidor"
          value={s?.environments.without_server}
          hint="Pendientes de asignar"
          loading={summary.isPending}
        />
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Buscar por nombre, identificador, ubicación o SO…"
          className="flex-1"
        />
        <div className="flex flex-wrap gap-3">
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value as ServerType | "");
              setPage(1);
            }}
            aria-label="Filtrar por tipo"
            className="w-40"
          >
            <option value="">Todos los tipos</option>
            {SERVER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as InfraStatus | "");
              setPage(1);
            }}
            aria-label="Filtrar por estado"
            className="w-40"
          >
            <option value="">Todos los estados</option>
            {INFRA_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {servers.isError ? (
        <Card>
          <ErrorState message={servers.error.message} onRetry={() => void servers.refetch()} />
        </Card>
      ) : servers.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : servers.data.results.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ServerIcon className="size-5" />}
            title={filtered ? "Sin coincidencias" : "Aún no hay servidores registrados"}
            description={
              filtered ? "Prueba con otros filtros." : "Registra el Servidor A (aplicaciones) y el Servidor B (datos) del Home Lab."
            }
            action={
              !filtered &&
              isAdmin && (
                <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  Registrar servidor
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {servers.data.results.map((server) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </div>
          {servers.data.count > PAGE_SIZE && (
            <Card className="mt-4">
              <Pagination page={page} pageSize={PAGE_SIZE} count={servers.data.count} onPageChange={setPage} />
            </Card>
          )}
        </>
      )}

      <ServerFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(server) => navigate(`/admin/infrastructure/servers/${server.id}`)}
      />
    </>
  );
}
