import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BookOpen,
  ExternalLink as ExternalLinkIcon,
  EyeOff,
  GitBranch,
  Globe,
  ImageUp,
  Info,
  Pencil,
  Trash2,
} from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ProjectEnvironmentsCard } from "@/modules/infrastructure/components/ProjectEnvironmentsCard";
import { ApiError } from "@/services/http";
import { formatDateTime } from "@/utils/format";
import { errorMessage } from "@/utils/forms";

import type { Project } from "../api";
import { AccessGrantsCard } from "../components/AccessGrantsCard";
import { ProjectFormDialog } from "../components/ProjectFormDialog";
import { ProjectLogo } from "../components/ProjectLogo";
import { ProjectMembersCard } from "../components/ProjectMembersCard";
import { statusTone } from "../constants";
import { useArchiveProject, useProject, useProjectLogo, useSetVisibility } from "../hooks";

const ACCEPTED = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 1024 * 1024;

function ExternalLink({ href, icon: Icon, label }: { href: string; icon: typeof GitBranch; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 truncate text-sm text-accent hover:underline"
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );
}

function LogoCard({ project }: { project: Project }) {
  const input = useRef<HTMLInputElement>(null);
  const logo = useProjectLogo();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED.split(",").includes(file.type)) return setError("Formato no permitido. Usa PNG, JPG o WEBP.");
    if (file.size > MAX_BYTES) return setError("La imagen supera 1 MB.");
    setError(null);
    logo.mutate(
      { id: project.id, file },
      {
        onSuccess: () => toast.success("Logotipo actualizado"),
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Card>
      <CardHeader title="Logotipo" />
      <CardBody className="flex items-center gap-4">
        <ProjectLogo name={project.name} url={project.logo_url} size="lg" />
        <div className="space-y-2">
          <input ref={input} type="file" accept={ACCEPTED} className="hidden" onChange={onFile} aria-label="Archivo de logotipo" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={<ImageUp className="size-4" />} loading={logo.isPending} onClick={() => input.current?.click()}>
              {project.logo_url ? "Cambiar" : "Subir"}
            </Button>
            {project.logo_url && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 className="size-4" />}
                disabled={logo.isPending}
                onClick={() =>
                  logo.mutate(
                    { id: project.id, file: null },
                    { onSuccess: () => toast.success("Logotipo eliminado"), onError: (e) => setError(errorMessage(e)) },
                  )
                }
              >
                Quitar
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">PNG, JPG o WEBP · máx. 1 MB · 2048 px</p>
        </div>
      </CardBody>
      {error && (
        <div className="px-5 pb-4">
          <Alert>{error}</Alert>
        </div>
      )}
    </Card>
  );
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const project = useProject(id);
  const archive = useArchiveProject();
  const visibility = useSetVisibility();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (project.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-80" />
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (project.isError) {
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    return (
      <Card>
        <ErrorState
          title={notFound ? "Proyecto no encontrado" : "No se pudo cargar el proyecto"}
          message={notFound ? "No existe o no tienes acceso a él." : project.error.message}
          onRetry={notFound ? undefined : () => void project.refetch()}
        />
      </Card>
    );
  }

  const p = project.data;
  const { can_edit: canEdit, can_manage: canManage } = p.permissions;

  return (
    <>
      <Link to="/admin/projects" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Proyectos
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-4">
            <ProjectLogo name={p.name} url={p.logo_url} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{p.name}</span>
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge tone={statusTone(p.status)} dot>
                  {p.status_label}
                </Badge>
                <Badge tone={p.visibility === "PUBLIC" ? "info" : "neutral"}>
                  {p.visibility === "PUBLIC" ? <Globe className="size-3" /> : <EyeOff className="size-3" />}
                  {p.visibility_label}
                </Badge>
              </span>
            </span>
          </span>
        }
        actions={
          <>
            {p.site_url && (
              <a
                href={p.site_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-hover"
              >
                <ExternalLinkIcon className="size-4" /> Visitar sitio
              </a>
            )}
            {canEdit && (
              <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Editar
              </Button>
            )}
            {canManage && !p.is_archived && (
              <Button
                variant="outline"
                icon={p.visibility === "PUBLIC" ? <EyeOff className="size-4" /> : <Globe className="size-4" />}
                loading={visibility.isPending}
                onClick={() =>
                  visibility.mutate(
                    { id: p.id, visibility: p.visibility === "PUBLIC" ? "INTERNAL" : "PUBLIC" },
                    {
                      onSuccess: (r) =>
                        toast.success(r.visibility === "PUBLIC" ? "Publicado en el portafolio" : "Oculto del portafolio"),
                      onError: (e) => toast.error("No se pudo cambiar la visibilidad", errorMessage(e)),
                    },
                  )
                }
              >
                {p.visibility === "PUBLIC" ? "Ocultar del portafolio" : "Publicar en portafolio"}
              </Button>
            )}
            {canManage && (
              <Button
                variant={p.is_archived ? "primary" : "danger"}
                icon={p.is_archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                onClick={() => setConfirmArchive(true)}
              >
                {p.is_archived ? "Restaurar" : "Archivar"}
              </Button>
            )}
          </>
        }
      />

      {p.is_archived && (
        <div className="mb-6">
          <Alert tone="info">
            Proyecto archivado el {formatDateTime(p.archived_at)}. Es de solo lectura y su historial se conserva.
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Descripción" />
            <CardBody>
              <p className="whitespace-pre-line text-sm text-fg">
                {p.description || <span className="italic text-muted">Sin descripción.</span>}
              </p>
            </CardBody>
          </Card>
          <ProjectEnvironmentsCard
            project={{ id: p.id, name: p.name, is_archived: p.is_archived }}
            canEdit={canEdit}
          />
          <ProjectMembersCard project={p} />
          {canManage && (
            <AccessGrantsCard scope={{ project: { id: p.id, name: p.name, is_archived: p.is_archived } }} />
          )}
          <Card>
            <CardBody className="flex items-start gap-3 text-sm text-muted">
              <Info className="mt-0.5 size-4 shrink-0" />
              El historial de despliegues y los eventos de trazabilidad de este proyecto se habilitan en la Fase 4.
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Información" />
            <CardBody>
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="text-muted">Responsable</dt>
                  <dd className="mt-1 flex items-center gap-2 text-fg">
                    <Avatar name={p.owner.full_name} className="size-6 text-[10px]" />
                    <span className="truncate">{p.owner.full_name}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Identificador</dt>
                  <dd className="mt-1 font-mono text-fg">{p.slug}</dd>
                </div>
                <div>
                  <dt className="text-muted">Enlaces</dt>
                  <dd className="mt-1 space-y-1.5">
                    {p.site_url ? (
                      <ExternalLink href={p.site_url} icon={Globe} label={p.site_url.replace(/^https:\/\//, "")} />
                    ) : null}
                    {p.repository_url ? (
                      <ExternalLink href={p.repository_url} icon={GitBranch} label={p.repository_url.replace(/^https:\/\//, "")} />
                    ) : null}
                    {p.documentation_url ? (
                      <ExternalLink href={p.documentation_url} icon={BookOpen} label="Documentación" />
                    ) : null}
                    {!p.site_url && !p.repository_url && !p.documentation_url && <span className="text-muted">—</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Tecnologías</dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.technologies.length
                      ? p.technologies.map((t) => (
                          <span key={t} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-fg">
                            {t}
                          </span>
                        ))
                      : "—"}
                  </dd>
                </div>
                <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                  <div>
                    <dt className="text-muted">Creado</dt>
                    <dd className="mt-1 text-fg">{formatDateTime(p.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Actualizado</dt>
                    <dd className="mt-1 text-fg">{formatDateTime(p.updated_at)}</dd>
                  </div>
                </div>
              </dl>
            </CardBody>
          </Card>
          {canEdit && <LogoCard project={p} />}
        </div>
      </div>

      <ProjectFormDialog open={editing} project={p} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={confirmArchive}
        title={p.is_archived ? "Restaurar proyecto" : "Archivar proyecto"}
        message={
          p.is_archived
            ? "El proyecto volverá a su estado anterior y podrá editarse de nuevo."
            : "El proyecto quedará en solo lectura, se ocultará del portal de clientes y conservará todo su historial."
        }
        tone={p.is_archived ? "primary" : "danger"}
        confirmLabel={p.is_archived ? "Restaurar" : "Archivar"}
        loading={archive.isPending}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() =>
          archive.mutate(
            { id: p.id, archive: !p.is_archived },
            {
              onSuccess: (r) => toast.success(r.is_archived ? "Proyecto archivado" : "Proyecto restaurado"),
              onError: (e) => toast.error("No se pudo completar la acción", errorMessage(e)),
              onSettled: () => setConfirmArchive(false),
            },
          )
        }
      />
    </>
  );
}
