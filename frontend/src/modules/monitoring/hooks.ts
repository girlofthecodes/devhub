import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monitoringApi, type HealthCheckPayload } from "./api";

// Monitoring data changes on its own (worker): refresh periodically.
const REFRESH_MS = 30_000;

export function useHealthChecks(params: { project?: string; page?: number; page_size?: number; search?: string }, enabled = true) {
  return useQuery({
    queryKey: ["monitoring", "checks", params],
    queryFn: () => monitoringApi.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
    enabled,
  });
}

export function useHealthCheck(id: string) {
  return useQuery({ queryKey: ["monitoring", "check", id], queryFn: () => monitoringApi.get(id), refetchInterval: REFRESH_MS });
}

export function useCheckResults(id: string, hours: number) {
  return useQuery({
    queryKey: ["monitoring", "results", id, hours],
    queryFn: () => monitoringApi.results(id, hours),
    refetchInterval: REFRESH_MS,
  });
}

export function useMonitoringSummary() {
  return useQuery({ queryKey: ["monitoring", "summary"], queryFn: monitoringApi.summary, refetchInterval: REFRESH_MS });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["monitoring"] });
    void qc.invalidateQueries({ queryKey: ["events"] });
  };
}

export function useSaveHealthCheck() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: HealthCheckPayload }) =>
      id ? monitoringApi.update(id, payload) : monitoringApi.create(payload),
    onSuccess: invalidate,
  });
}

export function useRunHealthCheck() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => monitoringApi.run(id), onSuccess: invalidate });
}
