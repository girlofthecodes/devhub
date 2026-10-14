import { Settings2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { DataTable, Pagination, SearchInput } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";
import { formatMoney } from "@/utils/format";

import type { CommercialApplication, CommercialStatus } from "../api";
import { COMMERCIAL_STATUS_OPTIONS, commercialTone, KIND_SHORT } from "../constants";
import { ProfileDialog } from "../components/dialogs";
import { FinanceGate } from "../components/filters";
import { useApplications, useFinanceAccess } from "../hooks";

const PAGE_SIZE = 20;

export function ApplicationsPage() {
  return (
    <FinanceGate>
      <Applications />
    </FinanceGate>
  );
}

function Applications() {
  const { canManage } = useFinanceAccess();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CommercialStatus | "">("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CommercialApplication | null>(null);
  const debounced = useDebounce(search, 300);
  const apps = useApplications({ page, page_size: PAGE_SIZE, search: debounced, commercial_status: status });

  return (
    <>
      <PageHeader
        title="Aplicaciones comerciales"
        description="El mismo catálogo de proyectos, con su estado comercial independiente del estado técnico."
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-border p-4">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar aplicación…" className="w-full sm:w-72" />
          <Select aria-label="Estado comercial" className="w-full sm:w-64" value={status} onChange={(e) => { setStatus(e.target.value as CommercialStatus | ""); setPage(1); }}>
            <option value="">Todos los estados comerciales</option>
            {COMMERCIAL_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          rows={apps.data?.results}
          loading={apps.isPending}
          error={apps.error}
          onRetry={() => void apps.refetch()}
          rowKey={(a) => a.id}
          caption="Aplicaciones comerciales"
          empty={<EmptyState title="Sin aplicaciones" description="No hay aplicaciones que coincidan con el filtro." />}
          columns={[
            {
              key: "name",
              header: "Aplicación",
              cell: (a) => (
                <Link to={`/admin/projects/${a.id}?tab=comercial`} className="font-medium text-fg hover:underline">
                  {a.name}
                </Link>
              ),
            },
            { key: "tech", header: "Estado técnico", hideOnMobile: true, cell: (a) => <span className="text-muted">{a.project_status_label}</span> },
            { key: "com", header: "Estado comercial", cell: (a) => <Badge tone={commercialTone(a.commercial_status)}>{a.commercial_status_label}</Badge> },
            {
              key: "mod",
              header: "Modalidades",
              hideOnMobile: true,
              cell: (a) => (a.modalities.length ? a.modalities.map((m) => KIND_SHORT[m]).join(" y ") : <span className="text-muted">—</span>),
            },
            {
              key: "contracts",
              header: "Contratos activos",
              className: "text-right tabular-nums",
              cell: (a) => (
                <span title={`${a.active_sales} venta(s) · ${a.active_subscriptions} renta(s)`}>
                  {a.active_contracts}
                  <span className="block text-xs text-muted">{a.organizations} cliente(s)</span>
                </span>
              ),
            },
            { key: "mrr", header: "MRR (MXN)", className: "text-right tabular-nums", cell: (a) => formatMoney(a.mrr, "MXN") },
            ...(canManage
              ? [
                  {
                    key: "actions",
                    header: <span className="sr-only">Acciones</span>,
                    className: "text-right",
                    cell: (a: CommercialApplication) => (
                      <Button size="sm" variant="outline" icon={<Settings2 className="size-3.5" />} onClick={() => setEditing(a)}>
                        Configurar
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {apps.data && apps.data.count > PAGE_SIZE && (
          <Pagination page={page} pageSize={PAGE_SIZE} count={apps.data.count} onPageChange={setPage} />
        )}
      </Card>
      <ProfileDialog app={editing} onClose={() => setEditing(null)} />
    </>
  );
}
