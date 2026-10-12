import { FolderKanban, LayoutGrid, List, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { DataTable, Pagination, SearchInput, type Column } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import { cn } from "@/utils/cn";
import { formatRelative } from "@/utils/format";

import type { Project, ProjectListParams, ProjectStatus } from "../api";
import { ProjectCard } from "../components/ProjectCard";
import { ProjectFormDialog } from "../components/ProjectFormDialog";
import { ProjectLogo } from "../components/ProjectLogo";
import { EDITABLE_STATUS_OPTIONS, statusTone } from "../constants";
import { useProjects, useTechnologies } from "../hooks";

const PAGE_SIZE = 12;
type StatusFilter = "active" | "archived" | "all" | Exclude<ProjectStatus, "ARCHIVED">;
type View = "grid" | "table";

function statusParams(filter: StatusFilter): Pick<ProjectListParams, "archived" | "status"> {
  if (filter === "active") return { archived: false };
  if (filter === "archived") return { archived: true };
  if (filter === "all") return {};
  return { status: filter };
}

export function ProjectsPage() {
  const me = useAuthenticatedUser();
  const isAdmin = me.role === "ADMIN";
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [technology, setTechnology] = useState("");
  const [view, setView] = useState<View>("grid");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search);
  const technologies = useTechnologies();

  const projects = useProjects({
    page,
    page_size: PAGE_SIZE,
    search: debounced || undefined,
    technology: technology || undefined,
    ...statusParams(status),
  });

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };
  const filtered = Boolean(debounced || technology || status !== "active");

  const columns: Column<Project>[] = [
    {
      key: "name",
      header: "Proyecto",
      cell: (p) => (
        <div className="flex items-center gap-3">
          <ProjectLogo name={p.name} url={p.logo_url} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{p.name}</p>
            <p className="truncate font-mono text-xs text-muted">{p.slug}</p>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (p) => (
        <Badge tone={statusTone(p.status)} dot>
          {p.status_label}
        </Badge>
      ),
    },
    {
      key: "owner",
      header: "Responsable",
      hideOnMobile: true,
      cell: (p) => (
        <span className="flex items-center gap-2">
          <Avatar name={p.owner.full_name} className="size-6 text-[10px]" />
          <span className="truncate">{p.owner.full_name}</span>
        </span>
      ),
    },
    {
      key: "tech",
      header: "Tecnologías",
      hideOnMobile: true,
      cell: (p) => <span className="text-muted">{p.technologies.slice(0, 3).join(", ") || "—"}</span>,
    },
    {
      key: "updated",
      header: "Actualizado",
      hideOnMobile: true,
      cell: (p) => <span className="text-muted">{formatRelative(p.updated_at)}</span>,
    },
  ];

  const empty = (
    <EmptyState
      icon={<FolderKanban className="size-5" />}
      title={filtered ? "Sin coincidencias" : "Aún no hay proyectos"}
      description={
        filtered
          ? "Prueba con otros filtros."
          : isAdmin
            ? "Registra la primera aplicación que administrará DevHub."
            : "Cuando un administrador te asigne a un proyecto, aparecerá aquí."
      }
      action={
        !filtered &&
        isAdmin && (
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nuevo proyecto
          </Button>
        )
      }
    />
  );

  return (
    <>
      <PageHeader
        title="Proyectos"
        description={isAdmin ? "Aplicaciones independientes administradas por DevHub." : "Proyectos de los que eres responsable o en los que participas."}
        actions={
          isAdmin && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nuevo proyecto
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row">
        <SearchInput value={search} onChange={resetPage(setSearch)} placeholder="Buscar por nombre o descripción…" className="flex-1" />
        <div className="flex flex-wrap gap-3">
          <Select
            value={status}
            onChange={(e) => resetPage(setStatus)(e.target.value as StatusFilter)}
            aria-label="Filtrar por estado"
            className="w-44"
          >
            <option value="active">Activos</option>
            {EDITABLE_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
            <option value="archived">Archivados</option>
            <option value="all">Todos</option>
          </Select>
          <Select
            value={technology}
            onChange={(e) => resetPage(setTechnology)(e.target.value)}
            aria-label="Filtrar por tecnología"
            className="w-44"
          >
            <option value="">Todas las tecnologías</option>
            {technologies.data?.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <div role="radiogroup" aria-label="Vista" className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
            {(
              [
                ["grid", LayoutGrid, "Tarjetas"],
                ["table", List, "Tabla"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={view === value}
                aria-label={label}
                title={label}
                onClick={() => setView(value)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md text-muted hover:text-fg",
                  view === value && "bg-surface text-fg shadow-xs",
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "grid" ? (
        projects.isError ? (
          <Card>
            <ErrorState message={projects.error.message} onRetry={() => void projects.refetch()} />
          </Card>
        ) : projects.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-52 rounded-xl" />
            ))}
          </div>
        ) : projects.data.results.length === 0 ? (
          <Card>{empty}</Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {projects.data.results.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
            <Card className="mt-4">
              <Pagination page={page} pageSize={PAGE_SIZE} count={projects.data.count} onPageChange={setPage} />
            </Card>
          </>
        )
      ) : (
        <Card>
          <DataTable
            caption="Proyectos"
            columns={columns}
            rows={projects.data?.results}
            rowKey={(p) => p.id}
            loading={projects.isPending}
            error={projects.error}
            onRetry={() => void projects.refetch()}
            onRowClick={(p) => navigate(`/admin/projects/${p.id}`)}
            empty={empty}
          />
          {projects.data && projects.data.count > 0 && (
            <Pagination page={page} pageSize={PAGE_SIZE} count={projects.data.count} onPageChange={setPage} />
          )}
        </Card>
      )}

      <ProjectFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(p) => navigate(`/admin/projects/${p.id}`)}
      />
    </>
  );
}
