import { Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { cn } from "@/utils/cn";

import type { ContractKind, Currency } from "../api";
import { CURRENCY_OPTIONS, ESTIMATE_NOTE, KIND_LABEL } from "../constants";
import { useApplicationOptions, useFinanceAccess } from "../hooks";
import type { PeriodMode, PeriodState } from "../period";

const MODES: { value: PeriodMode; label: string }[] = [
  { value: "month", label: "Mes" },
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Año" },
  { value: "custom", label: "Rango" },
];

export function PeriodFilter({
  state,
  onChange,
  showProject = true,
  showKind = true,
}: {
  state: PeriodState;
  onChange: (s: PeriodState) => void;
  showProject?: boolean;
  showKind?: boolean;
}) {
  const apps = useApplicationOptions(showProject);
  const set = (patch: Partial<PeriodState>) => onChange({ ...state, ...patch });
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3" role="group" aria-label="Filtros del periodo">
      <div>
        <span className="mb-1 block text-xs font-medium text-muted">Periodo</span>
        <div role="radiogroup" aria-label="Tipo de periodo" className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5 text-sm">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={state.mode === m.value}
              onClick={() => set({ mode: m.value })}
              className={cn(
                "rounded-md px-3 py-1 text-muted hover:text-fg",
                state.mode === m.value && "bg-surface text-fg shadow-xs",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {state.mode === "month" && (
        <label className="flex flex-col text-xs font-medium text-muted">
          Mes
          <Input type="month" className="mt-1 w-40" value={state.month} onChange={(e) => e.target.value && set({ month: e.target.value })} />
        </label>
      )}
      {(state.mode === "quarter" || state.mode === "year") && (
        <label className="flex flex-col text-xs font-medium text-muted">
          Año
          <Select className="mt-1 w-28" value={state.year} onChange={(e) => set({ year: Number(e.target.value) })}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </label>
      )}
      {state.mode === "quarter" && (
        <label className="flex flex-col text-xs font-medium text-muted">
          Trimestre
          <Select className="mt-1 w-28" value={state.quarter} onChange={(e) => set({ quarter: Number(e.target.value) as 1 | 2 | 3 | 4 })}>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                T{q}
              </option>
            ))}
          </Select>
        </label>
      )}
      {state.mode === "custom" && (
        <>
          <label className="flex flex-col text-xs font-medium text-muted">
            Desde
            <Input type="date" className="mt-1 w-40" value={state.from} max={state.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
          </label>
          <label className="flex flex-col text-xs font-medium text-muted">
            Hasta
            <Input type="date" className="mt-1 w-40" value={state.to} min={state.from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </label>
        </>
      )}
      {showProject && (
        <label className="flex flex-col text-xs font-medium text-muted">
          Aplicación
          <Select className="mt-1 w-52" value={state.project} onChange={(e) => set({ project: e.target.value })}>
            <option value="">Todo el portafolio</option>
            {apps.data?.results.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {showKind && (
        <label className="flex flex-col text-xs font-medium text-muted">
          Modelo comercial
          <Select className="mt-1 w-44" value={state.kind} onChange={(e) => set({ kind: e.target.value as ContractKind | "" })}>
            <option value="">Venta y renta</option>
            {(Object.keys(KIND_LABEL) as ContractKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
      )}
      <label className="flex flex-col text-xs font-medium text-muted">
        Moneda
        <Select className="mt-1 w-28" value={state.currency} onChange={(e) => set({ currency: e.target.value as Currency })}>
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "neutral" | "danger" | "success";
  loading?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-muted" aria-hidden />}
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-surface-2" />
      ) : (
        <p
          className={cn(
            "mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-fg",
            tone === "danger" && "text-red-600 dark:text-red-400",
            tone === "success" && "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {value}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function EstimateNote({ otherCurrencies = [] }: { otherCurrencies?: string[] }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {ESTIMATE_NOTE}
        {otherCurrencies.length > 0 &&
          ` También hay movimientos en ${otherCurrencies.join(", ")}: no se suman; cambia la moneda para verlos.`}
      </span>
    </p>
  );
}

/** Frontend gate (UX only). Every finance endpoint is protected on the server. */
export function FinanceGate({ children }: { children: ReactNode }) {
  const { canView } = useFinanceAccess();
  if (!canView) {
    return (
      <Card>
        <ErrorState
          title="Acceso restringido"
          message="El módulo de negocio y rentabilidad requiere permisos financieros explícitos."
        />
      </Card>
    );
  }
  return <>{children}</>;
}
