import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { metricsApi, type AlertListParams } from "./metricsApi";

/** Live views poll every 10 s while visible; pausing stops polling (TanStack also pauses in background tabs). */
export const LIVE_MS = 10_000;

export function useMetricsOverview(live = true) {
  return useQuery({
    queryKey: ["monitoring", "metrics", "overview"],
    queryFn: metricsApi.overview,
    refetchInterval: live ? LIVE_MS : false,
    placeholderData: keepPreviousData,
  });
}

export function useProjectMetrics(id: string, params: { hours: number; environment?: string }, live = true) {
  return useQuery({
    queryKey: ["monitoring", "metrics", "project", id, params],
    queryFn: () => metricsApi.project(id, params),
    refetchInterval: live ? LIVE_MS : false,
    placeholderData: keepPreviousData,
  });
}

export function useAlerts(params: AlertListParams, live = true) {
  return useQuery({
    queryKey: ["monitoring", "alerts", params],
    queryFn: () => metricsApi.alerts(params),
    refetchInterval: live ? LIVE_MS : false,
    placeholderData: keepPreviousData,
  });
}

export function useAlertSummary(live = true) {
  return useQuery({ queryKey: ["monitoring", "alerts", "summary"], queryFn: metricsApi.alertSummary, refetchInterval: live ? LIVE_MS : false });
}

export function useAlertAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "acknowledge" | "resolve" }) =>
      action === "acknowledge" ? metricsApi.acknowledge(id) : metricsApi.resolve(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["monitoring"] }),
  });
}
