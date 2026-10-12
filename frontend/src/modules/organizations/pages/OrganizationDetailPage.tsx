import { ArrowLeft, Building2, Pencil, Power, PowerOff, Trash2, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Modal";
import { DataTable, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import { formatDateTime } from "@/utils/format";
import { errorMessage } from "@/utils/forms";

import { MEMBERSHIP_ROLE_LABEL, type Membership, type MembershipRole, type Organization } from "../api";
import { AddMemberDialog } from "../components/AddMemberDialog";
import { OrganizationFormDialog } from "../components/OrganizationFormDialog";
import {
  useMembers,
  useOrganization,
  useRemoveMember,
  useSetOrganizationActive,
  useUpdateMember,
} from "../hooks";

function MembersCard({ organization }: { organization: Organization }) {
  const members = useMembers(organization.id);
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Membership | null>(null);

  const existing = useMemo(
    () => new Set((members.data?.results ?? []).map((m) => m.user)),
    [members.data],
  );

  const columns: Column<Membership>[] = [
    {
      key: "user",
      header: "Usuario",
      cell: (m) => (
        <div className="flex items-center gap-3">
          <Avatar name={m.user_detail.full_name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{m.user_detail.full_name}</p>
            <p className="truncate text-xs text-muted">{m.user_detail.email}</p>
          </div>
          {!m.user_detail.is_active && <Badge>Inactivo</Badge>}
        </div>
      ),
    },
    {
      key: "role",
      header: "Rol",
      cell: (m) => (
        <Select
          value={m.role}
          aria-label={`Rol de ${m.user_detail.email}`}
          className="h-8 w-36"
          disabled={update.isPending}
          onChange={(e) =>
            update.mutate(
              { id: m.id, role: e.target.value as MembershipRole },
              {
                onSuccess: () => toast.success("Rol actualizado", m.user_detail.email),
                onError: (err) => toast.error("No se pudo actualizar el rol", errorMessage(err)),
              },
            )
          }
        >
          {(Object.keys(MEMBERSHIP_ROLE_LABEL) as MembershipRole[]).map((r) => (
            <option key={r} value={r}>
              {MEMBERSHIP_ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: "since",
      header: "Desde",
      hideOnMobile: true,
      cell: (m) => <span className="text-muted">{formatDateTime(m.created_at)}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (m) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Quitar a ${m.user_detail.email}`}
          title="Quitar de la organización"
          onClick={() => setRemoving(m)}
        >
          <Trash2 className="size-4 text-red-500" />
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Miembros"
        description="Usuarios que acceden en nombre de esta organización."
        actions={
          <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
            Agregar miembro
          </Button>
        }
      />
      <DataTable
        caption="Miembros"
        columns={columns}
        rows={members.data?.results}
        rowKey={(m) => m.id}
        loading={members.isPending}
        error={members.error}
        onRetry={() => void members.refetch()}
        empty={
          <EmptyState
            icon={<Users className="size-5" />}
            title="Sin miembros"
            description="Agrega usuarios para que puedan acceder al portal en nombre de esta organización."
          />
        }
      />
      <AddMemberDialog
        organization={organization}
        existingUserIds={existing}
        open={adding}
        onClose={() => setAdding(false)}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Quitar miembro"
        message={
          <>
            <strong>{removing?.user_detail.email}</strong> perderá el acceso que obtiene a través de{" "}
            <strong>{organization.name}</strong>.
          </>
        }
        confirmLabel="Quitar"
        loading={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => toast.success("Miembro removido", removing.user_detail.email),
            onError: (e) => toast.error("No se pudo quitar al miembro", errorMessage(e)),
            onSettled: () => setRemoving(null),
          })
        }
      />
    </Card>
  );
}

export function OrganizationDetailPage() {
  const { id = "" } = useParams();
  const me = useAuthenticatedUser();
  const isAdmin = me.role === "ADMIN";
  const org = useOrganization(id);
  const setActive = useSetOrganizationActive();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);

  if (org.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (org.isError) {
    const notFound = "status" in org.error && org.error.status === 404;
    return (
      <Card>
        <ErrorState
          title={notFound ? "Organización no encontrada" : "No se pudo cargar la organización"}
          message={notFound ? "No existe o no tienes acceso a ella." : org.error.message}
          onRetry={notFound ? undefined : () => void org.refetch()}
        />
      </Card>
    );
  }

  const o = org.data;
  return (
    <>
      <Link to="/admin/organizations" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Organizaciones
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {o.name}
            <Badge tone={o.is_active ? "success" : "neutral"} dot>
              {o.is_active ? "Activa" : "Inactiva"}
            </Badge>
          </span>
        }
        description={<span className="font-mono">{o.slug}</span>}
        actions={
          isAdmin && (
            <>
              <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Editar
              </Button>
              <Button
                variant={o.is_active ? "danger" : "primary"}
                icon={o.is_active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                onClick={() => setToggling(true)}
              >
                {o.is_active ? "Desactivar" : "Activar"}
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit">
          <CardHeader title="Detalles" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted">Descripción</dt>
                <dd className="mt-0.5 whitespace-pre-line text-fg">{o.description || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Contacto</dt>
                <dd className="mt-0.5 text-fg">{o.contact_email || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Miembros</dt>
                <dd className="mt-0.5 text-fg">{o.member_count}</dd>
              </div>
              <div>
                <dt className="text-muted">Creada</dt>
                <dd className="mt-0.5 text-fg">{formatDateTime(o.created_at)}</dd>
              </div>
              <div>
                <dt className="text-muted">Última actualización</dt>
                <dd className="mt-0.5 text-fg">{formatDateTime(o.updated_at)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        {isAdmin ? (
          <MembersCard organization={o} />
        ) : (
          <Card>
            <EmptyState
              icon={<Building2 className="size-5" />}
              title="Gestión de miembros restringida"
              description="Solo los administradores pueden consultar y modificar las membresías."
            />
          </Card>
        )}
      </div>

      <OrganizationFormDialog open={editing} organization={o} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={toggling}
        title={o.is_active ? "Desactivar organización" : "Activar organización"}
        message={
          o.is_active
            ? "Sus miembros dejarán de tener acceso a los recursos compartidos con esta organización. El historial se conserva."
            : "Sus miembros recuperarán el acceso a los recursos compartidos."
        }
        tone={o.is_active ? "danger" : "primary"}
        confirmLabel={o.is_active ? "Desactivar" : "Activar"}
        loading={setActive.isPending}
        onCancel={() => setToggling(false)}
        onConfirm={() =>
          setActive.mutate(
            { id: o.id, active: !o.is_active },
            {
              onSuccess: (r) => toast.success(r.is_active ? "Organización activada" : "Organización desactivada"),
              onError: (e) => toast.error("No se pudo completar la acción", errorMessage(e)),
              onSettled: () => setToggling(false),
            },
          )
        }
      />
    </>
  );
}
