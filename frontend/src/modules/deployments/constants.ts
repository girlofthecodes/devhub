import type { BadgeTone } from "@/components/ui/Badge";

import type { DeploymentSource, DeploymentStatus } from "./api";

export const DEPLOYMENT_STATUS: Record<DeploymentStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "Pendiente", tone: "neutral" },
  RUNNING: { label: "En ejecución", tone: "info" },
  SUCCESS: { label: "Exitoso", tone: "success" },
  FAILED: { label: "Fallido", tone: "danger" },
  CANCELLED: { label: "Cancelado", tone: "warning" },
};
export const DEPLOYMENT_STATUS_OPTIONS = (Object.keys(DEPLOYMENT_STATUS) as DeploymentStatus[]).map((value) => ({
  value,
  label: DEPLOYMENT_STATUS[value].label,
}));

export const DEPLOYMENT_SOURCE: Record<DeploymentSource, string> = {
  MANUAL: "Manual",
  GITHUB_ACTIONS: "GitHub Actions",
  API: "Integración API",
};

/** Allowed next states (mirrors the backend state machine). */
export const NEXT_STATUSES: Record<DeploymentStatus, Exclude<DeploymentStatus, "PENDING">[]> = {
  PENDING: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["SUCCESS", "FAILED", "CANCELLED"],
  SUCCESS: [],
  FAILED: [],
  CANCELLED: [],
};

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** Link to the commit when the repository is on GitHub/GitLab; otherwise null. */
export function commitUrl(repositoryUrl: string, sha: string): string | null {
  if (!repositoryUrl || !sha) return null;
  const base = repositoryUrl.replace(/\.git$/, "").replace(/\/$/, "");
  if (/^https:\/\/(www\.)?github\.com\//.test(base)) return `${base}/commit/${sha}`;
  if (/^https:\/\/(www\.)?gitlab\.com\//.test(base)) return `${base}/-/commit/${sha}`;
  return null;
}
