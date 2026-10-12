import { ChevronRight, ScrollText } from "lucide-react";
import { Fragment, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { Pagination, SearchInput } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/utils/cn";
import { formatDateTime } from "@/utils/format";

import { actionTone, AUDIT_ACTIONS, useAuditLogs, type AuditLog } from "./api";

const PAGE_SIZE = 25;

function startOfDay(date: string) {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
}
function endOfDay(date: string) {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined;
}

function JsonBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  if (!value || Object.keys(value).length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-fg">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function AuditRow({ log }: { log: AuditLog }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr
        className="cursor-pointer transition-colors hover:bg-surface-2/60"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <td className="px-5 py-3">
          <ChevronRight className={cn("size-4 text-muted transition-transform", open && "rotate-90")} />
        </td>
        <td className="whitespace-nowrap px-2 py-3 text-muted">{formatDateTime(log.created_at)}</td>
        <td className="px-5 py-3">
          <Badge tone={actionTone(log.action)}>{log.action_label}</Badge>
        </td>
        <td className="px-5 py-3 text-fg">{log.actor_email || <span className="text-muted">Sistema / anónimo</span>}</td>
        <td className="hidden max-w-64 truncate px-5 py-3 text-muted md:table-cell">{log.target_repr || "—"}</td>
      </tr>
      {open && (
        <tr className="bg-surface-2/30">
          <td />
          <td colSpan={4} className="space-y-3 px-2 py-4 pr-5">
            <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted">IP</dt>
                <dd className="font-mono text-fg">{log.ip_address ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Objeto</dt>
                <dd className="font-mono text-fg">{log.target_type || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Request ID</dt>
                <dd className="truncate font-mono text-fg">{log.request_id || "—"}</dd>
              </div>
            </dl>
            <JsonBlock label="Cambios" value={log.changes} />
            <JsonBlock label="Metadatos" value={log.metadata} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function AuditPage() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search);
  const logs = useAuditLogs({
    page,
    page_size: PAGE_SIZE,
    search: debounced || undefined,
    action: action || undefined,
    created_from: startOfDay(from),
    created_to: endOfDay(to),
  });

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Registro inalterable de acciones administrativas y de seguridad. Los datos sensibles se redactan."
      />
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-[1fr_14rem_10rem_10rem]">
          <SearchInput value={search} onChange={reset(setSearch)} placeholder="Buscar por usuario u objeto…" />
          <Select value={action} onChange={(e) => reset(setAction)(e.target.value)} aria-label="Filtrar por acción">
            <option value="">Todas las acciones</option>
            {Object.entries(AUDIT_ACTIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="Desde" />
          <Input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} aria-label="Hasta" />
        </div>
        {logs.isError ? (
          <ErrorState message={logs.error.message} onRetry={() => void logs.refetch()} />
        ) : logs.data && logs.data.count === 0 ? (
          <EmptyState icon={<ScrollText className="size-5" />} title="Sin registros" description="No hay eventos con esos filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Registros de auditoría</caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="w-10 px-5 py-2.5" />
                  <th className="px-2 py-2.5 font-medium">Fecha</th>
                  <th className="px-5 py-2.5 font-medium">Acción</th>
                  <th className="px-5 py-2.5 font-medium">Usuario</th>
                  <th className="hidden px-5 py-2.5 font-medium md:table-cell">Objeto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.isPending
                  ? Array.from({ length: 6 }, (_, i) => (
                      <tr key={i}>
                        <td colSpan={5} className="px-5 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      </tr>
                    ))
                  : logs.data.results.map((log) => <AuditRow key={log.id} log={log} />)}
              </tbody>
            </table>
          </div>
        )}
        {logs.data && logs.data.count > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} count={logs.data.count} onPageChange={setPage} />
        )}
      </Card>
    </>
  );
}
