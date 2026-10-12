import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deploymentsApi, type DeploymentListParams, type DeploymentPayload, type DeploymentStatus } from "./api";

export const deploymentKeys = {
  all: ["deployments"] as const,
  list: (params: DeploymentListParams) => ["deployments", "list", params] as const,
  detail: (id: string) => ["deployments", "detail", id] as const,
  stats: (days: number, project?: string) => ["deployments", "stats", days, project] as const,
  tokens: ["service-tokens"] as const,
};

export function useDeployments(params: DeploymentListParams, enabled = true) {
  return useQuery({
    queryKey: deploymentKeys.list(params),
    queryFn: () => deploymentsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDeployment(id: string) {
  return useQuery({
    queryKey: deploymentKeys.detail(id),
    queryFn: () => deploymentsApi.get(id),
    // Running deployments change state from CI: poll while not terminal.
    refetchInterval: (query) => (query.state.data && !query.state.data.is_terminal ? 10_000 : false),
  });
}

export function useDeploymentStats(days: number, project?: string) {
  return useQuery({
    queryKey: deploymentKeys.stats(days, project),
    queryFn: () => deploymentsApi.stats({ days, project }),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: deploymentKeys.all });
    void qc.invalidateQueries({ queryKey: ["events"] });
    // Successful deployments update the environment version.
    void qc.invalidateQueries({ queryKey: ["infrastructure"] });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
}

export function useCreateDeployment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: DeploymentPayload) => deploymentsApi.create(payload),
    onSuccess: invalidate,
  });
}

export function useTransitionDeployment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, status, message }: { id: string; status: Exclude<DeploymentStatus, "PENDING">; message: string }) =>
      deploymentsApi.transition(id, status, message),
    onSuccess: invalidate,
  });
}

export function useServiceTokens() {
  return useQuery({ queryKey: deploymentKeys.tokens, queryFn: deploymentsApi.listTokens });
}

export function useCreateServiceToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deploymentsApi.createToken,
    onSuccess: () => void qc.invalidateQueries({ queryKey: deploymentKeys.tokens }),
  });
}

export function useRevokeServiceToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deploymentsApi.revokeToken,
    onSuccess: () => void qc.invalidateQueries({ queryKey: deploymentKeys.tokens }),
  });
}
