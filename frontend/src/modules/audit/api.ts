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
  PROJECT_CREATED: "Proyecto creado",
  PROJECT_UPDATED: "Proyecto actualizado",
  PROJECT_ARCHIVED: "Proyecto archivado",
  PROJECT_RESTORED: "Proyecto restaurado",
  PROJECT_PUBLISHED: "Proyecto publicado en portafolio",
  PROJECT_UNPUBLISHED: "Proyecto oculto del portafolio",
  PROJECT_LOGO_UPDATED: "Logotipo actualizado",
  PROJECT_MEMBER_ADDED: "Desarrollador asignado",
  PROJECT_MEMBER_UPDATED: "Asignación actualizada",
  PROJECT_MEMBER_REMOVED: "Desarrollador removido",
  ACCESS_GRANTED: "Acceso concedido",
  ACCESS_UPDATED: "Acceso actualizado",
  ACCESS_REVOKED: "Acceso revocado",
  SERVER_CREATED: "Servidor registrado",
  SERVER_UPDATED: "Servidor actualizado",
  ENVIRONMENT_CREATED: "Entorno creado",
  ENVIRONMENT_UPDATED: "Entorno actualizado",
  DEPLOYMENT_CREATED: "Despliegue registrado",
  DEPLOYMENT_STATUS_CHANGED: "Estado de despliegue cambiado",
  SERVICE_TOKEN_CREATED: "Token de servicio creado",
  SERVICE_TOKEN_REVOKED: "Token de servicio revocado",
  RELEASE_CREATED: "Versión creada",
  RELEASE_UPDATED: "Versión actualizada",
  RELEASE_PUBLISHED: "Versión publicada",
  RELEASE_WITHDRAWN: "Versión retirada",
  DEMO_ACCESS_ISSUED: "Acceso a demo emitido",
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
  if (["FAILED", "DEACTIVATED", "REMOVED", "REVOKED", "ARCHIVED"].some((k) => action.includes(k))) return "danger";
  if (["CREATED", "ADDED", "ACTIVATED", "GRANTED", "RESTORED", "PUBLISHED"].some((k) => action.includes(k)) && !action.includes("UNPUBLISHED"))
    return "success";
  if (action.startsWith("LOGIN") || action === "LOGOUT") return "neutral";
  return "info";
}

