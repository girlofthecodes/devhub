import { Ban, Building2, FolderKanban, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { DataTable, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/utils/format";
import { errorMessage } from "@/utils/forms";

import type { ProjectAccess } from "../api";
import { ACCESS_STATE } from "../constants";
import { useProjectAccess, useRevokeAccess } from "../hooks";
import { GrantAccessDialog } from "./GrantAccessDialog";

type Scope =
  | { project: { id: string; name: string; is_archived: boolean } }
  | { organization: { id: string; name: string; is_active: boolean } };

/** Organization ↔ project grants, shown from either side (admins only). */
export function AccessGrantsCard({ scope }: { scope: Scope }) {
  const byProject = "project" in scope;
  const [showHistory, setShowHistory] = useState(false);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<ProjectAccess | null>(null);
  const revoke = useRevokeAccess();
  const toast = useToast();
  const grants = useProjectAccess({
    ...(byProject ? { project: scope.project.id } : { organization: scope.organization.id }),
    state: showHistory ? undefined : "ACTIVE",
    page_size: 100,
  });
  const current = useProjectAccess({
    ...(byProject ? { project: scope.project.id } : { organization: scope.organization.id }),
    state: "ACTIVE",
    page_size: 100,
  });
  const excludeIds = new Set(
    (current.data?.results ?? []).map((g) => (byProject ? g.organization : g.project)),
  );
  const canGrant = byProject ? !scope.project.is_archived : scope.organization.is_active;

  const columns: Column<ProjectAccess>[] = [
    {
      key: "target",
      header: byProject ? "Organización" : "Proyecto",
      cell: (g) => (
        <Link
          to={byProject ? `/admin/organizations/${g.organization}` : `/admin/projects/${g.project}`}
          className="flex items-center gap-2 font-medium text-fg hover:text-accent"
        >
          {byProject ? <Building2 className="size-4 text-muted" /> : <FolderKanban className="size-4 text-muted" />}
          {byProject ? g.organization_name : g.project_name}
        </Link>
      ),
    },
    {
      key: "state",
      header: "Estado",
      cell: (g) => (
        <Badge tone={ACCESS_STATE[g.state].tone} dot>
          {ACCESS_STATE[g.state].label}
        </Badge>
      ),
    },
    {
      key: "expires",
      header: "Expira",
      cell: (g) => <span className="text-muted">{g.expires_at ? formatDate(g.expires_at) : "Sin expiración"}</span>,
    },
    {
      key: "granted",
      header: "Concedido",
      hideOnMobile: true,
      cell: (g) => (
        <span className="text-xs text-muted">
          {formatDate(g.created_at)}
          {g.granted_by_email && <> · {g.granted_by_email}</>}
          {g.notes && <span className="block truncate">{g.notes}</span>}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (g) =>
        g.state !== "REVOKED" && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Ban className="size-3.5" />}
            className="text-red-600 dark:text-red-400"
            onClick={() => setRevoking(g)}
          >
            Revocar
          </Button>
        ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={byProject ? "Organizaciones con acceso" : "Proyectos autorizados"}
        description="Acceso explícito al portal de clientes. Revocar conserva el historial."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Solo vigentes" : "Ver historial"}
            </Button>
            <Button
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => setGranting(true)}
              disabled={!canGrant}
              title={canGrant ? undefined : byProject ? "El proyecto está archivado" : "La organización está inactiva"}
            >
              Conceder
            </Button>
          </>
        }
      />
      <DataTable
        caption="Accesos"
        columns={columns}
        rows={grants.data?.results}
        rowKey={(g) => g.id}
        loading={grants.isPending}
        error={grants.error}
        onRetry={() => void grants.refetch()}
        empty={
          <EmptyState
            icon={<KeyRound className="size-5" />}
            title={showHistory ? "Sin registros de acceso" : "Sin accesos vigentes"}
            description={
              byProject
                ? "Concede acceso para que una organización vea este proyecto en el portal."
                : "Concede acceso para que esta organización vea proyectos en el portal."
            }
          />
        }
      />
      <GrantAccessDialog
        open={granting}
        onClose={() => setGranting(false)}
        excludeIds={excludeIds}
        fixed={
          byProject
            ? { project: { id: scope.project.id, name: scope.project.name } }
            : { organization: { id: scope.organization.id, name: scope.organization.name } }
        }
      />
      <ConfirmDialog
        open={revoking !== null}
        title="Revocar acceso"
        message={
          <>
            <strong>{revoking?.organization_name}</strong> dejará de ver <strong>{revoking?.project_name}</strong> en el
            portal de inmediato. El registro se conserva en el historial.
          </>
        }
        confirmLabel="Revocar"
        loading={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() =>
          revoking &&
          revoke.mutate(revoking.id, {
            onSuccess: () => toast.success("Acceso revocado"),
            onError: (e) => toast.error("No se pudo revocar", errorMessage(e)),
            onSettled: () => setRevoking(null),
          })
        }
      />
    </Card>
  );
}
