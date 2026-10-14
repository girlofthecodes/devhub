import {
  AlertTriangle,
  AppWindow,
  Banknote,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  FileSignature,
  HandCoins,
  Percent,
  Receipt,
  Repeat,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Link } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/Feedback";
import { DataTable } from "@/components/ui/Table";
import { formatDay, formatMoney, formatPercent } from "@/utils/format";

import { IncomeExpenseChart, MrrByProjectChart, RecurringTrendChart, RevenueMixChart } from "../components/charts";
import { EstimateNote, FinanceGate, KpiCard, PeriodFilter } from "../components/filters";
import { ContractsTable, ReceivableStatusBadge } from "../components/tables";
import { useContracts, useFinanceSummary, useRecurring, useUpcoming } from "../hooks";
import { growthLabel, usePeriod } from "../period";

export function BusinessOverviewPage() {
  return (
    <FinanceGate>
      <Overview />
    </FinanceGate>
  );
}

function Overview() {
  const { state, setState, filters } = usePeriod("year");
  const summary = useFinanceSummary(filters);
  const recurring = useRecurring(filters);
  const upcoming = useUpcoming(filters.project);
  const active = useContracts({ status: "ACTIVE", page_size: 5, project: filters.project, kind: filters.kind });
  const s = summary.data;
  const r = recurring.data;
  const cur = filters.currency;
  const loading = summary.isPending;

  return (
    <>
      <PageHeader
        title="Negocio y Rentabilidad"
        description="Estado comercial del portafolio con los movimientos reales registrados en el periodo."
      />
      <PeriodFilter state={state} onChange={setState} />

      {summary.isError ? (
        <Card>
          <ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="kpi-portfolio">
            <h2 id="kpi-portfolio" className="mb-3 text-sm font-semibold text-fg">
              Portafolio
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <KpiCard label="Aplicaciones registradas" value={s?.total_projects} icon={AppWindow} loading={loading} />
              <KpiCard label="Comercializables" value={s?.commercial_projects} icon={BriefcaseBusiness} loading={loading} />
              <KpiCard label="Con contratos activos" value={s?.projects_with_active_contracts} icon={FileSignature} loading={loading} />
              <KpiCard label="Clientes con contrato activo" value={s?.organizations_with_active_contracts} icon={Building2} hint="Organizaciones, no usuarios finales" loading={loading} />
              <KpiCard label="Rentas activas" value={s?.active_subscriptions} icon={Repeat} loading={loading} />
              <KpiCard label="Ventas realizadas" value={s?.sales_in_period} icon={HandCoins} hint="En el periodo" loading={loading} />
            </div>
          </section>

          <section aria-labelledby="kpi-money" className="space-y-3">
            <h2 id="kpi-money" className="text-sm font-semibold text-fg">
              Dinero del periodo · {formatDay(filters.date_from)} – {formatDay(filters.date_to)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <KpiCard label="Ingresos cobrados" value={formatMoney(s?.collected, cur)} icon={Wallet} hint="Pagos recibidos" loading={loading} />
              <KpiCard label="Ingresos esperados" value={formatMoney(s?.expected, cur)} icon={CalendarClock} hint="Cobros con vencimiento en el periodo" loading={loading} />
              <KpiCard
                label="Pagos vencidos"
                value={formatMoney(s?.overdue_amount, cur)}
                icon={AlertTriangle}
                tone={s && s.overdue_count > 0 ? "danger" : "neutral"}
                hint={s ? `${s.overdue_count} cobro(s) al día de hoy` : undefined}
                loading={loading}
              />
              <KpiCard
                label="Gastos registrados"
                value={s?.expenses === null ? "No aplica" : formatMoney(s?.expenses, cur)}
                icon={Receipt}
                hint={s?.expenses === null ? "Los gastos no se separan por modelo" : undefined}
                loading={loading}
              />
              <KpiCard
                label="Ganancia estimada"
                value={s?.profit === null ? "No aplica" : formatMoney(s?.profit, cur)}
                icon={Banknote}
                tone={s?.profit && Number(s.profit) < 0 ? "danger" : "neutral"}
                loading={loading}
              />
              <KpiCard
                label="Margen de rentabilidad"
                value={s?.profit === null ? "No aplica" : s?.margin_pct === null ? "No disponible" : formatPercent(s?.margin_pct)}
                icon={Percent}
                hint={s && s.margin_pct === null && s.profit !== null ? "Sin ingresos cobrados en el periodo" : undefined}
                loading={loading}
              />
            </div>
            <EstimateNote otherCurrencies={s?.other_currencies} />
          </section>

          <section aria-labelledby="kpi-recurring" className="space-y-3">
            <h2 id="kpi-recurring" className="text-sm font-semibold text-fg">
              Ingresos recurrentes {r && <span className="font-normal text-muted">· MRR al {formatDay(r.as_of)}</span>}
            </h2>
            {recurring.isError ? (
              <Card>
                <ErrorState message={recurring.error.message} onRetry={() => void recurring.refetch()} />
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <KpiCard label="MRR actual" value={formatMoney(r?.mrr, cur)} icon={Repeat} hint="Valor mensual contratado" loading={recurring.isPending} />
                <KpiCard label="ARR actual" value={formatMoney(r?.arr, cur)} icon={TrendingUp} hint="MRR × 12 (no es dinero cobrado)" loading={recurring.isPending} />
                <KpiCard
                  label="Crecimiento mensual del MRR"
                  value={growthLabel(r)}
                  icon={TrendingUp}
                  tone={r?.growth_pct && Number(r.growth_pct) < 0 ? "danger" : "neutral"}
                  hint={r ? `vs. ${formatMoney(r.previous_month_mrr, cur)} al ${formatDay(r.previous_month_as_of)}` : undefined}
                  loading={recurring.isPending}
                />
                <KpiCard
                  label="Contratos recurrentes activos"
                  value={r?.active_contracts}
                  icon={FileSignature}
                  hint={r && r.suspended_contracts > 0 ? `${r.suspended_contracts} suspendido(s), fuera del MRR` : undefined}
                  loading={recurring.isPending}
                />
                <KpiCard label="Organizaciones con suscripción" value={r?.organizations} icon={Building2} loading={recurring.isPending} />
                <KpiCard label="Recurrentes cobrados" value={formatMoney(r?.recurring_collected, cur)} icon={Wallet} hint="Pagos de rentas en el periodo" loading={recurring.isPending} />
                <KpiCard label="Recurrentes pendientes" value={formatMoney(r?.recurring_pending, cur)} icon={CalendarClock} hint="Saldo de rentas con vencimiento en el periodo" loading={recurring.isPending} />
                <KpiCard label="Ingresos por rentas" value={r?.subscriptions_pct === null ? "Sin ingresos" : formatPercent(r?.subscriptions_pct)} icon={Percent} hint="Del total cobrado" loading={recurring.isPending} />
                <KpiCard label="Ingresos por ventas únicas" value={r?.sales_pct === null ? "Sin ingresos" : formatPercent(r?.sales_pct)} icon={Percent} hint="Del total cobrado" loading={recurring.isPending} />
                <KpiCard label="Ingreso promedio por contrato" value={r?.average_per_contract ? formatMoney(r.average_per_contract, cur) : "—"} icon={HandCoins} hint="MRR ÷ contratos recurrentes" loading={recurring.isPending} />
              </div>
            )}
          </section>

          <div className="grid gap-6 *:min-w-0 xl:grid-cols-2">
            <IncomeExpenseChart series={s?.series} currency={cur} loading={loading} />
            <RevenueMixChart series={s?.series} currency={cur} loading={loading} />
            <RecurringTrendChart history={r?.history} metric="mrr" currency={cur} loading={recurring.isPending} />
            <RecurringTrendChart history={r?.history} metric="arr" currency={cur} loading={recurring.isPending} />
            <MrrByProjectChart rows={r?.by_project} currency={cur} loading={recurring.isPending} />
            <Card>
              <CardHeader title="Aplicaciones con mayor ingreso recurrente" description="Ranking por MRR actual." />
              <DataTable
                rows={r?.by_project.slice(0, 5)}
                loading={recurring.isPending}
                rowKey={(x) => x.project}
                caption="Aplicaciones con mayor MRR"
                empty={<EmptyState title="Sin rentas activas" />}
                columns={[
                  { key: "name", header: "Aplicación", cell: (x) => <Link className="font-medium text-fg hover:underline" to={`/admin/projects/${x.project}?tab=comercial`}>{x.project_name}</Link> },
                  { key: "mrr", header: "MRR", className: "text-right tabular-nums", cell: (x) => formatMoney(x.mrr, cur) },
                  { key: "arr", header: "ARR", className: "text-right tabular-nums", hideOnMobile: true, cell: (x) => formatMoney(x.arr, cur) },
                  { key: "n", header: "Contratos", className: "text-right tabular-nums", cell: (x) => x.contracts },
                ]}
              />
            </Card>
          </div>

          <div className="grid gap-6 *:min-w-0 xl:grid-cols-2">
            <Card>
              <CardHeader title="Aplicaciones más rentables" description="Ganancia estimada del periodo (cobrado − gastos atribuibles)." />
              <DataTable
                rows={s?.projects.slice(0, 5)}
                loading={loading}
                rowKey={(x) => x.project}
                caption="Aplicaciones más rentables"
                empty={<EmptyState title="Sin movimientos" description="No hay ingresos ni gastos por aplicación en el periodo." />}
                columns={[
                  { key: "name", header: "Aplicación", cell: (x) => <Link className="font-medium text-fg hover:underline" to={`/admin/projects/${x.project}?tab=comercial`}>{x.project_name}</Link> },
                  { key: "in", header: "Cobrado", className: "text-right tabular-nums", cell: (x) => formatMoney(x.collected, cur) },
                  { key: "out", header: "Gastos", className: "text-right tabular-nums", hideOnMobile: true, cell: (x) => formatMoney(x.expenses, cur) },
                  { key: "profit", header: "Ganancia", className: "text-right tabular-nums", cell: (x) => formatMoney(x.profit, cur) },
                  { key: "margin", header: "Margen", className: "text-right tabular-nums", cell: (x) => (x.profit === null ? "—" : formatPercent(x.margin_pct)) },
                ]}
              />
            </Card>
            <Card>
              <CardHeader
                title="Próximos cobros"
                description={upcoming.data && upcoming.data.overdue.length > 0 ? `${upcoming.data.overdue.length} cobro(s) vencido(s)` : "Siguientes 60 días"}
                actions={<Link to="/admin/business/receivables" className="text-sm font-medium text-accent hover:underline">Ver cobros</Link>}
              />
              <DataTable
                rows={upcoming.data ? [...upcoming.data.overdue, ...upcoming.data.upcoming].slice(0, 8) : undefined}
                loading={upcoming.isPending}
                error={upcoming.error}
                rowKey={(x) => x.id}
                caption="Próximos cobros"
                empty={<EmptyState title="Sin cobros pendientes" />}
                columns={[
                  { key: "c", header: "Cobro", cell: (x) => <span><span className="block text-fg">{x.project_name}</span><span className="text-xs text-muted">{x.organization_name}</span></span> },
                  { key: "d", header: "Vence", cell: (x) => formatDay(x.due_date) },
                  { key: "a", header: "Saldo", className: "text-right tabular-nums", cell: (x) => formatMoney(x.outstanding_amount, x.currency) },
                  { key: "s", header: "Estado", cell: (x) => <ReceivableStatusBadge status={x.effective_status} /> },
                ]}
              />
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Contratos activos"
              description={active.data ? `${active.data.count} en total` : undefined}
              actions={<Link to="/admin/business/contracts" className="text-sm font-medium text-accent hover:underline">Ver contratos</Link>}
            />
            <ContractsTable rows={active.data?.results} loading={active.isPending} error={active.error} empty="Aún no hay contratos activos." />
          </Card>
          {upcoming.data && upcoming.data.expiring_contracts.length > 0 && (
            <Card>
              <CardHeader title="Contratos próximos a terminar" description="Finalizan en los siguientes 60 días." />
              <ContractsTable rows={upcoming.data.expiring_contracts} />
            </Card>
          )}
        </div>
      )}
    </>
  );
}
