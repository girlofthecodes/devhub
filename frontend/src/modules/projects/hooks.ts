import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  projectsApi,
  type AccessListParams,
  type ProjectListParams,
  type ProjectMemberRole,
  type ProjectPayload,
  type ProjectVisibility,
} from "./api";

export const projectKeys = {
  all: ["projects"] as const,
  list: (params: ProjectListParams) => ["projects", "list", params] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
  members: (id: string) => ["projects", "members", id] as const,
  technologies: ["projects", "technologies"] as const,
};
export const accessKeys = {
  all: ["project-access"] as const,
  list: (params: AccessListParams) => ["project-access", params] as const,
};

export function useProjects(params: ProjectListParams, enabled = true) {
  return useQuery({
    queryKey: projectKeys.list(params),
    queryFn: () => projectsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useProject(id: string) {
  return useQuery({ queryKey: projectKeys.detail(id), queryFn: () => projectsApi.get(id) });
}

export function useTechnologies() {
  return useQuery({
    queryKey: projectKeys.technologies,
    queryFn: projectsApi.technologies,
    staleTime: 60_000,
  });
}

export function useProjectMembers(projectId: string) {
  return useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => projectsApi.listMembers(projectId),
  });
}

export function useProjectAccess(params: AccessListParams, enabled = true) {
  return useQuery({
    queryKey: accessKeys.list(params),
    queryFn: () => projectsApi.listAccess(params),
    enabled,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: projectKeys.all });
    void qc.invalidateQueries({ queryKey: accessKeys.all });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
}

export function useCreateProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: ProjectPayload) => projectsApi.create(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ProjectPayload> }) =>
      projectsApi.update(id, payload),
    onSuccess: invalidate,
  });
}

export function useArchiveProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      archive ? projectsApi.archive(id) : projectsApi.restore(id),
    onSuccess: invalidate,
  });
}

export function useSetVisibility() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: ProjectVisibility }) =>
      projectsApi.setVisibility(id, visibility),
    onSuccess: invalidate,
  });
}

export function useProjectLogo() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File | null }) =>
      file ? projectsApi.uploadLogo(id, file) : projectsApi.removeLogo(id),
    onSuccess: invalidate,
  });
}

export function useAddProjectMember() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: projectsApi.addMember, onSuccess: invalidate });
}

export function useUpdateProjectMember() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: ProjectMemberRole }) =>
      projectsApi.updateMember(id, role),
    onSuccess: invalidate,
  });
}

export function useRemoveProjectMember() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: projectsApi.removeMember, onSuccess: invalidate });
}

export function useGrantAccess() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: projectsApi.grantAccess, onSuccess: invalidate });
}

export function useRevokeAccess() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: projectsApi.revokeAccess, onSuccess: invalidate });
}
