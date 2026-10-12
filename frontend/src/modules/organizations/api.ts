import { http } from "@/services/http";
import type { ListParams, Paginated, Role } from "@/types/api";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string;
  contact_email: string;
  is_active: boolean;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export type MembershipRole = "OWNER" | "MEMBER";

export interface Membership {
  id: string;
  organization: string;
  organization_name: string;
  user: string;
  user_detail: { id: string; email: string; full_name: string; role: Role | null; is_active: boolean };
  role: MembershipRole;
  created_at: string;
}

export interface OrganizationListParams extends ListParams {
  is_active?: boolean;
}

export interface OrganizationPayload {
  name: string;
  slug?: string;
  description: string;
  contact_email: string;
}

export const MEMBERSHIP_ROLE_LABEL: Record<MembershipRole, string> = {
  OWNER: "Responsable",
  MEMBER: "Miembro",
};

export const organizationsApi = {
  async list(params: OrganizationListParams): Promise<Paginated<Organization>> {
    const { data } = await http.get<Paginated<Organization>>("/organizations/", { params });
    return data;
  },
  async get(id: string): Promise<Organization> {
    const { data } = await http.get<Organization>(`/organizations/${id}/`);
    return data;
  },
  async create(payload: OrganizationPayload): Promise<Organization> {
    const { data } = await http.post<Organization>("/organizations/", payload);
    return data;
  },
  async update(id: string, payload: Partial<OrganizationPayload>): Promise<Organization> {
    const { data } = await http.patch<Organization>(`/organizations/${id}/`, payload);
    return data;
  },
  async setActive(id: string, active: boolean): Promise<Organization> {
    const { data } = await http.post<Organization>(
      `/organizations/${id}/${active ? "activate" : "deactivate"}/`,
    );
    return data;
  },
  async listMembers(organization: string, page = 1): Promise<Paginated<Membership>> {
    const { data } = await http.get<Paginated<Membership>>("/memberships/", {
      params: { organization, page, page_size: 50 },
    });
    return data;
  },
  async addMember(payload: { organization: string; user: string; role: MembershipRole }) {
    const { data } = await http.post<Membership>("/memberships/", payload);
    return data;
  },
  async updateMember(id: string, role: MembershipRole) {
    const { data } = await http.patch<Membership>(`/memberships/${id}/`, { role });
    return data;
  },
  async removeMember(id: string): Promise<void> {
    await http.delete(`/memberships/${id}/`);
  },
};
