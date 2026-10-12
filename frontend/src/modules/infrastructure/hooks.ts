import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  infrastructureApi,
  type EnvironmentListParams,
  type EnvironmentPayload,
  type ServerListParams,
  type ServerPayload,
} from "./api";

export const infraKeys = {
  all: ["infrastructure"] as const,
  summary: ["infrastructure", "summary"] as const,
  servers: (params: ServerListParams) => ["infrastructure", "servers", params] as const,
  server: (id: string) => ["infrastructure", "server", id] as const,
  environments: (params: EnvironmentListParams) => ["infrastructure", "environments", params] as const,
};

export function useInfrastructureSummary() {
  return useQuery({ queryKey: infraKeys.summary, queryFn: infrastructureApi.summary });
}

export function useServers(params: ServerListParams, enabled = true) {
  return useQuery({
    queryKey: infraKeys.servers(params),
    queryFn: () => infrastructureApi.listServers(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useServer(id: string) {
  return useQuery({ queryKey: infraKeys.server(id), queryFn: () => infrastructureApi.getServer(id) });
}

export function useEnvironments(params: EnvironmentListParams, enabled = true) {
  return useQuery({
    queryKey: infraKeys.environments(params),
    queryFn: () => infrastructureApi.listEnvironments(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: infraKeys.all });
    // Production URL may update the project site URL.
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
}

export function useSaveServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: ServerPayload }) =>
      id ? infrastructureApi.updateServer(id, payload) : infrastructureApi.createServer(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateServerStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ServerPayload["status"] }) =>
      infrastructureApi.updateServer(id, { status }),
    onSuccess: invalidate,
  });
}

export function useSaveEnvironment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: EnvironmentPayload }) => {
      if (!id) return infrastructureApi.createEnvironment(payload);
      // Project and kind are immutable once created.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { project, kind, ...rest } = payload;
      return infrastructureApi.updateEnvironment(id, rest);
    },
    onSuccess: invalidate,
  });
}
