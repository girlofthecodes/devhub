import { http } from "@/services/http";
import type { Paginated } from "@/types/api";

import type { EnvironmentKind } from "@/modules/infrastructure/api";

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";

export interface HealthCheck {
  id: string;
  environment: string;
  project: string;
  project_name: string;
  environment_kind: EnvironmentKind;
  environment_label: string;
  server_name: string | null;
  target_url: string;
  path: string;
  expected_status_min: number;
  expected_status_max: number;
  interval_seconds: number;
  timeout_seconds: number;
  degraded_threshold_ms: number;
  failure_threshold: number;
  enabled: boolean;
  status: HealthStatus;
  effective_status: HealthStatus;
  effective_status_label: string;
  is_stale: boolean;
  last_checked_at: string | null;
  last_response_ms: number | null;
  last_status_code: number | null;
  last_error: string;
  consecutive_failures: number;
  status_changed_at: string | null;
  uptime_24h: number | null;
  uptime_7d: number | null;
  can_edit: boolean;
  created_at: string;
}

export interface CheckResult {
  id: string;
  checked_at: string;
  status: HealthStatus;
  response_ms: number | null;
  status_code: number | null;
  error: string;
}

export interface MonitoringSummary {
  total: number;
  by_status: Record<HealthStatus, number>;
  stale: number;
  environments_without_check: number;
}

export interface HealthCheckPayload {
  environment?: string;
  path: string;
  interval_seconds: number;
  timeout_seconds: number;
  degraded_threshold_ms: number;
  failure_threshold: number;
  expected_status_min: number;
  expected_status_max: number;
  enabled: boolean;
}

export const monitoringApi = {
  async list(params: { project?: string; page?: number; page_size?: number; search?: string }) {
    return (await http.get<Paginated<HealthCheck>>("/health-checks/", { params })).data;
  },
  async get(id: string) {
    return (await http.get<HealthCheck>(`/health-checks/${id}/`)).data;
  },
  async results(id: string, hours: number) {
    return (await http.get<CheckResult[]>(`/health-checks/${id}/results/`, { params: { hours } })).data;
  },
  async summary() {
    return (await http.get<MonitoringSummary>("/monitoring/summary/")).data;
  },
  async create(payload: HealthCheckPayload) {
    return (await http.post<HealthCheck>("/health-checks/", payload)).data;
  },
  async update(id: string, payload: Partial<HealthCheckPayload>) {
    return (await http.patch<HealthCheck>(`/health-checks/${id}/`, payload)).data;
  },
  async run(id: string) {
    return (await http.post<HealthCheck>(`/health-checks/${id}/run/`)).data;
  },
};
