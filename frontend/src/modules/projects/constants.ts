import type { BadgeTone } from "@/components/ui/Badge";

import type { AccessState, ProjectMemberRole, ProjectStatus } from "./api";

export const STATUS_OPTIONS: { value: ProjectStatus; label: string; tone: BadgeTone }[] = [
  { value: "PLANNING", label: "Planificación", tone: "neutral" },
  { value: "DEVELOPMENT", label: "Desarrollo", tone: "info" },
  { value: "TESTING", label: "Pruebas", tone: "warning" },
  { value: "AVAILABLE", label: "Disponible", tone: "success" },
  { value: "MAINTENANCE", label: "Mantenimiento", tone: "accent" },
  { value: "ARCHIVED", label: "Archivado", tone: "neutral" },
];

export const EDITABLE_STATUS_OPTIONS = STATUS_OPTIONS.filter((s) => s.value !== "ARCHIVED");

export const statusTone = (status: ProjectStatus): BadgeTone =>
  STATUS_OPTIONS.find((s) => s.value === status)?.tone ?? "neutral";

export const MEMBER_ROLE_LABEL: Record<ProjectMemberRole, string> = {
  MAINTAINER: "Mantenedor",
  CONTRIBUTOR: "Colaborador",
};

export const ACCESS_STATE: Record<AccessState, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Vigente", tone: "success" },
  EXPIRED: { label: "Expirado", tone: "warning" },
  REVOKED: { label: "Revocado", tone: "neutral" },
};

/** Converts a yyyy-mm-dd date input into an end-of-day ISO timestamp (local time). */
export function endOfDayIso(date: string): string | null {
  return date ? new Date(`${date}T23:59:59`).toISOString() : null;
}
