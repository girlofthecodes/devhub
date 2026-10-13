import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from "lucide-react";

import type { BadgeTone } from "@/components/ui/Badge";

import type { HealthStatus } from "./api";

// Colors reuse the validated status palette (see styles/index.css); always paired with icon + label.
export const HEALTH: Record<HealthStatus, { tone: BadgeTone; icon: typeof CircleCheck; color: string; label: string }> = {
  HEALTHY: { tone: "success", icon: CircleCheck, color: "var(--chart-success)", label: "Disponible" },
  DEGRADED: { tone: "warning", icon: TriangleAlert, color: "var(--chart-cancelled)", label: "Degradado" },
  UNAVAILABLE: { tone: "danger", icon: CircleX, color: "var(--chart-failed)", label: "No disponible" },
  UNKNOWN: { tone: "neutral", icon: CircleHelp, color: "var(--muted)", label: "Desconocido" },
};
