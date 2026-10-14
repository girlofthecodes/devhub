import type { Role } from "@/types/api";

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  membership_role: "OWNER" | "MEMBER";
}

export interface CurrentUser {
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
  client_portal_access: boolean;
  finance_access: FinanceAccess;
  organizations: OrganizationSummary[];
  /** Portal the session was opened in; it decides the effective role on the server. */
  portal: Portal | null;
  available_portals: Portal[];
}

export type Portal = "admin" | "client";
export type FinanceAccess = "NONE" | "VIEW" | "MANAGE";

export type Area = "admin" | "portal";

export const STAFF_ROLES: readonly Role[] = ["ADMIN", "DEVELOPER"];
export const PORTAL_ROLES: readonly Role[] = ["CLIENT", "VISITOR"];

export const ADMIN_HOME = "/admin";
export const CLIENT_HOME = "/cliente";
export const ADMIN_LOGIN = "/admin/login";
export const CLIENT_LOGIN = "/cliente/login";

export function homePathFor(role: Role | null | undefined): string {
  if (role && STAFF_ROLES.includes(role)) return ADMIN_HOME;
  if (role && PORTAL_ROLES.includes(role)) return CLIENT_HOME;
  return "/";
}
