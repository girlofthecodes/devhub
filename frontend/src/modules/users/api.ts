import type { BadgeTone } from "@/components/ui/Badge";
import { http } from "@/services/http";
import type { FinanceAccess } from "@/modules/auth/types";
import type { ListParams, Paginated, Role } from "@/types/api";

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: Role | null;
  role_label: string;
  /** Additional client-portal access of an internal user (CLIENT group next to the role). */
  client_portal_access: boolean;
  finance_access: FinanceAccess;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
}

export interface UserListParams extends ListParams {
  role?: Role;
  /** Comma-separated roles, e.g. "ADMIN,DEVELOPER". */
  roles?: string;
  is_active?: boolean;
  organization?: string;
}

export interface UserCreatePayload {
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  client_portal_access?: boolean;
  finance_access?: FinanceAccess;
  password?: string;
}

export type UserUpdatePayload = Partial<
  Pick<UserCreatePayload, "first_name" | "last_name" | "role" | "client_portal_access" | "finance_access">
>;

export const FINANCE_ACCESS_OPTIONS: { value: FinanceAccess; label: string }[] = [
  { value: "NONE", label: "Sin acceso" },
  { value: "VIEW", label: "Consulta (solo lectura)" },
  { value: "MANAGE", label: "Gestión (registrar y modificar)" },
];

/** Keeps only the access settings that apply to the selected role. */
export function normalizeAccess<T extends { role: Role; client_portal_access: boolean; finance_access: FinanceAccess }>(
  values: T,
): T {
  const staff = values.role === "ADMIN" || values.role === "DEVELOPER";
  return {
    ...values,
    client_portal_access: staff ? values.client_portal_access : false,
    finance_access: values.role === "DEVELOPER" ? values.finance_access : "NONE",
  };
}

export const ROLE_OPTIONS: { value: Role; label: string; description: string }[] = [
  { value: "ADMIN", label: "Administrador", description: "Control completo de DevHub." },
  { value: "DEVELOPER", label: "Desarrollador", description: "Gestiona proyectos asignados." },
  { value: "CLIENT", label: "Cliente", description: "Accede al portal de su organización." },
  { value: "VISITOR", label: "Visitante", description: "Solo portafolio público." },
];

export const roleTone: Record<Role, BadgeTone> = {
  ADMIN: "accent",
  DEVELOPER: "info",
  CLIENT: "success",
  VISITOR: "neutral",
};

export const usersApi = {
  async list(params: UserListParams): Promise<Paginated<User>> {
    const { data } = await http.get<Paginated<User>>("/users/", { params });
    return data;
  },
  async create(payload: UserCreatePayload): Promise<User> {
    const { data } = await http.post<User>("/users/", payload);
    return data;
  },
  async update(id: string, payload: UserUpdatePayload): Promise<User> {
    const { data } = await http.patch<User>(`/users/${id}/`, payload);
    return data;
  },
  async activate(id: string): Promise<User> {
    const { data } = await http.post<User>(`/users/${id}/activate/`);
    return data;
  },
  async deactivate(id: string): Promise<User> {
    const { data } = await http.post<User>(`/users/${id}/deactivate/`);
    return data;
  },
  async revokeSessions(id: string): Promise<{ detail: string }> {
    const { data } = await http.post<{ detail: string }>(`/users/${id}/revoke-sessions/`);
    return data;
  },
};
