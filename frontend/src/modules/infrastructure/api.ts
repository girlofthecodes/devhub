import { http } from "@/services/http";
import type { ListParams, Paginated } from "@/types/api";

export type ServerType = "APPLICATION" | "DATABASE" | "MIXED" | "OTHER";
export type InfraStatus = "ACTIVE" | "MAINTENANCE" | "INACTIVE";
export type EnvironmentKind = "DEVELOPMENT" | "DEMO" | "PRODUCTION";

export interface Server {
  id: string;
  name: string;
  identifier: string;
  location: string;
  server_type: ServerType;
  server_type_label: string;
  operating_system: string;
  vpn_address: string | null;
  status: InfraStatus;
  status_label: string;
  notes: string;
  last_checked_at: string | null;
  environment_count: number;
  active_environment_count: number;
  created_at: string;
  updated_at: string;
}

export interface ServerPayload {
  name: string;
  identifier: string;
  location: string;
  server_type: ServerType;
  operating_system: string;
  vpn_address: string | null;
  status: InfraStatus;
  notes: string;
}

export interface Environment {
  id: string;
  project: string;
  project_name: string;
  project_slug: string;
  kind: EnvironmentKind;
  kind_label: string;
  name: string;
  display_name: string;
  server: string | null;
  server_detail: { id: string; name: string; identifier: string; status: InfraStatus } | null;
  public_url: string;
  deployed_version: string;
  status: InfraStatus;
  status_label: string;
  can_edit: boolean;
  created_at: string;
  updated_at: string;
}

export interface EnvironmentPayload {
  project: string;
  kind: EnvironmentKind;
  name: string;
  server: string | null;
  public_url: string;
  deployed_version: string;
  status: InfraStatus;
}

export interface ServerListParams extends ListParams {
  status?: InfraStatus;
  server_type?: ServerType;
}

export interface EnvironmentListParams extends ListParams {
  project?: string;
  server?: string;
  kind?: EnvironmentKind;
  status?: InfraStatus;
}

export interface InfrastructureSummary {
  servers: { total: number; by_status: Record<InfraStatus, number>; by_type: Record<ServerType, number> };
  environments: {
    total: number;
    by_status: Record<InfraStatus, number>;
    by_kind: Record<EnvironmentKind, number>;
    without_server: number;
  };
}

export const infrastructureApi = {
  async summary(): Promise<InfrastructureSummary> {
    return (await http.get<InfrastructureSummary>("/infrastructure/summary/")).data;
  },
  async listServers(params: ServerListParams): Promise<Paginated<Server>> {
    return (await http.get<Paginated<Server>>("/servers/", { params })).data;
  },
  async getServer(id: string): Promise<Server> {
    return (await http.get<Server>(`/servers/${id}/`)).data;
  },
  async createServer(payload: ServerPayload): Promise<Server> {
    return (await http.post<Server>("/servers/", payload)).data;
  },
  async updateServer(id: string, payload: Partial<ServerPayload>): Promise<Server> {
    return (await http.patch<Server>(`/servers/${id}/`, payload)).data;
  },
  async listEnvironments(params: EnvironmentListParams): Promise<Paginated<Environment>> {
    return (await http.get<Paginated<Environment>>("/environments/", { params })).data;
  },
  async createEnvironment(payload: EnvironmentPayload): Promise<Environment> {
    return (await http.post<Environment>("/environments/", payload)).data;
  },
  async updateEnvironment(
    id: string,
    payload: Partial<Omit<EnvironmentPayload, "project" | "kind">>,
  ): Promise<Environment> {
    return (await http.patch<Environment>(`/environments/${id}/`, payload)).data;
  },
};
