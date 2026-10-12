import { http } from "@/services/http";
import type { ListParams, Paginated } from "@/types/api";

import type { EnvironmentKind } from "@/modules/infrastructure/api";

export type DeploymentStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
export type DeploymentSource = "MANUAL" | "GITHUB_ACTIONS" | "API";

export interface Deployment {
  id: string;
  project: string;
  project_name: string;
  project_slug: string;
  repository_url: string;
  environment: string;
  environment_kind: EnvironmentKind;
  environment_label: string;
  version: string;
  commit_sha: string;
  branch: string;
  source: DeploymentSource;
  source_label: string;
  triggered_by_label: string;
  status: DeploymentStatus;
  status_label: string;
  is_terminal: boolean;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  ci_run_id: string;
  ci_run_url: string;
  message: string;
  correlation_id: string;
  can_manage: boolean;
  created_at: string;
}

export interface DeploymentListParams extends ListParams {
  project?: string;
  environment?: string;
  kind?: EnvironmentKind;
  status?: DeploymentStatus;
  source?: DeploymentSource;
  created_from?: string;
  created_to?: string;
}

export interface DeploymentPayload {
  environment: string;
  version: string;
  commit_sha: string;
  branch: string;
  ci_run_url: string;
  message: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
}

export interface DeploymentStats {
  days: { date: string; SUCCESS: number; FAILED: number; CANCELLED: number; IN_PROGRESS: number }[];
  totals: { SUCCESS: number; FAILED: number; CANCELLED: number; IN_PROGRESS: number };
  success_rate: number | null;
}

export interface ServiceToken {
  id: string;
  name: string;
  key_prefix: string;
  projects: { id: string; name: string; slug: string }[];
  state: "ACTIVE" | "EXPIRED" | "REVOKED";
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_by_email: string;
  created_at: string;
}

export const deploymentsApi = {
  async list(params: DeploymentListParams): Promise<Paginated<Deployment>> {
    return (await http.get<Paginated<Deployment>>("/deployments/", { params })).data;
  },
  async get(id: string): Promise<Deployment> {
    return (await http.get<Deployment>(`/deployments/${id}/`)).data;
  },
  async create(payload: DeploymentPayload): Promise<Deployment> {
    return (await http.post<Deployment>("/deployments/", payload)).data;
  },
  async transition(id: string, status: Exclude<DeploymentStatus, "PENDING">, message: string) {
    return (await http.post<Deployment>(`/deployments/${id}/transition/`, { status, message })).data;
  },
  async stats(params: { days: number; project?: string }): Promise<DeploymentStats> {
    return (await http.get<DeploymentStats>("/deployments/stats/", { params })).data;
  },
  async listTokens(): Promise<Paginated<ServiceToken>> {
    return (await http.get<Paginated<ServiceToken>>("/service-tokens/", { params: { page_size: 100 } })).data;
  },
  async createToken(payload: { name: string; projects: string[]; expires_at: string | null }) {
    return (await http.post<ServiceToken & { token: string }>("/service-tokens/", payload)).data;
  },
  async revokeToken(id: string): Promise<ServiceToken> {
    return (await http.post<ServiceToken>(`/service-tokens/${id}/revoke/`)).data;
  },
};
