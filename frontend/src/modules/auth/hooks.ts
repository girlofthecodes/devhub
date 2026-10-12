import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authApi } from "./api";
import type { CurrentUser } from "./types";

export const meQueryKey = ["auth", "me"] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: authApi.me,
    staleTime: 60_000,
    retry: false,
  });
}

/** Current user when it is known to be authenticated (inside protected routes). */
export function useAuthenticatedUser(): CurrentUser {
  const { data } = useCurrentUser();
  if (!data) throw new Error("useAuthenticatedUser used outside a protected route");
  return data;
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => {
      queryClient.clear();
      queryClient.setQueryData(meQueryKey, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(meQueryKey, null);
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.updateProfile,
    onSuccess: (user) => queryClient.setQueryData(meQueryKey, user),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: authApi.changePassword });
}
