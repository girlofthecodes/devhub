import { CircleCheck, CircleHelp, CirclePlay, CircleX, TriangleAlert } from "lucide-react";
import { Link } from "react-router";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ProjectLogo } from "@/modules/projects/components/ProjectLogo";
import { cn } from "@/utils/cn";
import { formatDate } from "@/utils/format";

import type { AvailabilityStatus, PortalApp, PortalRelease } from "./api";

const AVAILABILITY: Record<AvailabilityStatus, { tone: BadgeTone; icon: typeof CircleCheck }> = {
  HEALTHY: { tone: "success", icon: CircleCheck },
  DEGRADED: { tone: "warning", icon: TriangleAlert },
  UNAVAILABLE: { tone: "danger", icon: CircleX },
  UNKNOWN: { tone: "neutral", icon: CircleHelp },
};

/** Availability always shows icon + label (never color alone). */
export function AvailabilityBadge({ availability }: { availability: PortalApp["availability"] }) {
  const { tone, icon: Icon } = AVAILABILITY[availability.status];
  return (
    <Badge tone={tone} className="gap-1">
      <Icon className="size-3" aria-hidden />
      <span title={availability.status === "UNKNOWN" ? "El monitoreo de disponibilidad aún no está activo" : undefined}>
        {availability.label}
      </span>
    </Badge>
  );
}

/** Opens the demo in a new tab through the launch page, which requests a one-time ticket. */
export function DemoButton({ appId, className, size = "md" }: { appId: string; className?: string; size?: "sm" | "md" }) {
  return (
    <a
      href={`/cliente/apps/${appId}/demo`}
      target="_blank"
      rel="noopener"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg bg-accent font-medium text-accent-fg shadow-sm hover:bg-accent-hover",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        className,
      )}
    >
      <CirclePlay className="size-4" /> Abrir demo
    </a>
  );
}

export function PortalAppCard({ app }: { app: PortalApp }) {
  return (
    <Card className="flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
      <Link to={`/cliente/apps/${app.id}`} className="group flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <ProjectLogo name={app.name} url={app.logo_url} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold text-fg group-hover:text-accent">{app.name}</h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <AvailabilityBadge availability={app.availability} />
              {app.published_version && <Badge tone="accent">{app.published_version}</Badge>}
            </div>
          </div>
        </div>
        <p className="mt-3 line-clamp-3 text-sm text-muted">{app.description || <span className="italic">Sin descripción.</span>}</p>
      </Link>
      <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
        <span className="text-xs text-muted">
          {app.published_at ? `Actualizada ${formatDate(app.published_at)}` : "Sin versiones publicadas"}
        </span>
        {app.has_demo && <DemoButton appId={app.id} size="sm" />}
      </div>
    </Card>
  );
}

/** Release notes as plain text (no HTML rendering → no injection). */
export function ReleaseNotes({ releases, showProject = false }: { releases: PortalRelease[]; showProject?: boolean }) {
  return (
    <ol className="relative space-y-6 before:absolute before:bottom-1 before:left-[7px] before:top-1 before:w-px before:bg-border">
      {releases.map((r, i) => (
        <li key={r.id} className="relative pl-7">
          <span
            aria-hidden
            className={cn("absolute left-0 top-1.5 size-[15px] rounded-full border-2 border-surface", i === 0 ? "bg-accent" : "bg-border-strong")}
          />
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-sm font-semibold text-fg">{r.version}</span>
            {r.title && <span className="text-sm font-medium text-fg">{r.title}</span>}
            {showProject && <Badge>{r.project_name}</Badge>}
            <time className="ml-auto text-xs text-muted" dateTime={r.published_at}>
              {formatDate(r.published_at)}
            </time>
          </div>
          <p className="mt-1 whitespace-pre-line text-sm text-muted">{r.notes}</p>
        </li>
      ))}
    </ol>
  );
}
