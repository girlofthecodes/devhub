import { useMemo, useState } from "react";

import { formatPercent, toIsoDay } from "@/utils/format";

import type { ContractKind, Currency, PeriodFilters, RecurringSummary } from "./api";

export type PeriodMode = "month" | "quarter" | "year" | "custom";

export interface PeriodState {
  mode: PeriodMode;
  month: string; // YYYY-MM
  year: number;
  quarter: 1 | 2 | 3 | 4;
  from: string;
  to: string;
  currency: Currency;
  project: string;
  kind: ContractKind | "";
}

function initialState(mode: PeriodMode): PeriodState {
  const now = new Date();
  const month = toIsoDay(now).slice(0, 7);
  return {
    mode,
    month,
    year: now.getFullYear(),
    quarter: (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4,
    from: `${now.getFullYear()}-01-01`,
    to: toIsoDay(now),
    currency: "MXN",
    project: "",
    kind: "",
  };
}

/** Real calendar boundaries of the selected period (never extrapolated). */
export function periodRange(s: PeriodState): { date_from: string; date_to: string } {
  const lastDay = (y: number, m: number) => toIsoDay(new Date(y, m, 0));
  if (s.mode === "month") {
    const [y, m] = s.month.split("-").map(Number);
    return { date_from: `${s.month}-01`, date_to: lastDay(y, m) };
  }
  if (s.mode === "quarter") {
    const first = (s.quarter - 1) * 3 + 1;
    return {
      date_from: `${s.year}-${String(first).padStart(2, "0")}-01`,
      date_to: lastDay(s.year, first + 2),
    };
  }
  if (s.mode === "year") return { date_from: `${s.year}-01-01`, date_to: `${s.year}-12-31` };
  return { date_from: s.from, date_to: s.to };
}

export function usePeriod(mode: PeriodMode = "year") {
  const [state, setState] = useState<PeriodState>(() => initialState(mode));
  const filters: PeriodFilters = useMemo(
    () => ({
      ...periodRange(state),
      currency: state.currency,
      project: state.project || undefined,
      kind: state.kind || undefined,
    }),
    [state],
  );
  return { state, setState, filters };
}

/** MRR growth for display: N/A (or "new recurring revenue") when last month had no MRR. */
export function growthLabel(r: Pick<RecurringSummary, "growth_pct" | "is_new_recurring_revenue"> | undefined) {
  if (!r) return "—";
  if (r.growth_pct !== null) return `${Number(r.growth_pct) > 0 ? "+" : ""}${formatPercent(r.growth_pct)}`;
  return r.is_new_recurring_revenue ? "Nuevo ingreso recurrente" : "N/A";
}
