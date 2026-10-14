import { BarChart3, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { formatMoney, formatMonth, formatPercent } from "@/utils/format";

import type { Currency, MrrByProject, MrrPoint, SeriesPoint } from "../api";

interface SeriesDef<T> {
  key: string;
  label: string;
  color: string;
  value: (row: T) => number | null;
  mark: "bar" | "line";
}

const axisTick = { fill: "var(--muted)", fontSize: 11 };

function Swatch({ color, mark }: { color: string; mark: "bar" | "line" }) {
  return mark === "line" ? (
    <svg width="14" height="12" aria-hidden className="shrink-0">
      <line x1="0" y1="6" x2="14" y2="6" stroke={color} strokeWidth="2" />
      <circle cx="7" cy="6" r="3" fill={color} stroke="var(--surface)" strokeWidth="1.5" />
    </svg>
  ) : (
    <span aria-hidden className="size-3 shrink-0 rounded-[3px]" style={{ background: color }} />
  );
}

function Legend<T>({ series }: { series: SeriesDef<T>[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs" aria-label="Leyenda">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-muted">
          <Swatch color={s.color} mark={s.mark} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Card with a chart that can always be switched to an equivalent table. */
export function ChartCard<T>({
  title,
  description,
  rows,
  rowLabel,
  series,
  currency,
  loading,
  error,
  onRetry,
  empty,
  chart,
  height = "h-64",
}: {
  title: string;
  description?: ReactNode;
  rows: T[] | undefined;
  rowLabel: (row: T) => string;
  series: SeriesDef<T>[];
  currency: Currency;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  empty?: string;
  chart: (data: T[]) => ReactNode;
  height?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const hasData = rows?.some((r) => series.some((s) => (s.value(r) ?? 0) !== 0));
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          <button
            type="button"
            onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted hover:text-fg"
            aria-label={view === "chart" ? `Ver «${title}» como tabla` : `Ver «${title}» como gráfica`}
            title={view === "chart" ? "Ver como tabla" : "Ver como gráfica"}
          >
            {view === "chart" ? <Table2 className="size-4" /> : <BarChart3 className="size-4" />}
          </button>
        }
      />
      <div className="px-5 py-4">
        {error ? (
          <ErrorState message={error.message} onRetry={onRetry} />
        ) : loading || !rows ? (
          <Skeleton className={`${height} w-full`} />
        ) : !hasData ? (
          <EmptyState title="Sin datos suficientes" description={empty ?? "No hay movimientos registrados en este periodo."} />
        ) : view === "chart" ? (
          <>
            <Legend series={series} />
            <div className={height} role="img" aria-label={title}>
              <ResponsiveContainer width="100%" height="100%">
                {chart(rows) as React.ReactElement}
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-right text-xs tabular-nums">
              <caption className="sr-only">{title}</caption>
              <thead className="sticky top-0 bg-surface text-muted">
                <tr>
                  <th className="py-1.5 text-left font-medium">Periodo</th>
                  {series.map((s) => (
                    <th key={s.key} className="py-1.5 font-medium">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-fg">
                {rows.map((r) => (
                  <tr key={rowLabel(r)}>
                    <td className="py-1.5 text-left">{rowLabel(r)}</td>
                    {series.map((s) => (
                      <td key={s.key} className="py-1.5">
                        {s.value(r) === null ? "—" : formatMoney(s.value(r), currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function MoneyTooltip<T>({
  active,
  payload,
  series,
  currency,
  title,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  series: SeriesDef<T>[];
  currency: Currency;
  title: (row: T) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as T;
  return (
    <div className="min-w-48 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium text-fg first-letter:uppercase">{title(row)}</p>
      {series.map((s) => (
        <div key={s.key} className="flex items-center gap-2 py-0.5">
          <Swatch color={s.color} mark={s.mark} />
          <span className="text-muted">{s.label}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums text-fg">
            {s.value(row) === null ? "—" : formatMoney(s.value(row), currency)}
          </span>
        </div>
      ))}
    </div>
  );
}

const num = (v: string | null) => (v === null ? null : Number(v));
const compactAxis = (currency: Currency) => (v: number) => formatMoney(v, currency, true);

export function IncomeExpenseChart({
  series: rows,
  currency,
  loading,
  error,
  onRetry,
}: {
  series: SeriesPoint[] | undefined;
  currency: Currency;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}) {
  const expensesAvailable = rows?.every((r) => r.expenses !== null) ?? true;
  const defs: SeriesDef<SeriesPoint>[] = [
    { key: "collected", label: "Ingresos cobrados", color: "var(--fin-income)", value: (r) => num(r.collected), mark: "bar" },
    ...(expensesAvailable
      ? ([
          { key: "expenses", label: "Gastos", color: "var(--fin-expense)", value: (r) => num(r.expenses), mark: "bar" },
          { key: "profit", label: "Ganancia estimada", color: "var(--fin-profit)", value: (r) => num(r.profit), mark: "line" },
        ] satisfies SeriesDef<SeriesPoint>[])
      : []),
  ];
  return (
    <ChartCard
      title="Ingresos, gastos y ganancia por mes"
      description={
        expensesAvailable
          ? "Pagos recibidos y gastos registrados en cada mes."
          : "Los gastos no se atribuyen a un modelo comercial: con ese filtro solo se muestran ingresos."
      }
      rows={rows}
      rowLabel={(r) => formatMonth(r.month)}
      series={defs}
      currency={currency}
      loading={loading}
      error={error}
      onRetry={onRetry}
      chart={(data) => (
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickFormatter={(m: string) => formatMonth(m)} tick={axisTick} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={12} />
          <YAxis tickFormatter={compactAxis(currency)} tick={axisTick} axisLine={false} tickLine={false} width={64} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={(p) => (
              <MoneyTooltip active={p.active} payload={p.payload} series={defs} currency={currency} title={(r) => formatMonth(r.month, true)} />
            )}
          />
          {defs.map((s) =>
            s.mark === "bar" ? (
              <Bar key={s.key} dataKey={(r: SeriesPoint) => s.value(r)} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            ) : (
              <Line key={s.key} dataKey={(r: SeriesPoint) => s.value(r)} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 4, fill: s.color, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
            ),
          )}
        </ComposedChart>
      )}
    />
  );
}

export function RevenueMixChart({
  series: rows,
  currency,
  loading,
}: {
  series: SeriesPoint[] | undefined;
  currency: Currency;
  loading?: boolean;
}) {
  const defs: SeriesDef<SeriesPoint>[] = [
    { key: "subs", label: "Rentas", color: "var(--fin-subscription)", value: (r) => num(r.collected_subscriptions), mark: "bar" },
    { key: "sales", label: "Ventas únicas", color: "var(--fin-sale)", value: (r) => num(r.collected_sales), mark: "bar" },
  ];
  return (
    <ChartCard
      title="Ingresos por rentas y ventas"
      description="Dinero efectivamente cobrado de cada modelo comercial."
      rows={rows}
      rowLabel={(r) => formatMonth(r.month)}
      series={defs}
      currency={currency}
      loading={loading}
      chart={(data) => (
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickFormatter={(m: string) => formatMonth(m)} tick={axisTick} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={12} />
          <YAxis tickFormatter={compactAxis(currency)} tick={axisTick} axisLine={false} tickLine={false} width={64} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={(p) => (
              <MoneyTooltip active={p.active} payload={p.payload} series={defs} currency={currency} title={(r) => formatMonth(r.month, true)} />
            )}
          />
          {defs.map((s) => (
            <Bar key={s.key} dataKey={(r: SeriesPoint) => s.value(r)} name={s.label} stackId="mix" fill={s.color} stroke="var(--surface)" strokeWidth={2} maxBarSize={28} isAnimationActive={false} />
          ))}
        </BarChart>
      )}
    />
  );
}

export function RecurringTrendChart({
  history,
  metric,
  currency,
  loading,
  error,
  onRetry,
}: {
  history: MrrPoint[] | undefined;
  metric: "mrr" | "arr";
  currency: Currency;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}) {
  const defs: SeriesDef<MrrPoint>[] = [
    {
      key: metric,
      label: metric === "mrr" ? "MRR" : "ARR",
      color: "var(--fin-subscription)",
      value: (r) => Number(r[metric]),
      mark: "line",
    },
  ];
  return (
    <ChartCard
      title={metric === "mrr" ? "Evolución mensual del MRR" : "Evolución mensual del ARR"}
      description={
        metric === "mrr"
          ? "MRR contratado al cierre de cada mes (el mes en curso, a hoy)."
          : "ARR = MRR × 12. Valor anualizado contratado, no dinero cobrado."
      }
      rows={history}
      rowLabel={(r) => formatMonth(r.month)}
      series={defs}
      currency={currency}
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty="Aún no hay rentas activas en el periodo."
      height="h-56"
      chart={(data) => (
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickFormatter={(m: string) => formatMonth(m)} tick={axisTick} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={12} />
          <YAxis tickFormatter={compactAxis(currency)} tick={axisTick} axisLine={false} tickLine={false} width={64} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={(p) => {
              if (!p.active || !p.payload?.length) return null;
              const row = p.payload[0].payload as MrrPoint;
              return (
                <div className="min-w-48 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
                  <p className="mb-1.5 font-medium text-fg first-letter:uppercase">{formatMonth(row.month, true)}</p>
                  <p className="flex justify-between gap-3">
                    <span className="text-muted">{metric === "mrr" ? "MRR" : "ARR"}</span>
                    <span className="font-medium tabular-nums text-fg">{formatMoney(row[metric], currency)}</span>
                  </p>
                  <p className="flex justify-between gap-3">
                    <span className="text-muted">Crecimiento</span>
                    <span className="tabular-nums text-fg">
                      {row.growth_pct !== null ? formatPercent(row.growth_pct) : row.is_new_recurring_revenue ? "Nuevo" : "N/A"}
                    </span>
                  </p>
                  <p className="flex justify-between gap-3">
                    <span className="text-muted">Contratos activos</span>
                    <span className="tabular-nums text-fg">{row.active_contracts}</span>
                  </p>
                </div>
              );
            }}
          />
          <Line
            dataKey={metric}
            stroke="var(--fin-subscription)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--fin-subscription)", stroke: "var(--surface)", strokeWidth: 2 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      )}
    />
  );
}

export function MrrByProjectChart({
  rows,
  currency,
  loading,
}: {
  rows: MrrByProject[] | undefined;
  currency: Currency;
  loading?: boolean;
}) {
  const top = rows?.slice(0, 8);
  const defs: SeriesDef<MrrByProject>[] = [
    { key: "mrr", label: "MRR", color: "var(--fin-subscription)", value: (r) => Number(r.mrr), mark: "bar" },
  ];
  return (
    <ChartCard
      title="MRR por aplicación"
      description={rows && rows.length > 8 ? "Las 8 aplicaciones con mayor ingreso recurrente." : "Ingreso recurrente mensual actual de cada aplicación."}
      rows={top}
      rowLabel={(r) => r.project_name}
      series={defs}
      currency={currency}
      loading={loading}
      empty="Ninguna aplicación tiene rentas activas."
      height="h-56"
      chart={(data) => (
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" tickFormatter={compactAxis(currency)} tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="project_name" tick={axisTick} axisLine={false} tickLine={false} width={120} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={(p) => (
              <MoneyTooltip active={p.active} payload={p.payload} series={defs} currency={currency} title={(r) => r.project_name} />
            )}
          />
          <Bar dataKey={(r: MrrByProject) => Number(r.mrr)} name="MRR" fill="var(--fin-subscription)" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false} />
        </BarChart>
      )}
    />
  );
}
