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
  organizations: OrganizationSummary[];
}

export type Area = "admin" | "portal";

export const STAFF_ROLES: readonly Role[] = ["ADMIN", "DEVELOPER"];
export const PORTAL_ROLES: readonly Role[] = ["CLIENT", "VISITOR"];

export function homePathFor(role: Role | null | undefined): string {
  if (role && STAFF_ROLES.includes(role)) return "/admin";
  if (role && PORTAL_ROLES.includes(role)) return "/portal";
  return "/login";
}
