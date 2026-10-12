import { Building2, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { DataTable, Pagination, SearchInput, type Column } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";
import { RequireRole } from "@/modules/auth/ProtectedRoute";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import { formatDate } from "@/utils/format";

import type { Organization } from "../api";
import { OrganizationFormDialog } from "../components/OrganizationFormDialog";
import { useOrganizations } from "../hooks";

const PAGE_SIZE = 20;

export function OrganizationsPage() {
  const navigate = useNavigate();
  const me = useAuthenticatedUser();
  const isAdmin = me.role === "ADMIN";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search);

  const orgs = useOrganizations({
    page,
    page_size: PAGE_SIZE,
    search: debounced || undefined,
    is_active: status === "" ? undefined : status === "true",
  });

  const columns: Column<Organization>[] = [
    {
      key: "name",
      header: "Organización",
      cell: (o) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-muted">
            <Building2 className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{o.name}</p>
            <p className="truncate font-mono text-xs text-muted">{o.slug}</p>
          </div>
        </div>
      ),
    },
    {
      key: "members",
      header: "Miembros",
      cell: (o) => <span className="tabular-nums">{o.member_count}</span>,
    },
    {
      key: "status",
      header: "Estado",
      cell: (o) => (
        <Badge tone={o.is_active ? "success" : "neutral"} dot>
          {o.is_active ? "Activa" : "Inactiva"}
        </Badge>
      ),
    },
    {
      key: "created",
      header: "Creada",
      hideOnMobile: true,
      cell: (o) => <span className="text-muted">{formatDate(o.created_at)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Organizaciones"
        description={
          isAdmin
            ? "Clientes, empresas y equipos con acceso a DevHub."
            : "Organizaciones a las que perteneces."
        }
        actions={
          <RequireRole roles={["ADMIN"]}>
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nueva organización
            </Button>
          </RequireRole>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Buscar por nombre, identificador o correo…"
            className="flex-1"
          />
          {isAdmin && (
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as "" | "true" | "false");
                setPage(1);
              }}
              aria-label="Filtrar por estado"
              className="sm:w-40"
            >
              <option value="">Todas</option>
              <option value="true">Activas</option>
              <option value="false">Inactivas</option>
            </Select>
          )}
        </div>
        <DataTable
          caption="Organizaciones"
          columns={columns}
          rows={orgs.data?.results}
          rowKey={(o) => o.id}
          loading={orgs.isPending}
          error={orgs.error}
          onRetry={() => void orgs.refetch()}
          onRowClick={(o) => navigate(`/admin/organizations/${o.id}`)}
          empty={
            <EmptyState
              icon={<Building2 className="size-5" />}
              title={debounced || status ? "Sin coincidencias" : "Aún no hay organizaciones"}
              description={
                isAdmin && !debounced && !status
                  ? "Crea una organización para agrupar a los usuarios de un cliente."
                  : undefined
              }
            />
          }
        />
        {orgs.data && orgs.data.count > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} count={orgs.data.count} onPageChange={setPage} />
        )}
      </Card>
      <OrganizationFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(org) => navigate(`/admin/organizations/${org.id}`)}
      />
    </>
  );
}
