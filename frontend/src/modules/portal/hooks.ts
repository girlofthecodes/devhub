import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { portalApi } from "./api";

export function usePortalSummary() {
  return useQuery({ queryKey: ["portal", "summary"], queryFn: portalApi.summary });
}

export function usePortalApps(params: { search?: string; has_demo?: boolean; page?: number; page_size?: number }) {
  return useQuery({
    queryKey: ["portal", "apps", params],
    queryFn: () => portalApi.apps(params),
    placeholderData: keepPreviousData,
  });
}

export function usePortalApp(id: string) {
  return useQuery({ queryKey: ["portal", "app", id], queryFn: () => portalApi.app(id) });
}

export function usePortalReleases(id: string) {
  return useQuery({ queryKey: ["portal", "releases", id], queryFn: () => portalApi.releases(id) });
}

export function usePortfolio(enabled = true) {
  return useQuery({ queryKey: ["portal", "portfolio"], queryFn: portalApi.portfolio, enabled });
}
