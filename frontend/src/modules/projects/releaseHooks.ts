import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { releasesApi, type ReleasePayload } from "./releases";

export function useReleases(project: string) {
  return useQuery({
    queryKey: ["releases", project],
    queryFn: () => releasesApi.list(project),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["releases"] });
    void qc.invalidateQueries({ queryKey: ["events"] });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
}

export function useSaveRelease(project: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: ReleasePayload }) =>
      id ? releasesApi.update(id, payload) : releasesApi.create(project, payload),
    onSuccess: invalidate,
  });
}

export function useReleaseAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "publish" | "withdraw" }) =>
      action === "publish" ? releasesApi.publish(id) : releasesApi.withdraw(id),
    onSuccess: invalidate,
  });
}
