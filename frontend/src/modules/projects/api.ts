import { http } from "@/services/http";
import type { ListParams, Paginated, Role } from "@/types/api";

export type ProjectStatus =
  | "PLANNING"
  | "DEVELOPMENT"
  | "TESTING"
  | "AVAILABLE"
  | "MAINTENANCE"
  | "ARCHIVED";
export type ProjectVisibility = "INTERNAL" | "PUBLIC";
export type ProjectMemberRole = "MAINTAINER" | "CONTRIBUTOR";
export type AccessState = "ACTIVE" | "EXPIRED" | "REVOKED";

export interface UserSummary {
  id: string;
  email: string;
  full_name: string;
  role: Role | null;
  is_active: boolean;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  client_description: string;
  logo_url: string | null;
  repository_url: string;
  documentation_url: string;
  site_url: string;
  technologies: string[];
  owner: UserSummary;
  status: ProjectStatus;
  status_label: string;
  visibility: ProjectVisibility;
  visibility_label: string;
  is_archived: boolean;
  archived_at: string | null;
  member_count: number;
  organization_count: number;
  permissions: { can_edit: boolean; can_manage: boolean };
  created_at: string;
  updated_at: string;
}

export interface ProjectListParams extends ListParams {
  status?: ProjectStatus;
  archived?: boolean;
  technology?: string;
  organization?: string;
  owner?: string;
}

export interface ProjectPayload {
  name: string;
  owner: string;
  status: Exclude<ProjectStatus, "ARCHIVED">;
  description: string;
  client_description: string;
  repository_url: string;
  documentation_url: string;
  site_url: string;
  technologies: string[];
}

export interface ProjectMember {
  id: string;
  project: string;
  project_name: string;
  user: string;
  user_detail: UserSummary;
  role: ProjectMemberRole;
  created_at: string;
}

export interface ProjectAccess {
  id: string;
  project: string;
  project_name: string;
  project_slug: string;
  organization: string;
  organization_name: string;
  state: AccessState;
  expires_at: string | null;
  notes: string;
  granted_by_email: string;
  created_at: string;
  revoked_at: string | null;
  revoked_by_email: string;
}

export interface AccessListParams extends ListParams {
  project?: string;
  organization?: string;
  state?: AccessState;
}

export interface GrantPayload {
  project: string;
  organization: string;
  expires_at: string | null;
  notes: string;
}

export const projectsApi = {
  async list(params: ProjectListParams): Promise<Paginated<Project>> {
    return (await http.get<Paginated<Project>>("/projects/", { params })).data;
  },
  async get(id: string): Promise<Project> {
    return (await http.get<Project>(`/projects/${id}/`)).data;
  },
  async create(payload: ProjectPayload): Promise<Project> {
    return (await http.post<Project>("/projects/", payload)).data;
  },
  async update(id: string, payload: Partial<ProjectPayload>): Promise<Project> {
    return (await http.patch<Project>(`/projects/${id}/`, payload)).data;
  },
  async archive(id: string): Promise<Project> {
    return (await http.post<Project>(`/projects/${id}/archive/`)).data;
  },
  async restore(id: string): Promise<Project> {
    return (await http.post<Project>(`/projects/${id}/restore/`)).data;
  },
  async setVisibility(id: string, visibility: ProjectVisibility): Promise<Project> {
    return (await http.post<Project>(`/projects/${id}/visibility/`, { visibility })).data;
  },
  async uploadLogo(id: string, file: File): Promise<Project> {
    const form = new FormData();
    form.append("logo", file);
    // Explicit multipart type: axios keeps the FormData and the browser adds the boundary.
    const { data } = await http.post<Project>(`/projects/${id}/logo/`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  async removeLogo(id: string): Promise<Project> {
    return (await http.delete<Project>(`/projects/${id}/logo/`)).data;
  },
  async technologies(): Promise<string[]> {
    return (await http.get<string[]>("/projects/technologies/")).data;
  },

  async listMembers(project: string): Promise<Paginated<ProjectMember>> {
    return (
      await http.get<Paginated<ProjectMember>>("/project-members/", {
        params: { project, page_size: 100 },
      })
    ).data;
  },
  async addMember(payload: { project: string; user: string; role: ProjectMemberRole }) {
    return (await http.post<ProjectMember>("/project-members/", payload)).data;
  },
  async updateMember(id: string, role: ProjectMemberRole) {
    return (await http.patch<ProjectMember>(`/project-members/${id}/`, { role })).data;
  },
  async removeMember(id: string): Promise<void> {
    await http.delete(`/project-members/${id}/`);
  },

  async listAccess(params: AccessListParams): Promise<Paginated<ProjectAccess>> {
    return (await http.get<Paginated<ProjectAccess>>("/project-access/", { params })).data;
  },
  async grantAccess(payload: GrantPayload): Promise<ProjectAccess> {
    return (await http.post<ProjectAccess>("/project-access/", payload)).data;
  },
  async revokeAccess(id: string): Promise<ProjectAccess> {
    return (await http.post<ProjectAccess>(`/project-access/${id}/revoke/`)).data;
  },
};
