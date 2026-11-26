import { Bell, BellRing, CheckCheck, Pause, Play } from "lucide-react";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/utils/cn";
import { formatRelative } from "@/utils/format";

import type { HealthStatus } from "./api";
import { HEALTH } from "./constants";
import type { AlertStatus, DailyUptime, HourCell, MetricPoint, ResponsePoint, Severity } from "./metricsApi";
import { ALERT_STATUS, num, pct, SEVERITY } from "./metricsFormat";

export function SeverityBadge({ severity }: { severity: Severity }) {
  const meta = SEVERITY[severity];
  const Icon = severity === "CRITICAL" ? BellRing : Bell;
  return (
    <Badge tone={meta.tone} className={cn("gap-1", severity === "CRITICAL" && "font-semibold")}>
      <Icon className="size-3" aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const meta = ALERT_STATUS[status];
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function AlertCount({ count, severity }: { count: number; severity: Severity | null }) {
  if (!count) return <span className="inline-flex items-center gap-1 text-xs text-muted"><CheckCheck className="size-3.5" aria-hidden /> 0</span>;
  return (
    <Badge tone={severity ? SEVERITY[severity].tone : "warning"} className="gap-1 tabular-nums">
      {severity === "CRITICAL" ? <BellRing className="size-3" aria-hidden /> : <Bell className="size-3" aria-hidden />}
      {count}
    </Badge>
  );
}

// --- live indicator -------------------------------------------------------------------

export function LiveIndicator({
  live,
  onToggle,
  updatedAt,
  fetching,
}: {
  live: boolean;
  onToggle: () => void;
  updatedAt: number | undefined;
  fetching: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted" aria-live="polite">
        <span className="relative flex size-2">
          {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
          <span className={cn("relative inline-flex size-2 rounded-full", live ? "bg-emerald-500" : "bg-zinc-400")} />
        </span>
        <span className="whitespace-nowrap font-medium text-fg">{live ? "En vivo" : "En pausa"}</span>
        <span className="hidden whitespace-nowrap sm:inline">
          · {fetching ? "actualizando…" : updatedAt ? `actualizado ${formatRelative(new Date(updatedAt).toISOString())}` : "—"}
        </span>
      </span>
      <Button size="sm" variant="outline" onClick={onToggle} icon={live ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}>
        {live ? "Pausar" : "Reanudar"}
      </Button>
    </div>
  );
}

// --- tiles ----------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "danger" | "warning" | "success";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {icon}
      </div>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums text-fg",
          tone === "danger" && "text-red-600 dark:text-red-400",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

/** Thin meter for a 0–100 % metric; the number is always printed beside it. */
export function Meter({ value, warn = 85, crit = 95, label }: { value: number | null | undefined; warn?: number; crit?: number; label: string }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const color = value >= crit ? "var(--chart-failed)" : value >= warn ? "var(--chart-cancelled)" : "var(--series-1)";
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={`${label}: ${value.toFixed(0)} %`}>
      <span className="w-8 text-muted">{label === "Memoria" ? "Mem" : label}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </span>
      <span className="w-10 text-right tabular-nums text-fg">{value.toFixed(0)} %</span>
    </span>
  );
}

// --- 24 h history strip ---------------------------------------------------------------

const hourFmt = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

export function HistoryStrip({ cells, className }: { cells: HourCell[]; className?: string }) {
  if (!cells.length) return <span className="text-xs text-muted">Sin health check</span>;
  const down = cells.filter((c) => c.status === "UNAVAILABLE").length;
  return (
    <div
      className={cn("flex h-6 items-stretch gap-[2px]", className)}
      role="img"
      aria-label={`Últimas 24 h: ${down ? `${down} hora(s) con caídas` : "sin caídas"}`}
    >
      {cells.map((c) => (
        <span
          key={c.hour}
          title={`${hourFmt.format(new Date(c.hour))} · ${c.status ? HEALTH[c.status].label : "Sin datos"}${c.uptime !== null ? ` · ${pct(c.uptime)}` : ""}`}
          className="w-1 rounded-[2px]"
          style={{ background: c.status ? HEALTH[c.status].color : "var(--border)", opacity: c.status ? 1 : 0.7 }}
        />
      ))}
    </div>
  );
}

export function HistoryLegend() {
  const items: (HealthStatus | null)[] = ["HEALTHY", "DEGRADED", "UNAVAILABLE", null];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      {items.map((s) => {
        const Icon = s ? HEALTH[s].icon : null;
        return (
          <span key={s ?? "none"} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: s ? HEALTH[s].color : "var(--border)" }} aria-hidden />
            {Icon && <Icon className="size-3" aria-hidden />}
            {s ? HEALTH[s].label : "Sin datos"}
          </span>
        );
      })}
    </div>
  );
}

// --- charts ---------------------------------------------------------------------------

const shortTime = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });
const shortDay = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
const full = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

const axis = { tick: { fill: "var(--muted)", fontSize: 11 }, tickLine: false } as const;

function TipBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-fg">{title}</p>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

export interface SeriesDef {
  key: keyof MetricPoint;
  label: string;
  color: string;
}

/** One unit per chart (never two y-scales). Optional threshold line. */
export function MetricChart({
  data,
  series,
  unit,
  hours,
  threshold,
  domain,
  height = 200,
}: {
  data: MetricPoint[];
  series: SeriesDef[];
  unit: string;
  hours: number;
  threshold?: { value: number; label: string };
  domain?: [number, number];
  height?: number;
}) {
  const rows = data.map((d) => ({ ...d, ts: new Date(d.t).getTime() }));
  const tickFmt = (t: number) => (hours > 48 ? shortDay : shortTime).format(new Date(t));
  return (
    <div style={{ height }} role="img" aria-label={`${series.map((s) => s.label).join(" y ")} (${unit.trim()}), ${data.length} puntos`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tickFmt} minTickGap={36} axisLine={{ stroke: "var(--border)" }} {...axis} />
          <YAxis {...axis} axisLine={false} width={unit.trim().length > 1 ? 72 : 56} unit={unit} domain={domain ?? [0, "auto"]} allowDecimals={false} />
          {threshold && (
            <ReferenceLine
              y={threshold.value}
              stroke="var(--chart-failed)"
              strokeDasharray="4 4"
              label={{ value: threshold.label, position: "insideTopRight", fill: "var(--muted)", fontSize: 11 }}
            />
          )}
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={(p) => {
              const point = p.payload?.[0]?.payload as (MetricPoint & { ts: number }) | undefined;
              if (!p.active || !point) return null;
              return (
                <TipBox title={full.format(new Date(point.ts))}>
                  {series.map((s) => (
                    <p key={s.key} className="flex items-center gap-1.5 text-muted">
                      <span className="size-2 rounded-full" style={{ background: s.color }} />
                      {s.label}: <span className="tabular-nums text-fg">{num(point[s.key] as number | null, unit, 1)}</span>
                    </p>
                  ))}
                </TipBox>
              );
            }}
          />
          {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />}
          {series.map((s) => (
            <Line key={s.key} name={s.label} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatusDot(props: { cx?: number; cy?: number; payload?: ResponsePoint }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload || payload.status === "HEALTHY") return null;
  return <circle cx={cx} cy={cy} r={4.5} fill={HEALTH[payload.status].color} stroke="var(--surface)" strokeWidth={2} />;
}

export function ResponseSeriesChart({ data, hours, threshold }: { data: ResponsePoint[]; hours: number; threshold?: number }) {
  const rows = data.map((d) => ({ ...d, ts: new Date(d.t).getTime(), ms: d.avg_ms ?? 0 }));
  const tickFmt = (t: number) => (hours > 48 ? shortDay : shortTime).format(new Date(t));
  return (
    <div className="h-52" role="img" aria-label={`Tiempo de respuesta promedio, ${data.length} intervalos`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tickFmt} minTickGap={36} axisLine={{ stroke: "var(--border)" }} {...axis} />
          <YAxis {...axis} axisLine={false} width={72} unit=" ms" />
          {threshold && <ReferenceLine y={threshold} stroke="var(--chart-cancelled)" strokeDasharray="4 4" label={{ value: "Lento", position: "insideTopRight", fill: "var(--muted)", fontSize: 11 }} />}
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={(p) => {
              const point = p.payload?.[0]?.payload as (ResponsePoint & { ts: number }) | undefined;
              if (!p.active || !point) return null;
              const meta = HEALTH[point.status];
              const Icon = meta.icon;
              return (
                <TipBox title={full.format(new Date(point.ts))}>
                  <p className="flex items-center gap-1.5 text-muted">
                    <Icon className="size-3.5" style={{ color: meta.color }} /> {meta.label} · {point.checks} verificación(es)
                  </p>
                  <p className="text-fg tabular-nums">Promedio {num(point.avg_ms, " ms")} · máx. {num(point.max_ms, " ms")}</p>
                </TipBox>
              );
            }}
          />
          <Line type="monotone" dataKey="ms" stroke="var(--chart-running)" strokeWidth={2} dot={<StatusDot />} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const SLO = 0.995;

/** Daily availability, last 30 days. Bars below the 99.5 % target are marked in the failure color. */
export function DailyUptimeChart({ data }: { data: DailyUptime[] }) {
  const rows = data.map((d) => ({ ...d, value: d.uptime === null ? null : +(d.uptime * 100).toFixed(2) }));
  const values = rows.flatMap((r) => (r.value === null ? [] : [r.value]));
  const floor = values.length ? Math.max(0, Math.floor(Math.min(...values) / 5) * 5 - 5) : 0;
  return (
    <div>
      <div className="h-48" role="img" aria-label="Disponibilidad diaria de los últimos 30 días">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" tickFormatter={(d: string) => shortDay.format(new Date(`${d}T12:00:00`))} minTickGap={24} axisLine={{ stroke: "var(--border)" }} {...axis} />
            <YAxis {...axis} axisLine={false} width={52} unit=" %" domain={[Math.min(floor, 95), 100]} allowDecimals={false} />
            <ReferenceLine y={SLO * 100} stroke="var(--muted)" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(p) => {
                const point = p.payload?.[0]?.payload as (DailyUptime & { value: number | null }) | undefined;
                if (!p.active || !point) return null;
                return (
                  <TipBox title={shortDay.format(new Date(`${point.day}T12:00:00`))}>
                    <p className="text-fg tabular-nums">{point.value === null ? "Sin datos" : `${point.value} % disponible`}</p>
                    <p className="text-muted">{point.checks} verificaciones · {point.failures} caídas</p>
                    {point.avg_ms !== null && <p className="text-muted">Respuesta promedio {point.avg_ms} ms</p>}
                  </TipBox>
                );
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.day} fill={r.value !== null && r.value < SLO * 100 ? "var(--chart-failed)" : "var(--chart-success)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: "var(--chart-success)" }} /> Cumple el objetivo (≥ 99.5 %)</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: "var(--chart-failed)" }} /> Por debajo del objetivo</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-[var(--muted)]" /> Objetivo 99.5 %</span>
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-2.5 py-1 text-muted hover:text-fg", value === o.value && "bg-surface text-fg shadow-xs")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

