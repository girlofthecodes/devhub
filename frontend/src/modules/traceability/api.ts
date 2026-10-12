import { http } from "@/services/http";
import type { ListParams, Paginated } from "@/types/api";

export type EventType =
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "DEPLOYMENT_STARTED"
  | "DEPLOYMENT_SUCCESS"
  | "DEPLOYMENT_FAILED"
  | "DEPLOYMENT_CANCELLED"
  | "SERVICE_UNAVAILABLE"
  | "SERVICE_RECOVERED"
  | "ACCESS_GRANTED"
  | "ACCESS_REVOKED"
  | "CONFIGURATION_CHANGED";
export type Severity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type EventSource = "SYSTEM" | "USER" | "GITHUB_ACTIONS" | "API" | "MONITORING";

export interface TraceEvent {
  id: string;
  occurred_at: string;
  event_type: EventType;
  event_type_label: string;
  severity: Severity;
  severity_label: string;
  source: EventSource;
  source_label: string;
  description: string;
  project: string | null;
  project_name: string | null;
  environment: string | null;
  environment_kind: string | null;
  deployment: string | null;
  deployment_version: string | null;
  correlation_id: string;
  actor_label: string;
  metadata: Record<string, unknown>;
}

export interface EventListParams extends ListParams {
  project?: string;
  environment?: string;
  deployment?: string;
  /** Comma-separated list. */
  event_type?: string;
  /** Comma-separated list. */
  severity?: string;
  source?: EventSource;
  correlation_id?: string;
  occurred_from?: string;
  occurred_to?: string;
}

export const eventsApi = {
  async list(params: EventListParams): Promise<Paginated<TraceEvent>> {
    return (await http.get<Paginated<TraceEvent>>("/events/", { params })).data;
  },
};
