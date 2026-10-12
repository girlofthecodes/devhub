import { Building2, Globe, Users } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatRelative } from "@/utils/format";

import type { Project } from "../api";
import { statusTone } from "../constants";
import { ProjectLogo } from "./ProjectLogo";

const MAX_TECHS = 4;

export function ProjectCard({ project }: { project: Project }) {
  const extra = project.technologies.length - MAX_TECHS;
  return (
    <Link to={`/admin/projects/${project.id}`} className="group block h-full">
      <Card className="flex h-full flex-col p-5 transition-all group-hover:-translate-y-0.5 group-hover:border-border-strong group-hover:shadow-md">
        <div className="flex items-start gap-3">
          <ProjectLogo name={project.name} url={project.logo_url} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold text-fg group-hover:text-accent">{project.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={statusTone(project.status)} dot>
                {project.status_label}
              </Badge>
              {project.visibility === "PUBLIC" && (
                <Badge tone="info">
                  <Globe className="size-3" /> Portafolio
                </Badge>
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted">
          {project.description || <span className="italic">Sin descripción</span>}
        </p>
        {project.technologies.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {project.technologies.slice(0, MAX_TECHS).map((t) => (
              <span key={t} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-fg">
                {t}
              </span>
            ))}
            {extra > 0 && <span className="px-1 py-0.5 text-xs text-muted">+{extra}</span>}
          </div>
        )}
        <div className="min-h-4 flex-1" />
        <div className="flex items-center gap-4 border-t border-border pt-3 text-xs text-muted">
          <span className="flex items-center gap-1" title="Desarrolladores asignados">
            <Users className="size-3.5" /> {project.member_count}
          </span>
          <span className="flex items-center gap-1" title="Organizaciones con acceso">
            <Building2 className="size-3.5" /> {project.organization_count}
          </span>
          <span className="ml-auto truncate">Actualizado {formatRelative(project.updated_at)}</span>
        </div>
      </Card>
    </Link>
  );
}
