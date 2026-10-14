import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { Pagination, SearchInput } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/utils/cn";

import type { ContractKind } from "../api";
import { KIND_LABEL } from "../constants";
import { FinanceGate } from "../components/filters";
import { PaymentsTable, ReceivablesTable } from "../components/tables";
import { useApplicationOptions, usePayments, useReceivables } from "../hooks";

const PAGE_SIZE = 20;

const STATUS_FILTERS = [
  { value: "OPEN", label: "Por cobrar" },
  { value: "OVERDUE", label: "Vencidos" },
  { value: "PENDING", label: "Pendientes (al corriente)" },
  { value: "PARTIAL", label: "Parciales (al corriente)" },
  { value: "PAID", label: "Pagados" },
  { value: "CANCELLED", label: "Cancelados" },
  { value: "", label: "Todos" },
];

export function ReceivablesPage() {
  return (
    <FinanceGate>
      <Receivables />
    </FinanceGate>
  );
}

interface ReceivableFilterState {
  status: string;
  kind: ContractKind | "";
  dueFrom: string;
  dueTo: string;
}

function Receivables() {
  const [tab, setTab] = useState<"receivables" | "payments">("receivables");
  const apps = useApplicationOptions();
  const [project, setProject] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ReceivableFilterState>({ status: "OPEN", kind: "", dueFrom: "", dueTo: "" });
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 300);
  const update = (patch: Partial<ReceivableFilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  return (
    <>
      <PageHeader
        title="Cobros"
        description="Lo esperado por contrato y lo efectivamente cobrado. Un pago pendiente nunca cuenta como ingreso."
      />
      <div role="tablist" aria-label="Cobros" className="mb-4 inline-flex rounded-lg border border-border bg-surface-2 p-0.5 text-sm">
        {(
          [
            ["receivables", "Cobros programados"],
            ["payments", "Pagos recibidos"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
            className={cn("rounded-md px-3 py-1.5 text-muted hover:text-fg", tab === key && "bg-surface text-fg shadow-xs")}
          >
            {label}
          </button>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-border p-4">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Buscar concepto, aplicación o referencia…"
            className="w-full sm:w-80"
          />
          <Select
            aria-label="Aplicación"
            className="w-full sm:w-52"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas las aplicaciones</option>
            {apps.data?.results.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          {tab === "receivables" && (
            <>
              <Select aria-label="Estado" className="w-full sm:w-52" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
                {STATUS_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Select aria-label="Modelo comercial" className="w-full sm:w-44" value={filters.kind} onChange={(e) => update({ kind: e.target.value as ContractKind | "" })}>
                <option value="">Venta y renta</option>
                {(Object.keys(KIND_LABEL) as ContractKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
              <Input type="date" aria-label="Vence desde" className="w-full sm:w-40" value={filters.dueFrom} onChange={(e) => update({ dueFrom: e.target.value })} />
              <Input type="date" aria-label="Vence hasta" className="w-full sm:w-40" value={filters.dueTo} onChange={(e) => update({ dueTo: e.target.value })} />
            </>
          )}
        </div>
        {tab === "receivables" ? (
          <ReceivableList project={project} search={debounced} filters={filters} page={page} setPage={setPage} />
        ) : (
          <PaymentList project={project} search={debounced} page={page} setPage={setPage} />
        )}
      </Card>
    </>
  );
}

function ReceivableList({
  project,
  search,
  filters,
  page,
  setPage,
}: {
  project: string;
  search: string;
  filters: ReceivableFilterState;
  page: number;
  setPage: (p: number) => void;
}) {
  const list = useReceivables({
    page,
    page_size: PAGE_SIZE,
    search,
    project,
    status: filters.status,
    kind: filters.kind,
    due_from: filters.dueFrom,
    due_to: filters.dueTo,
  });
  return (
    <>
      <ReceivablesTable rows={list.data?.results} loading={list.isPending} error={list.error} onRetry={() => void list.refetch()} />
      {list.data && list.data.count > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPageChange={setPage} />}
    </>
  );
}

function PaymentList({
  project,
  search,
  page,
  setPage,
}: {
  project: string;
  search: string;
  page: number;
  setPage: (p: number) => void;
}) {
  const [reversed, setReversed] = useState(false);
  const list = usePayments({ page, page_size: PAGE_SIZE, search, project, include_reversed: reversed });
  return (
    <>
      <label className="flex items-center gap-2 border-b border-border px-5 py-2.5 text-sm text-muted">
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          checked={reversed}
          onChange={(e) => {
            setReversed(e.target.checked);
            setPage(1);
          }}
        />
        Incluir pagos revertidos
      </label>
      <PaymentsTable rows={list.data?.results} loading={list.isPending} error={list.error} onRetry={() => void list.refetch()} />
      {list.data && list.data.count > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPageChange={setPage} />}
    </>
  );
}
