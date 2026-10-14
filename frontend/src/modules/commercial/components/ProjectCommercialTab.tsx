import { Banknote, Building2, CalendarClock, FileSignature, Percent, Plus, Receipt, Repeat, Settings2, TrendingUp, Wallet } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/Feedback";
import { formatDay, formatMoney, formatPercent } from "@/utils/format";

import { commercialTone, KIND_SHORT } from "../constants";
import { useApplication, useContracts, useExpenses, useFinanceAccess, useProjectProfitability, useReceivables } from "../hooks";
import { ExpensesTable } from "../pages/ExpensesPage";
import { IncomeExpenseChart, RecurringTrendChart } from "./charts";
import { ContractFormDialog, ExpenseFormDialog, ProfileDialog } from "./dialogs";
import { growthLabel, usePeriod } from "../period";
import { EstimateNote, KpiCard, PeriodFilter } from "./filters";
import { ContractsTable, ReceivablesTable } from "./tables";

/** "Comercial / Rentabilidad" tab of a project (admin panel, finance permissions only). */
export function ProjectCommercialTab({ project }: { project: { id: string; name: string; is_archived: boolean } }) {
  const { canManage } = useFinanceAccess();
  const { state, setState, filters } = usePeriod("year");
  const app = useApplication(project.id);
  const summary = useProjectProfitability(project.id, filters);
  const sales = useContracts({ project: project.id, kind: "SALE", page_size: 50 });
  const rentals = useContracts({ project: project.id, kind: "SUBSCRIPTION", page_size: 50 });
  const upcoming = useReceivables({ project: project.id, status: "OPEN", page_size: 10, ordering: "due_date" });
  const expenses = useExpenses({ project: project.id, page_size: 10, date_from: filters.date_from, date_to: filters.date_to });
  const [configuring, setConfiguring] = useState(false);
  const [newContract, setNewContract] = useState(false);
  const [newExpense, setNewExpense] = useState(false);
  const s = summary.data;
  const cur = filters.currency;
  const loading = summary.isPending;

  const clients = new Map<string, { name: string; contracts: string[] }>();
  for (const c of [...(sales.data?.results ?? []), ...(rentals.data?.results ?? [])]) {
    if (c.status !== "ACTIVE") continue;
    const row = clients.get(c.organization) ?? { name: c.organization_name, contracts: [] };
    row.contracts.push(KIND_SHORT[c.kind]);
    clients.set(c.organization, row);
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Estado comercial</p>
            <div className="flex flex-wrap items-center gap-2">
              {app.data && <Badge tone={commercialTone(app.data.commercial_status)}>{app.data.commercial_status_label}</Badge>}
              <span className="text-sm text-muted">
                {app.data?.modalities.length ? `Modalidades: ${app.data.modalities.map((m) => KIND_SHORT[m]).join(" y ")}` : "Sin modalidades disponibles"}
              </span>
              {app.data?.end_users_count != null && (
                <span className="text-sm text-muted">· {app.data.end_users_count} usuarios finales (dato informativo)</span>
              )}
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" icon={<Settings2 className="size-4" />} onClick={() => setConfiguring(true)} disabled={!app.data}>
                Configurar estado comercial
              </Button>
              {!project.is_archived && (
                <Button icon={<Plus className="size-4" />} onClick={() => setNewContract(true)} disabled={!app.data?.modalities.length}>
                  Registrar venta o renta
                </Button>
              )}
              <Button variant="outline" icon={<Receipt className="size-4" />} onClick={() => setNewExpense(true)}>
                Registrar gasto
              </Button>
            </div>
          )}
        </div>
      </Card>

      <PeriodFilter state={state} onChange={setState} showProject={false} />

      {summary.isError ? (
        <Card>
          <ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="MRR de la aplicación" value={formatMoney(s?.mrr, cur)} icon={Repeat} hint={growthLabel(s)} loading={loading} />
            <KpiCard label="ARR de la aplicación" value={formatMoney(s?.arr, cur)} icon={TrendingUp} hint="MRR × 12" loading={loading} />
            <KpiCard
              label="Contratos activos"
              value={s?.active_contracts}
              icon={FileSignature}
              hint={s ? `${s.recurring_contracts} renta(s) en MRR${s.suspended_contracts ? ` · ${s.suspended_contracts} suspendida(s)` : ""}` : undefined}
              loading={loading}
            />
            <KpiCard label="Organizaciones con contrato" value={s?.organizations_with_active_contracts} icon={Building2} loading={loading} />
            <KpiCard label="Ingreso recurrente promedio" value={s?.average_per_contract ? formatMoney(s.average_per_contract, cur) : "—"} icon={Repeat} hint="MRR ÷ contratos recurrentes activos" loading={loading} />
            <KpiCard label="Ingresos cobrados" value={formatMoney(s?.collected, cur)} icon={Wallet} hint={s ? `Ventas únicas: ${formatMoney(s.sales_collected, cur)}` : undefined} loading={loading} />
            <KpiCard
              label="Ingresos esperados"
              value={formatMoney(s?.expected, cur)}
              icon={CalendarClock}
              hint={s && s.overdue_count > 0 ? `${formatMoney(s.overdue_amount, cur)} vencido` : "Cobros con vencimiento en el periodo"}
              tone={s && s.overdue_count > 0 ? "danger" : "neutral"}
              loading={loading}
            />
            <KpiCard label="Gastos asociados" value={s?.expenses === null ? "No aplica" : formatMoney(s?.expenses, cur)} icon={Receipt} hint="Directos + parte asignada de generales" loading={loading} />
            <KpiCard
              label="Ganancia operativa estimada"
              value={s?.profit === null ? "No aplica" : formatMoney(s?.profit, cur)}
              icon={Banknote}
              tone={s?.profit && Number(s.profit) < 0 ? "danger" : "neutral"}
              loading={loading}
            />
            <KpiCard
              label="Margen de rentabilidad"
              value={s?.profit === null ? "No aplica" : s?.margin_pct === null ? "No disponible" : formatPercent(s?.margin_pct)}
              icon={Percent}
              hint={s && s.margin_pct === null && s.profit !== null ? "Sin ingresos cobrados" : undefined}
              loading={loading}
            />
          </div>
          <EstimateNote />
          <div className="grid gap-6 *:min-w-0 xl:grid-cols-2">
            <IncomeExpenseChart series={s?.series} currency={cur} loading={loading} />
            <RecurringTrendChart history={s?.mrr_history} metric="mrr" currency={cur} loading={loading} />
          </div>
        </>
      )}

      <div className="grid gap-6 *:min-w-0 xl:grid-cols-2">
        <Card>
          <CardHeader title="Próximos vencimientos" description="Cobros pendientes de esta aplicación." />
          <ReceivablesTable rows={upcoming.data?.results} loading={upcoming.isPending} error={upcoming.error} empty="No hay cobros pendientes." />
        </Card>
        <Card>
          <CardHeader title="Clientes con contrato activo" description="Organizaciones (no usuarios finales)." />
          <ul className="divide-y divide-border">
            {clients.size === 0 ? (
              <li className="px-5 py-6 text-center text-sm text-muted">Ninguna organización tiene un contrato activo.</li>
            ) : (
              [...clients.entries()].map(([id, c]) => (
                <li key={id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <Link to={`/admin/organizations/${id}`} className="font-medium text-fg hover:underline">
                    {c.name}
                  </Link>
                  <span className="text-muted">{c.contracts.join(" · ")}</span>
                </li>
              ))
            )}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Historial de rentas" description={rentals.data ? `${rentals.data.count} contrato(s)` : undefined} />
        <ContractsTable rows={rentals.data?.results} loading={rentals.isPending} error={rentals.error} hideProject empty="Esta aplicación no tiene rentas registradas." />
      </Card>
      <Card>
        <CardHeader title="Historial de ventas" description={sales.data ? `${sales.data.count} venta(s)` : undefined} />
        <ContractsTable rows={sales.data?.results} loading={sales.isPending} error={sales.error} hideProject empty="Esta aplicación no tiene ventas registradas." />
      </Card>
      <Card>
        <CardHeader
          title="Gastos directos y asignados"
          description={`${formatDay(filters.date_from)} – ${formatDay(filters.date_to)}`}
          actions={<Link to="/admin/business/expenses" className="text-sm font-medium text-accent hover:underline">Ver todos</Link>}
        />
        <ExpensesTable rows={expenses.data?.results} loading={expenses.isPending} error={expenses.error} />
      </Card>

      <ProfileDialog app={configuring ? (app.data ?? null) : null} onClose={() => setConfiguring(false)} />
      <ContractFormDialog open={newContract} project={{ id: project.id, name: project.name }} onClose={() => setNewContract(false)} />
      <ExpenseFormDialog open={newExpense} project={{ id: project.id, name: project.name }} onClose={() => setNewExpense(false)} />
    </div>
  );
}
