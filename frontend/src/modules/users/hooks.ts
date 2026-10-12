import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { usersApi, type UserCreatePayload, type UserListParams, type UserUpdatePayload } from "./api";

export const usersKeys = {
  all: ["users"] as const,
  list: (params: UserListParams) => ["users", "list", params] as const,
};

export function useUsers(params: UserListParams, enabled = true) {
  return useQuery({
    queryKey: usersKeys.list(params),
    queryFn: () => usersApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: usersKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["audit"] });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (payload: UserCreatePayload) => usersApi.create(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UserUpdatePayload }) =>
      usersApi.update(id, payload),
    onSuccess: invalidate,
  });
}

export function useSetUserActive() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      active ? usersApi.activate(id) : usersApi.deactivate(id),
    onSuccess: invalidate,
  });
}

export function useRevokeSessions() {
  const invalidate = useInvalidateUsers();
  return useMutation({ mutationFn: usersApi.revokeSessions, onSuccess: invalidate });
}
