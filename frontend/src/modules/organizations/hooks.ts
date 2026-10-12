import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  organizationsApi,
  type MembershipRole,
  type OrganizationListParams,
  type OrganizationPayload,
} from "./api";

export const orgKeys = {
  all: ["organizations"] as const,
  list: (params: OrganizationListParams) => ["organizations", "list", params] as const,
  detail: (id: string) => ["organizations", "detail", id] as const,
  members: (id: string) => ["organizations", "members", id] as const,
};

export function useOrganizations(params: OrganizationListParams) {
  return useQuery({
    queryKey: orgKeys.list(params),
    queryFn: () => organizationsApi.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useOrganization(id: string) {
  return useQuery({ queryKey: orgKeys.detail(id), queryFn: () => organizationsApi.get(id) });
}

export function useMembers(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: orgKeys.members(organizationId),
    queryFn: () => organizationsApi.listMembers(organizationId),
    enabled,
  });
}

function useInvalidateOrgs() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: orgKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["users"] });
    void queryClient.invalidateQueries({ queryKey: ["audit"] });
  };
}

export function useCreateOrganization() {
  const invalidate = useInvalidateOrgs();
  return useMutation({
    mutationFn: (payload: OrganizationPayload) => organizationsApi.create(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateOrganization() {
  const invalidate = useInvalidateOrgs();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<OrganizationPayload> }) =>
      organizationsApi.update(id, payload),
    onSuccess: invalidate,
  });
}

export function useSetOrganizationActive() {
  const invalidate = useInvalidateOrgs();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      organizationsApi.setActive(id, active),
    onSuccess: invalidate,
  });
}

export function useAddMember() {
  const invalidate = useInvalidateOrgs();
  return useMutation({ mutationFn: organizationsApi.addMember, onSuccess: invalidate });
}

export function useUpdateMember() {
  const invalidate = useInvalidateOrgs();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: MembershipRole }) =>
      organizationsApi.updateMember(id, role),
    onSuccess: invalidate,
  });
}

export function useRemoveMember() {
  const invalidate = useInvalidateOrgs();
  return useMutation({ mutationFn: organizationsApi.removeMember, onSuccess: invalidate });
}
