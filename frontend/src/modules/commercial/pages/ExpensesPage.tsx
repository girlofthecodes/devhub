import { Ban, Pencil, Plus, Split } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { DataTable, Pagination, SearchInput } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDay, formatMoney } from "@/utils/format";

import type { Expense, ExpenseCategory } from "../api";
import { EXPENSE_CATEGORY_OPTIONS } from "../constants";
import { AllocationsDialog, ExpenseFormDialog, ReasonDialog } from "../components/dialogs";
import { FinanceGate } from "../components/filters";
import { useApplicationOptions, useExpenses, useFinanceAccess, useVoidExpense } from "../hooks";

const PAGE_SIZE = 20;

export function ExpensesPage() {
  return (
    <FinanceGate>
      <Expenses />
    </FinanceGate>
  );
}

export function ExpensesTable({ rows, loading, error, onRetry }: { rows: Expense[] | undefined; loading?: boolean; error?: Error | null; onRetry?: () => void }) {
  const { canManage } = useFinanceAccess();
  const toast = useToast();
  const voidExpense = useVoidExpense();
  const [editing, setEditing] = useState<Expense | null>(null);
  const [allocating, setAllocating] = useState<Expense | null>(null);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  return (
    <>
      <DataTable
        rows={rows}
        loading={loading}
        error={error}
        onRetry={onRetry}
        rowKey={(e) => e.id}
        caption="Gastos"
        empty={<EmptyState title="Sin gastos" description="No hay gastos registrados que coincidan." />}
        columns={[
          { key: "date", header: "Fecha", cell: (e) => <span className="tabular-nums">{formatDay(e.incurred_on)}</span> },
          {
            key: "concept",
            header: "Concepto",
            cell: (e) => (
              <span>
                <span className={e.is_voided ? "block text-muted line-through" : "block font-medium text-fg"}>{e.concept}</span>
                <span className="text-xs text-muted">
                  {e.category_label} · {e.kind_label}
                  {e.recurrence_label && ` ${e.recurrence_label.toLowerCase()}`}
                </span>
              </span>
            ),
          },
          {
            key: "project",
            header: "Aplicación",
            cell: (e) =>
              e.project_name ?? (
                <span>
                  <Badge tone="neutral">General</Badge>
                  {e.allocations.length > 0 && (
                    <span className="mt-1 block text-xs text-muted">
                      {e.allocations.map((a) => `${a.project_name} ${Number(a.percentage)}%`).join(" · ")}
                    </span>
                  )}
                </span>
              ),
          },
          {
            key: "amount",
            header: "Importe",
            className: "text-right tabular-nums",
            cell: (e) => <span className={e.is_voided ? "text-muted line-through" : "text-fg"}>{formatMoney(e.amount, e.currency)}</span>,
          },
          ...(canManage
            ? [
                {
                  key: "actions",
                  header: <span className="sr-only">Acciones</span>,
                  className: "text-right",
                  cell: (e: Expense) =>
                    e.is_voided ? (
                      <span title={e.void_reason}>
                        <Badge tone="neutral">Anulado</Badge>
                      </span>
                    ) : (
                      <span className="flex justify-end gap-1">
                        {!e.project && (
                          <Button size="icon" variant="ghost" className="size-8" aria-label={`Distribuir ${e.concept}`} title="Distribuir entre aplicaciones" onClick={() => setAllocating(e)}>
                            <Split className="size-4" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="size-8" aria-label={`Editar ${e.concept}`} onClick={() => setEditing(e)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-8" aria-label={`Anular ${e.concept}`} onClick={() => setVoiding(e)}>
                          <Ban className="size-4" />
                        </Button>
                      </span>
                    ),
                },
              ]
            : []),
        ]}
      />
      <ExpenseFormDialog open={editing !== null} expense={editing ?? undefined} onClose={() => setEditing(null)} />
      <AllocationsDialog expense={allocating} onClose={() => setAllocating(null)} />
      <ReasonDialog
        open={voiding !== null}
        title="Anular gasto"
        message="El gasto deja de contar en la rentabilidad. No se borra: queda anulado en el historial."
        confirmLabel="Anular gasto"
        loading={voidExpense.isPending}
        onClose={() => setVoiding(null)}
        onConfirm={(reason, fail) =>
          voidExpense.mutate(
            { id: voiding!.id, reason },
            {
              onSuccess: () => {
                toast.success("Gasto anulado");
                setVoiding(null);
              },
              onError: fail,
            },
          )
        }
      />
    </>
  );
}

function Expenses() {
  const { canManage } = useFinanceAccess();
  const apps = useApplicationOptions();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [category, setCategory] = useState<ExpenseCategory | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [voided, setVoided] = useState(false);
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 300);
  const list = useExpenses({
    page,
    page_size: PAGE_SIZE,
    search: debounced,
    project,
    category,
    date_from: from,
    date_to: to,
    include_voided: voided,
  });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  return (
    <>
      <PageHeader
        title="Gastos"
        description="Costos de las aplicaciones y de la infraestructura compartida. Nunca se borran: se anulan."
        actions={
          canManage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Registrar gasto
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <SearchInput value={search} onChange={reset(setSearch)} placeholder="Buscar concepto…" className="w-full sm:w-64" />
          <Select aria-label="Aplicación" className="w-full sm:w-52" value={project} onChange={(e) => reset(setProject)(e.target.value)}>
            <option value="">Todos los gastos</option>
            <option value="general">Solo gastos generales</option>
            {apps.data?.results.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Categoría" className="w-full sm:w-48" value={category} onChange={(e) => reset(setCategory)(e.target.value as ExpenseCategory | "")}>
            <option value="">Todas las categorías</option>
            {EXPENSE_CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <Input type="date" aria-label="Desde" className="w-full sm:w-40" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
          <Input type="date" aria-label="Hasta" className="w-full sm:w-40" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={voided} onChange={(e) => reset(setVoided)(e.target.checked)} />
            Incluir anulados
          </label>
        </div>
        <ExpensesTable rows={list.data?.results} loading={list.isPending} error={list.error} onRetry={() => void list.refetch()} />
        {list.data && list.data.count > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPageChange={setPage} />}
      </Card>
      <ExpenseFormDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
