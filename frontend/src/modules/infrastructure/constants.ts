import type { BadgeTone } from "@/components/ui/Badge";

import type { EnvironmentKind, InfraStatus, ServerType } from "./api";

export const SERVER_TYPES: { value: ServerType; label: string }[] = [
  { value: "APPLICATION", label: "Aplicaciones" },
  { value: "DATABASE", label: "Datos" },
  { value: "MIXED", label: "Mixto" },
  { value: "OTHER", label: "Otro" },
];

export const INFRA_STATUS: Record<InfraStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Activo", tone: "success" },
  MAINTENANCE: { label: "Mantenimiento", tone: "warning" },
  INACTIVE: { label: "Inactivo", tone: "neutral" },
};
export const INFRA_STATUS_OPTIONS = (Object.keys(INFRA_STATUS) as InfraStatus[]).map((value) => ({
  value,
  label: INFRA_STATUS[value].label,
}));

export const ENVIRONMENT_KINDS: { value: EnvironmentKind; label: string; tone: BadgeTone }[] = [
  { value: "DEVELOPMENT", label: "Development", tone: "info" },
  { value: "DEMO", label: "Demo", tone: "accent" },
  { value: "PRODUCTION", label: "Production", tone: "success" },
];
export const kindTone = (kind: EnvironmentKind): BadgeTone =>
  ENVIRONMENT_KINDS.find((k) => k.value === kind)?.tone ?? "neutral";
export const kindLabel = (kind: EnvironmentKind): string =>
  ENVIRONMENT_KINDS.find((k) => k.value === kind)?.label ?? kind;
