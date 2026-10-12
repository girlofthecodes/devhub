import type { BadgeTone } from "@/components/ui/Badge";
import { http } from "@/services/http";
import type { ListParams, Paginated, Role } from "@/types/api";

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: Role | null;
  role_label: string;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
}

export interface UserListParams extends ListParams {
  role?: Role;
  is_active?: boolean;
  organization?: string;
}

export interface UserCreatePayload {
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  password?: string;
}

export type UserUpdatePayload = Partial<Pick<UserCreatePayload, "first_name" | "last_name" | "role">>;

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
