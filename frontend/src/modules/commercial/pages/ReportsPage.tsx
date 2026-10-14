import { Link } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/Feedback";
import { DataTable } from "@/components/ui/Table";
import { formatMoney, formatMonth, formatPercent } from "@/utils/format";

import type { MovementKey } from "../api";
import { MOVEMENT_LABEL } from "../constants";
import { EstimateNote, FinanceGate, PeriodFilter } from "../components/filters";
import { useFinanceSummary, useRecurring } from "../hooks";
import { usePeriod } from "../period";

const MOVEMENTS = Object.keys(MOVEMENT_LABEL) as MovementKey[];

export function ReportsPage() {
  return (
    <FinanceGate>
      <Reports />
    </FinanceGate>
  );
}

function Reports() {
  const { state, setState, filters } = usePeriod("year");
  const summary = useFinanceSummary(filters);
  const recurring = useRecurring(filters);
  const cur = filters.currency;
  const s = summary.data;
  const breakdown = s?.expenses_breakdown;

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Desglose mensual, rentabilidad por aplicación y movimientos de ingresos recurrentes."
      />
      <PeriodFilter state={state} onChange={setState} />
      {summary.isError ? (
        <Card>
          <ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Resultado mensual" description="Cada mes con sus movimientos reales; los totales del periodo no se extrapolan." />
            <DataTable
              rows={s?.series}
              loading={summary.isPending}
              rowKey={(m) => m.month}
              caption="Resultado mensual"
              columns={[
                { key: "m", header: "Mes", cell: (m) => <span className="capitalize">{formatMonth(m.month, true)}</span> },
                { key: "subs", header: "Rentas", className: "text-right tabular-nums", hideOnMobile: true, cell: (m) => formatMoney(m.collected_subscriptions, cur) },
                { key: "sales", header: "Ventas", className: "text-right tabular-nums", hideOnMobile: true, cell: (m) => formatMoney(m.collected_sales, cur) },
                { key: "in", header: "Cobrado", className: "text-right tabular-nums", cell: (m) => formatMoney(m.collected, cur) },
                { key: "out", header: "Gastos", className: "text-right tabular-nums", cell: (m) => formatMoney(m.expenses, cur) },
                { key: "p", header: "Ganancia", className: "text-right tabular-nums", cell: (m) => formatMoney(m.profit, cur) },
                { key: "mg", header: "Margen", className: "text-right tabular-nums", cell: (m) => (m.profit === null ? "—" : formatPercent(m.margin_pct)) },
              ]}
            />
            {s && (
              <CardBody className="flex flex-wrap justify-end gap-x-8 gap-y-1 border-t border-border text-sm">
                <span className="text-muted">
                  Total cobrado <strong className="ml-1 tabular-nums text-fg">{formatMoney(s.collected, cur)}</strong>
                </span>
                <span className="text-muted">
                  Gastos <strong className="ml-1 tabular-nums text-fg">{formatMoney(s.expenses, cur)}</strong>
                </span>
                <span className="text-muted">
                  Ganancia estimada <strong className="ml-1 tabular-nums text-fg">{formatMoney(s.profit, cur)}</strong>
                </span>
                <span className="text-muted">
                  Margen <strong className="ml-1 tabular-nums text-fg">{s.profit === null ? "—" : formatPercent(s.margin_pct)}</strong>
                </span>
              </CardBody>
            )}
          </Card>

          <div className="grid gap-6 *:min-w-0 xl:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader title="Rentabilidad por aplicación" description="Gastos directos más su parte asignada de gastos generales." />
              <DataTable
                rows={s?.projects}
                loading={summary.isPending}
                rowKey={(p) => p.project}
                caption="Rentabilidad por aplicación"
                empty={<EmptyState title="Sin movimientos por aplicación" />}
                columns={[
                  { key: "n", header: "Aplicación", cell: (p) => <Link className="font-medium text-fg hover:underline" to={`/admin/projects/${p.project}?tab=comercial`}>{p.project_name}</Link> },
                  { key: "in", header: "Cobrado", className: "text-right tabular-nums", cell: (p) => formatMoney(p.collected, cur) },
                  { key: "out", header: "Gastos", className: "text-right tabular-nums", cell: (p) => formatMoney(p.expenses, cur) },
                  { key: "p", header: "Ganancia", className: "text-right tabular-nums", cell: (p) => formatMoney(p.profit, cur) },
                  { key: "m", header: "Margen", className: "text-right tabular-nums", cell: (p) => (p.profit === null ? "—" : formatPercent(p.margin_pct)) },
                ]}
              />
            </Card>
            <Card>
              <CardHeader title="Gastos del periodo" />
              <CardBody>
                {breakdown ? (
                  <dl className="space-y-2 text-sm">
                    {[
                      ["Total (cada gasto una vez)", breakdown.total],
                      ["Directos de aplicaciones", breakdown.direct],
                      ["Generales", breakdown.general],
                      ["· asignados a aplicaciones", breakdown.general_allocated],
                      ["· sin asignar", breakdown.general_unallocated],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-3">
                        <dt className="text-muted">{label}</dt>
                        <dd className="tabular-nums text-fg">{formatMoney(value, cur)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-muted">
                    {s ? "Los gastos no se separan por modelo comercial." : "Cargando…"}
                  </p>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Movimientos del MRR" description="Cambios del ingreso recurrente mensual entre el cierre de cada mes y el anterior." />
            {recurring.isError ? (
              <ErrorState message={recurring.error.message} onRetry={() => void recurring.refetch()} />
            ) : (
              <DataTable
                rows={recurring.data?.history}
                loading={recurring.isPending}
                rowKey={(h) => h.month}
                caption="Movimientos del MRR"
                empty={<EmptyState title="Sin historial" />}
                columns={[
                  { key: "m", header: "Mes", cell: (h) => <span className="capitalize">{formatMonth(h.month, true)}</span> },
                  ...MOVEMENTS.map((k) => ({
                    key: k,
                    header: MOVEMENT_LABEL[k],
                    className: "text-right tabular-nums",
                    hideOnMobile: true,
                    cell: (h: NonNullable<typeof recurring.data>["history"][number]) =>
                      h.movements[k].count ? (
                        <span title={`${h.movements[k].count} contrato(s)`}>
                          {formatMoney(h.movements[k].amount, cur)}
                          <span className="block text-xs text-muted">{h.movements[k].count}</span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      ),
                  })),
                  { key: "mrr", header: "MRR", className: "text-right tabular-nums", cell: (h) => <strong className="text-fg">{formatMoney(h.mrr, cur)}</strong> },
                  {
                    key: "g",
                    header: "Crecimiento",
                    className: "text-right tabular-nums",
                    cell: (h) => (h.growth_pct !== null ? formatPercent(h.growth_pct) : h.is_new_recurring_revenue ? "Nuevo" : "N/A"),
                  },
                ]}
              />
            )}
          </Card>
          <EstimateNote otherCurrencies={s?.other_currencies} />
        </div>
      )}
    </>
  );
}
