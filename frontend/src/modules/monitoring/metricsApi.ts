import { http } from "@/services/http";
import type { Paginated } from "@/types/api";

import type { EnvironmentKind } from "@/modules/infrastructure/api";

import type { HealthStatus } from "./api";

export type Severity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
export type AlertKind =
  | "SERVICE_DOWN"
  | "SLOW_RESPONSE"
  | "HIGH_CPU"
  | "HIGH_MEMORY"
  | "HIGH_ERROR_RATE"
  | "HIGH_LATENCY"
  | "METRICS_STALE";

export interface LatestMetrics {
  recorded_at: string;
  is_stale: boolean;
  cpu_percent: number | null;
  memory_percent: number | null;
  memory_used_mb: number | null;
  requests_per_minute: number | null;
  error_rate_percent: number | null;
  latency_p95_ms: number | null;
  active_connections: number | null;
  process_uptime_seconds: number | null;
}

export interface HourCell {
  hour: string;
  status: HealthStatus | null;
  uptime: number | null;
}

export interface EnvironmentMetrics {
  id: string;
  project: string;
  kind: EnvironmentKind;
  label: string;
  public_url: string;
  server_name: string | null;
  health_check: string | null;
  status: HealthStatus;
  status_label: string;
  is_stale: boolean;
  last_checked_at: string | null;
  last_response_ms: number | null;
  status_changed_at: string | null;
  uptime_24h: number | null;
  uptime_7d: number | null;
  uptime_30d: number | null;
  history_24h: HourCell[];
  metrics: LatestMetrics | null;
  open_alerts: number;
  alert_severity: Severity | null;
  last_update: string | null;
}

export interface ProjectMetrics {
  id: string;
  name: string;
  slug: string;
  project_status: string;
  status: HealthStatus;
  status_label: string;
  environments: EnvironmentMetrics[];
  primary_environment: string | null;
  uptime_24h: number | null;
  uptime_7d: number | null;
  last_response_ms: number | null;
  metrics: LatestMetrics | null;
  open_alerts: number;
  alert_severity: Severity | null;
  pages_up: number;
  pages_down: number;
  last_update: string | null;
}

export interface MetricsOverview {
  generated_at: string;
  totals: {
    projects: number;
    monitored_projects: number;
    pages: number;
    pages_up: number;
    pages_degraded: number;
    pages_down: number;
    pages_unknown: number;
    open_alerts: number;
    critical_alerts: number;
    avg_uptime_24h: number | null;
    reporting_metrics: number;
    last_update: string | null;
  };
  projects: ProjectMetrics[];
}

export interface MetricPoint {
  t: string;
  cpu_percent: number | null;
  memory_percent: number | null;
  memory_used_mb: number | null;
  requests_per_minute: number | null;
  error_rate_percent: number | null;
  latency_p95_ms: number | null;
  active_connections: number | null;
}

export interface ResponsePoint {
  t: string;
  avg_ms: number | null;
  max_ms: number | null;
  checks: number;
  status: HealthStatus;
}

export interface DailyUptime {
  day: string;
  uptime: number | null;
  checks: number;
  failures: number;
  avg_ms: number | null;
}

export interface WindowStatistics {
  checks: number;
  failures: number;
  degraded: number;
  uptime: number | null;
  avg_response_ms: number | null;
  p95_response_ms: number | null;
  max_response_ms: number | null;
  incidents: number;
  downtime_seconds: number;
  mttr_seconds: number | null;
  longest_outage_seconds: number | null;
  alerts: number;
  avg_cpu_percent: number | null;
  max_cpu_percent: number | null;
  avg_memory_percent: number | null;
  max_memory_percent: number | null;
  avg_requests_per_minute: number | null;
  total_requests: number | null;
  avg_error_rate_percent: number | null;
}

export interface ProjectMetricsDetail extends ProjectMetrics {
  generated_at: string;
  window_hours: number;
  bucket_seconds: number;
  selected_environment: string | null;
  statistics: WindowStatistics | null;
  metric_series: MetricPoint[];
  response_series: ResponsePoint[];
  daily_uptime: DailyUptime[];
}

export interface MonitoringAlert {
  id: string;
  environment: string;
  project: string;
  project_name: string;
  environment_kind: EnvironmentKind;
  environment_label: string;
  kind: AlertKind;
  kind_label: string;
  severity: Severity;
  status: AlertStatus;
  status_label: string;
  message: string;
  value: number | null;
  threshold: number | null;
  hits: number;
  opened_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  acknowledged_by_email: string | null;
  resolved_at: string | null;
  resolved_by_email: string | null;
  duration_seconds: number;
  can_edit: boolean;
}

export interface AlertSummary {
  open: number;
  acknowledged: number;
  critical: number;
  resolved_7d: number;
  opened_24h: number;
  mttr_seconds_7d: number | null;
}

export interface AlertListParams {
  status?: AlertStatus | "ACTIVE";
  project?: string;
  severity?: Severity;
  search?: string;
  page?: number;
  page_size?: number;
}

export const metricsApi = {
  async overview() {
    return (await http.get<MetricsOverview>("/monitoring/projects/")).data;
  },
  async project(id: string, params: { hours: number; environment?: string }) {
    return (await http.get<ProjectMetricsDetail>(`/monitoring/projects/${id}/`, { params })).data;
  },
  async alerts(params: AlertListParams) {
    return (await http.get<Paginated<MonitoringAlert>>("/alerts/", { params })).data;
  },
  async alertSummary() {
    return (await http.get<AlertSummary>("/alerts/summary/")).data;
  },
  async acknowledge(id: string) {
    return (await http.post<MonitoringAlert>(`/alerts/${id}/acknowledge/`)).data;
  },
  async resolve(id: string) {
    return (await http.post<MonitoringAlert>(`/alerts/${id}/resolve/`)).data;
  },
};
