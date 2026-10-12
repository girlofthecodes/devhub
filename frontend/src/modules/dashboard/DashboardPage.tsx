import { useQuery } from "@tanstack/react-query";
import { Building2, FolderKanban, HeartPulse, ScrollText, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { actionTone, useAuditLogs } from "@/modules/audit/api";
import { DeploymentsChart } from "@/modules/deployments/components/DeploymentsChart";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import { useOrganizations } from "@/modules/organizations/hooks";
import { useProjects } from "@/modules/projects/hooks";
import { useUsers } from "@/modules/users/hooks";
import { http } from "@/services/http";
import { formatRelative } from "@/utils/format";

interface StatCardProps {
  label: string;
  icon: LucideIcon;
  value: number | undefined;
  loading: boolean;
  error: boolean;
  hint?: ReactNode;
  to?: string;
}

function StatCard({ label, icon: Icon, value, loading, error, hint, to }: StatCardProps) {
  const body = (
    <Card className="h-full p-5 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-fg tabular-nums">
        {loading ? <Skeleton className="h-9 w-16" /> : error ? <span className="text-base text-red-500">Error</span> : value}
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => (await http.get<{ status: string; database: string }>("/health/")).data,
    refetchInterval: 30_000,
    retry: false,
  });
}

function HealthCard() {
  const health = useHealth();
  const ok = health.data?.status === "ok";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Estado de la API</p>
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <HeartPulse className="size-4" />
        </span>
      </div>
      <div className="mt-4">
        {health.isPending ? (
          <Skeleton className="h-6 w-28" />
        ) : (
          <Badge tone={ok ? "success" : "danger"} dot className="text-sm">
            {ok ? "Operativa" : "Con problemas"}
          </Badge>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        {health.isError
          ? "No se obtuvo respuesta del backend."
          : `Base de datos: ${health.data?.database === "ok" ? "conectada" : health.data ? "sin conexión" : "…"}`}
      </p>
    </Card>
  );
}

function AdminStats() {
  const projects = useProjects({ archived: false, page_size: 1 });
  const activeUsers = useUsers({ is_active: true, page_size: 1 });
  const clients = useUsers({ role: "CLIENT", is_active: true, page_size: 1 });
  const orgs = useOrganizations({ is_active: true, page_size: 1 });
  return (
    <>
      <StatCard label="Proyectos activos" icon={FolderKanban} to="/admin/projects" value={projects.data?.count} loading={projects.isPending} error={projects.isError} />
      <StatCard label="Usuarios activos" icon={Users} to="/admin/users" value={activeUsers.data?.count} loading={activeUsers.isPending} error={activeUsers.isError} />
      <StatCard label="Clientes activos" icon={Users} to="/admin/users" value={clients.data?.count} loading={clients.isPending} error={clients.isError} />
      <StatCard label="Organizaciones activas" icon={Building2} to="/admin/organizations" value={orgs.data?.count} loading={orgs.isPending} error={orgs.isError} />
    </>
  );
}

function RecentActivity() {
  const logs = useAuditLogs({ page_size: 8 });
  return (
    <Card>
      <CardHeader
        title="Actividad reciente"
        description="Últimas acciones registradas en auditoría."
        actions={
          <Link to="/admin/audit" className="text-sm font-medium text-accent hover:underline">
            Ver todo
          </Link>
        }
      />
      {logs.isError ? (
        <ErrorState message={logs.error.message} onRetry={() => void logs.refetch()} />
      ) : logs.isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : logs.data.results.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-5" />} title="Sin actividad todavía" />
      ) : (
        <ol className="divide-y divide-border">
          {logs.data.results.map((log) => (
            <li key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
              <Badge tone={actionTone(log.action)}>{log.action_label}</Badge>
              <span className="min-w-0 flex-1 truncate text-fg">
                {log.target_repr || "—"}
                <span className="text-muted"> · {log.actor_email || "anónimo"}</span>
              </span>
              <time className="text-xs text-muted" dateTime={log.created_at}>
                {formatRelative(log.created_at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const user = useAuthenticatedUser();
  const isAdmin = user.role === "ADMIN";
  const orgs = useOrganizations({ page_size: 1 });
  const myProjects = useProjects({ archived: false, page_size: 1 }, !isAdmin);
  return (
    <>
      <PageHeader
        title={`Hola, ${user.first_name || user.full_name}`}
        description="Resumen del estado de DevHub."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {isAdmin ? (
          <AdminStats />
        ) : (
          <>
          <StatCard
            label="Mis proyectos"
            icon={FolderKanban}
            to="/admin/projects"
            value={myProjects.data?.count}
            loading={myProjects.isPending}
            error={myProjects.isError}
          />
          <StatCard
            label="Mis organizaciones"
            icon={Building2}
            to="/admin/organizations"
            value={orgs.data?.count}
            loading={orgs.isPending}
            error={orgs.isError}
          />
          </>
        )}
        <HealthCard />
      </div>
      <div className="mt-6">
        <DeploymentsChart title={isAdmin ? "Despliegues por día" : "Despliegues de mis proyectos"} />
      </div>
      {isAdmin && (
        <div className="mt-6">
          <RecentActivity />
        </div>
      )}
    </>
  );
}
