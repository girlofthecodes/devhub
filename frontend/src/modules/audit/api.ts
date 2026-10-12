import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { BadgeTone } from "@/components/ui/Badge";
import { http } from "@/services/http";
import type { ListParams, Paginated } from "@/types/api";

export interface AuditLog {
  id: string;
  created_at: string;
  actor: string | null;
  actor_email: string;
  action: string;
  action_label: string;
  target_type: string;
  target_id: string;
  target_repr: string;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  request_id: string;
}

export interface AuditListParams extends ListParams {
  action?: string;
  created_from?: string;
  created_to?: string;
}

export const AUDIT_ACTIONS: Record<string, string> = {
  LOGIN_SUCCEEDED: "Inicio de sesión",
  LOGIN_FAILED: "Inicio de sesión fallido",
  LOGOUT: "Cierre de sesión",
  PASSWORD_CHANGED: "Contraseña cambiada",
  PASSWORD_RESET_REQUESTED: "Recuperación solicitada",
  PASSWORD_RESET_COMPLETED: "Contraseña restablecida",
  USER_CREATED: "Usuario creado",
  USER_UPDATED: "Usuario actualizado",
  USER_ROLE_CHANGED: "Rol cambiado",
  USER_ACTIVATED: "Usuario activado",
  USER_DEACTIVATED: "Usuario desactivado",
  USER_SESSIONS_REVOKED: "Sesiones revocadas",
  ORGANIZATION_CREATED: "Organización creada",
  ORGANIZATION_UPDATED: "Organización actualizada",
  ORGANIZATION_ACTIVATED: "Organización activada",
  ORGANIZATION_DEACTIVATED: "Organización desactivada",
  MEMBERSHIP_ADDED: "Miembro agregado",
  MEMBERSHIP_UPDATED: "Membresía actualizada",
  MEMBERSHIP_REMOVED: "Miembro removido",
};

export const auditApi = {
  async list(params: AuditListParams): Promise<Paginated<AuditLog>> {
    const { data } = await http.get<Paginated<AuditLog>>("/audit-logs/", { params });
    return data;
  },
};

export function useAuditLogs(params: AuditListParams, enabled = true) {
  return useQuery({
    queryKey: ["audit", params],
    queryFn: () => auditApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function actionTone(action: string): BadgeTone {
  if (action.includes("FAILED") || action.includes("DEACTIVATED") || action.includes("REMOVED")) return "danger";
  if (action.includes("CREATED") || action.includes("ADDED") || action.includes("ACTIVATED")) return "success";
  if (action.startsWith("LOGIN") || action === "LOGOUT") return "neutral";
  return "info";
}

