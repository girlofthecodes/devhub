import { GitBranch, Link2, X } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { Pagination, SearchInput } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";
import { useProjects } from "@/modules/projects/hooks";
import { cn } from "@/utils/cn";

import type { EventSource, EventType, Severity } from "../api";
import { useEvents } from "../hooks";
import { EventTimeline } from "../components/EventTimeline";
import { EVENT_SOURCES, EVENT_TYPES, SEVERITY } from "../constants";

const PAGE_SIZE = 30;
const startOfDay = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

export function TraceabilityPage() {
  const [params, setParams] = useSearchParams();
  const correlation = params.get("correlation") ?? "";
  const [project, setProject] = useState(params.get("project") ?? "");
  const [type, setType] = useState<EventType | "">("");
  const [severities, setSeverities] = useState<Severity[]>([]);
  const [source, setSource] = useState<EventSource | "">("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search);
  const projects = useProjects({ page_size: 100 });
  const events = useEvents({
    page,
    page_size: PAGE_SIZE,
    project: project || undefined,
    event_type: type || undefined,
    severity: severities.length ? severities.join(",") : undefined,
    source: source || undefined,
    search: debounced || undefined,
    correlation_id: correlation || undefined,
    occurred_from: startOfDay(from),
    occurred_to: endOfDay(to),
  });
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };
  const setCorrelation = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("correlation", value);
    else next.delete("correlation");
    setParams(next);
    setPage(1);
  };
  const toggleSeverity = (s: Severity) =>
    reset(setSeverities)(severities.includes(s) ? severities.filter((x) => x !== s) : [...severities, s]);
  const filtered = Boolean(project || type || severities.length || source || debounced || from || to || correlation);

  return (
    <>
      <PageHeader
        title="Trazabilidad"
        description="Qué ocurrió, cuándo, dónde y qué lo originó. Los eventos son inmutables."
      />
      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={search} onChange={reset(setSearch)} placeholder="Buscar en descripción o responsable…" className="sm:col-span-2" />
          <Select value={project} onChange={(e) => reset(setProject)(e.target.value)} aria-label="Filtrar por proyecto">
            <option value="">Todos los proyectos</option>
            {projects.data?.results.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select value={type} onChange={(e) => reset(setType)(e.target.value as EventType | "")} aria-label="Filtrar por tipo">
            <option value="">Todos los tipos</option>
            {(Object.keys(EVENT_TYPES) as EventType[]).map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPES[t].label}
              </option>
            ))}
          </Select>
          <Select value={source} onChange={(e) => reset(setSource)(e.target.value as EventSource | "")} aria-label="Filtrar por origen">
            <option value="">Todos los orígenes</option>
            {(Object.keys(EVENT_SOURCES) as EventSource[]).map((s) => (
              <option key={s} value={s}>
                {EVENT_SOURCES[s]}
              </option>
            ))}
          </Select>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="Desde" />
          <Input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} aria-label="Hasta" />
          <div role="group" aria-label="Severidad" className="flex flex-wrap items-center gap-1.5 sm:col-span-2 lg:col-span-1">
            {(Object.keys(SEVERITY) as Severity[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={severities.includes(s)}
                onClick={() => toggleSeverity(s)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                  severities.includes(s) ? "border-accent bg-accent-soft text-fg" : "border-border text-muted hover:text-fg",
                )}
              >
                <span className={cn("size-2 rounded-full", SEVERITY[s].dot)} aria-hidden />
                {SEVERITY[s].label}
              </button>
            ))}
          </div>
        </div>
        {correlation && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5 text-sm">
            <Link2 className="size-4 text-accent" />
            <span className="text-muted">Mostrando eventos correlacionados con</span>
            <code className="font-mono text-fg">{correlation}</code>
            <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setCorrelation("")}>
              Quitar
            </Button>
          </div>
        )}
      </Card>
      <Card>
        <div className="px-5 py-5">
          {events.isError ? (
            <ErrorState message={events.error.message} onRetry={() => void events.refetch()} />
          ) : events.isPending ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : events.data.results.length === 0 ? (
            <EmptyState
              icon={<GitBranch className="size-5" />}
              title={filtered ? "Sin eventos con esos filtros" : "Aún no hay eventos"}
              description={filtered ? "Prueba con otros filtros." : "Los eventos se registran al crear proyectos, cambiar accesos, configurar entornos y desplegar."}
            />
          ) : (
            <EventTimeline events={events.data.results} onCorrelate={setCorrelation} />
          )}
        </div>
        {events.data && events.data.count > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} count={events.data.count} onPageChange={setPage} />
        )}
      </Card>
    </>
  );
}
