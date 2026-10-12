import type { BadgeTone } from "@/components/ui/Badge";
import { http } from "@/services/http";
import type { Paginated } from "@/types/api";

export type ReleaseStatus = "DRAFT" | "PUBLISHED" | "WITHDRAWN";

export interface Release {
  id: string;
  project: string;
  project_name: string;
  version: string;
  title: string;
  notes: string;
  status: ReleaseStatus;
  status_label: string;
  published_at: string | null;
  deployment: string | null;
  deployment_label: string | null;
  created_by_email: string;
  can_edit: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReleasePayload {
  version: string;
  title: string;
  notes: string;
  deployment: string | null;
}

export const RELEASE_STATUS: Record<ReleaseStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Borrador", tone: "neutral" },
  PUBLISHED: { label: "Publicada", tone: "success" },
  WITHDRAWN: { label: "Retirada", tone: "warning" },
};

export const releasesApi = {
  async list(project: string): Promise<Paginated<Release>> {
    return (await http.get<Paginated<Release>>("/releases/", { params: { project, page_size: 100 } })).data;
  },
  async create(project: string, payload: ReleasePayload): Promise<Release> {
    return (await http.post<Release>("/releases/", { project, ...payload })).data;
  },
  async update(id: string, payload: Partial<ReleasePayload>): Promise<Release> {
    return (await http.patch<Release>(`/releases/${id}/`, payload)).data;
  },
  async publish(id: string): Promise<Release> {
    return (await http.post<Release>(`/releases/${id}/publish/`)).data;
  },
  async withdraw(id: string): Promise<Release> {
    return (await http.post<Release>(`/releases/${id}/withdraw/`)).data;
  },
};
