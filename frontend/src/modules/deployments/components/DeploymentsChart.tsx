import { BarChart3, Table2 } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { cn } from "@/utils/cn";

import type { DeploymentStats } from "../api";
import { useDeploymentStats } from "../hooks";

type Series = "SUCCESS" | "IN_PROGRESS" | "CANCELLED" | "FAILED";

// Stack order keeps green and red apart (they are hard to tell apart with deuteranopia);
// "failed" additionally carries a hatch texture so it never relies on color alone.
const SERIES: { key: Series; label: string; color: string; fill: string }[] = [
  { key: "SUCCESS", label: "Exitosos", color: "var(--chart-success)", fill: "var(--chart-success)" },
  { key: "IN_PROGRESS", label: "En curso", color: "var(--chart-running)", fill: "var(--chart-running)" },
  { key: "CANCELLED", label: "Cancelados", color: "var(--chart-cancelled)", fill: "var(--chart-cancelled)" },
  { key: "FAILED", label: "Fallidos", color: "var(--chart-failed)", fill: "url(#deploy-hatch-failed)" },
];
const RANGES = [7, 14, 30] as const;

const shortDate = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
const longDate = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" });
const parseDay = (iso: string) => new Date(`${iso}T12:00:00`);

function Swatch({ series }: { series: (typeof SERIES)[number] }) {
  return (
    <svg width="12" height="12" aria-hidden className="shrink-0 rounded-[3px]">
      <rect width="12" height="12" fill={series.color} />
      {series.key === "FAILED" && <path d="M-2,4 l6,-6 M0,12 l12,-12 M8,14 l6,-6" stroke="var(--surface)" strokeWidth="1.5" />}
    </svg>
  );
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  label?: string | number;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length || !label) return null;
  const row = payload[0].payload as DeploymentStats["days"][number];
  const total = SERIES.reduce((sum, s) => sum + row[s.key], 0);
  return (
    <div className="min-w-44 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium text-fg first-letter:uppercase">{longDate.format(parseDay(String(label)))}</p>
      {[...SERIES].reverse().map((s) => (
        <div key={s.key} className="flex items-center gap-2 py-0.5">
          <Swatch series={s} />
          <span className="text-muted">{s.label}</span>
          <span className="ml-auto font-medium tabular-nums text-fg">{row[s.key]}</span>
        </div>
      ))}
      <div className="mt-1 flex border-t border-border pt-1 text-muted">
        Total <span className="ml-auto font-medium tabular-nums text-fg">{total}</span>
      </div>
    </div>
  );
}

export function DeploymentsChart({ project, title = "Despliegues por día" }: { project?: string; title?: string }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(14);
  const [view, setView] = useState<"chart" | "table">("chart");
  const stats = useDeploymentStats(days, project);
  const data = stats.data;
  const total = data ? SERIES.reduce((sum, s) => sum + data.totals[s.key], 0) : 0;

  return (
    <Card>
      <CardHeader
        title={title}
        description={
          data
            ? `${total} en ${days} días · tasa de éxito ${data.success_rate === null ? "—" : `${Math.round(data.success_rate * 100)} %`}`
            : `Últimos ${days} días`
        }
        actions={
          <div className="flex items-center gap-2">
            <div role="radiogroup" aria-label="Rango" className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={days === r}
                  onClick={() => setDays(r)}
                  className={cn("rounded-md px-2 py-1 text-muted hover:text-fg", days === r && "bg-surface text-fg shadow-xs")}
                >
                  {r} d
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted hover:text-fg"
              aria-label={view === "chart" ? "Ver como tabla" : "Ver como gráfica"}
              title={view === "chart" ? "Ver como tabla" : "Ver como gráfica"}
            >
              {view === "chart" ? <Table2 className="size-4" /> : <BarChart3 className="size-4" />}
            </button>
          </div>
        }
      />
      <div className="px-5 py-4">
        {stats.isError ? (
          <ErrorState message={stats.error.message} onRetry={() => void stats.refetch()} />
        ) : !data ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <>
            <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs" aria-label="Leyenda">
              {SERIES.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5 text-muted">
                  <Swatch series={s} />
                  {s.label}
                  <span className="font-medium tabular-nums text-fg">{data.totals[s.key]}</span>
                </li>
              ))}
            </ul>
            {view === "chart" ? (
              <div className="h-56" role="img" aria-label={`${title}: ${total} despliegues en ${days} días`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.days} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} barCategoryGap="25%">
                    <defs>
                      <pattern id="deploy-hatch-failed" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width="6" height="6" fill="var(--chart-failed)" />
                        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="1.5" strokeOpacity="0.55" />
                      </pattern>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => shortDate.format(parseDay(d))}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      axisLine={{ stroke: "var(--border)" }}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={16}
                    />
                    <YAxis allowDecimals={false} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} />} cursor={{ fill: "var(--surface-2)" }} />
                    {SERIES.map((s) => (
                      <Bar key={s.key} dataKey={s.key} name={s.label} stackId="d" fill={s.fill} stroke="var(--surface)" strokeWidth={2} maxBarSize={28} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-right text-xs tabular-nums">
                  <caption className="sr-only">{title}</caption>
                  <thead className="sticky top-0 bg-surface text-muted">
                    <tr>
                      <th className="py-1 text-left font-medium">Día</th>
                      {SERIES.map((s) => (
                        <th key={s.key} className="py-1 font-medium">
                          {s.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-fg">
                    {[...data.days].reverse().map((d) => (
                      <tr key={d.date}>
                        <td className="py-1 text-left">{shortDate.format(parseDay(d.date))}</td>
                        {SERIES.map((s) => (
                          <td key={s.key} className="py-1">
                            {d[s.key]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
