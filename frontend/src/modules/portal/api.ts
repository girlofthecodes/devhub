import { http } from "@/services/http";
import type { Paginated } from "@/types/api";

export type AvailabilityStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";

export interface PortalApp {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo_url: string | null;
  status: string;
  status_label: string;
  technologies: string[];
  site_url: string;
  published_version: string | null;
  published_at: string | null;
  has_demo: boolean;
  availability: { status: AvailabilityStatus; label: string; checked_at: string | null };
}

export interface PortalAppDetail extends PortalApp {
  access: { organization: string; expires_at: string | null }[];
}

export interface PortalRelease {
  id: string;
  project: string;
  project_name: string;
  version: string;
  title: string;
  notes: string;
  published_at: string;
}

export interface PortalSummary {
  applications: number;
  demos: number;
  organizations: string[];
  recent_releases: PortalRelease[];
}

export interface PublicProject {
  name: string;
  slug: string;
  description: string;
  logo_url: string | null;
  technologies: string[];
  site_url: string;
}

export const portalApi = {
  async summary(): Promise<PortalSummary> {
    return (await http.get<PortalSummary>("/portal/summary/")).data;
  },
  async apps(params: { search?: string; has_demo?: boolean; page?: number; page_size?: number }) {
    return (await http.get<Paginated<PortalApp>>("/portal/projects/", { params })).data;
  },
  async app(id: string): Promise<PortalAppDetail> {
    return (await http.get<PortalAppDetail>(`/portal/projects/${id}/`)).data;
  },
  async releases(id: string): Promise<PortalRelease[]> {
    return (await http.get<PortalRelease[]>(`/portal/projects/${id}/releases/`)).data;
  },
  async demoAccess(id: string): Promise<{ launch_url: string; expires_at: string }> {
    return (await http.post<{ launch_url: string; expires_at: string }>(`/portal/projects/${id}/demo-access/`)).data;
  },
  async portfolio(): Promise<PublicProject[]> {
    return (await http.get<PublicProject[]>("/public/portfolio/")).data;
  },
};
