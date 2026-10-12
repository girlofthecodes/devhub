import { ChevronDown, Link2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { cn } from "@/utils/cn";

import type { TraceEvent } from "../api";
import { EVENT_TYPES, SEVERITY } from "../constants";

const dayFormat = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Positive outcomes read green regardless of their (informational) severity.
const POSITIVE = new Set(["DEPLOYMENT_SUCCESS", "SERVICE_RECOVERED"]);

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function EventItem({
  event,
  onCorrelate,
  compact,
}: {
  event: TraceEvent;
  onCorrelate?: (correlationId: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const type = EVENT_TYPES[event.event_type];
  const severity = SEVERITY[event.severity];
  const Icon = type.icon;
  const hasMetadata = Object.keys(event.metadata ?? {}).length > 0;

  return (
    <li className="relative pl-10">
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0.5 flex size-7 items-center justify-center rounded-full border-2 border-surface text-white",
          POSITIVE.has(event.event_type) ? "bg-emerald-500" : severity.dot,
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-fg">{type.label}</span>
        {event.severity !== "INFO" && (
          <Badge tone={severity.tone} dot>
            {severity.label}
          </Badge>
        )}
        <time dateTime={event.occurred_at} className="ml-auto text-xs tabular-nums text-muted">
          {timeFormat.format(new Date(event.occurred_at))}
        </time>
      </div>
      <p className="mt-0.5 text-sm text-muted">{event.description}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        {!compact && event.project && (
          <Link to={`/admin/projects/${event.project}`} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-fg hover:text-accent">
            {event.project_name}
          </Link>
        )}
        {event.environment_kind && <Badge>{event.environment_kind}</Badge>}
        {event.deployment && (
          <Link to={`/admin/deployments/${event.deployment}`} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-fg hover:text-accent">
            {event.deployment_version}
          </Link>
        )}
        <span className="text-muted">
          {event.source_label}
          {event.actor_label && <> · {event.actor_label}</>}
        </span>
        {(hasMetadata || event.correlation_id) && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="ml-auto inline-flex items-center gap-0.5 text-muted hover:text-fg"
          >
            Detalle <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface-2/50 p-3">
          {event.correlation_id && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Correlación</span>
              <code className="truncate font-mono text-fg">{event.correlation_id}</code>
              {onCorrelate && (
                <button
                  type="button"
                  onClick={() => onCorrelate(event.correlation_id)}
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  <Link2 className="size-3.5" /> Ver eventos relacionados
                </button>
              )}
            </div>
          )}
          {hasMetadata && (
            <pre className="overflow-x-auto font-mono text-xs text-fg">{JSON.stringify(event.metadata, null, 2)}</pre>
          )}
        </div>
      )}
    </li>
  );
}

/** Vertical timeline grouped by day. */
export function EventTimeline({
  events,
  onCorrelate,
  compact = false,
}: {
  events: TraceEvent[];
  onCorrelate?: (correlationId: string) => void;
  compact?: boolean;
}) {
  const groups: { key: string; label: string; items: TraceEvent[] }[] = [];
  for (const event of events) {
    const key = dayKey(event.occurred_at);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: dayFormat.format(new Date(event.occurred_at)), items: [] };
      groups.push(group);
    }
    group.items.push(event);
  }
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted first-letter:uppercase">{group.label}</h3>
          <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-border">
            {group.items.map((event) => (
              <EventItem key={event.id} event={event} onCorrelate={onCorrelate} compact={compact} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
