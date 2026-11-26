import type { BadgeTone } from "@/components/ui/Badge";

import type { AlertStatus, Severity } from "./metricsApi";

// Formatters and labels for the metrics views.

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(v === 1 ? 0 : digits)} %`;

export const num = (v: number | null | undefined, unit = "", digits = 0) =>
  v === null || v === undefined ? "—" : `${v.toLocaleString("es-MX", { maximumFractionDigits: digits })}${unit}`;

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

// Severity and alert-status labels (always shown with text, never color alone).

export const SEVERITY: Record<Severity, { label: string; tone: BadgeTone }> = {
  INFO: { label: "Información", tone: "info" },
  WARNING: { label: "Advertencia", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
  CRITICAL: { label: "Crítica", tone: "danger" },
};

export const ALERT_STATUS: Record<AlertStatus, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "Abierta", tone: "danger" },
  ACKNOWLEDGED: { label: "Reconocida", tone: "info" },
  RESOLVED: { label: "Resuelta", tone: "success" },
};
