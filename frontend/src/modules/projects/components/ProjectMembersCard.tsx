import { Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Field, Select } from "@/components/ui/Field";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { PickerList } from "@/components/ui/PickerList";
import { DataTable, SearchInput, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { useDebounce } from "@/hooks/useDebounce";
import { useUsers } from "@/modules/users/hooks";
import { errorMessage } from "@/utils/forms";

import type { Project, ProjectMember, ProjectMemberRole } from "../api";
import { MEMBER_ROLE_LABEL } from "../constants";
import {
  useAddProjectMember,
  useProjectMembers,
  useRemoveProjectMember,
  useUpdateProjectMember,
} from "../hooks";

const ROLES = Object.keys(MEMBER_ROLE_LABEL) as ProjectMemberRole[];

function AssignDeveloperDialog({
  project,
  assigned,
  open,
  onClose,
}: {
  project: Project;
  assigned: Set<string>;
  open: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [role, setRole] = useState<ProjectMemberRole>("CONTRIBUTOR");
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounce(search);
  const users = useUsers(
    { roles: "ADMIN,DEVELOPER", is_active: true, search: debounced || undefined, page_size: 20 },
    open,
  );
  const add = useAddProjectMember();
  const toast = useToast();

  function close() {
    setSearch("");
    setSelected(null);
    setRole("CONTRIBUTOR");
    setError(null);
    onClose();
  }

  const items = (users.data?.results ?? [])
    .filter((u) => !assigned.has(u.id))
    .map((u) => ({
      id: u.id,
      title: u.full_name,
      subtitle: u.email,
      leading: <Avatar name={u.full_name} />,
      trailing: <Badge>{u.role_label}</Badge>,
    }));

  return (
    <Modal
      open={open}
      onClose={close}
      busy={add.isPending}
      title="Asignar desarrollador"
      description={`Agrega a un miembro del equipo a ${project.name}.`}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={add.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!selected}
            loading={add.isPending}
            onClick={() =>
              selected &&
              add.mutate(
                { project: project.id, user: selected, role },
                {
                  onSuccess: (m) => {
                    toast.success("Desarrollador asignado", m.user_detail.email);
                    close();
                  },
                  onError: (e) => setError(errorMessage(e)),
                },
              )
            }
          >
            Asignar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre o correo…" />
        <PickerList
          label="Miembros del equipo disponibles"
          items={items}
          selected={selected}
          onSelect={setSelected}
          loading={users.isPending}
          error={users.error}
          emptyText="No hay desarrolladores disponibles con ese criterio."
        />
        <Field label="Rol en el proyecto" hint="Los mantenedores pueden editar los datos técnicos del proyecto.">
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={role} onChange={(e) => setRole(e.target.value as ProjectMemberRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {MEMBER_ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

export function ProjectMembersCard({ project }: { project: Project }) {
  const members = useProjectMembers(project.id);
  const update = useUpdateProjectMember();
  const remove = useRemoveProjectMember();
  const toast = useToast();
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState<ProjectMember | null>(null);
  const canManage = project.permissions.can_manage && !project.is_archived;

  const assigned = new Set((members.data?.results ?? []).map((m) => m.user));

  const columns: Column<ProjectMember>[] = [
    {
      key: "user",
      header: "Desarrollador",
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
      cell: (m) =>
        canManage ? (
          <Select
            value={m.role}
            className="h-8 w-36"
            aria-label={`Rol de ${m.user_detail.email}`}
            disabled={update.isPending}
            onChange={(e) =>
              update.mutate(
                { id: m.id, role: e.target.value as ProjectMemberRole },
                {
                  onSuccess: () => toast.success("Rol actualizado", m.user_detail.email),
                  onError: (err) => toast.error("No se pudo actualizar", errorMessage(err)),
                },
              )
            }
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {MEMBER_ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={m.role === "MAINTAINER" ? "accent" : "neutral"}>{MEMBER_ROLE_LABEL[m.role]}</Badge>
        ),
    },
  ];
  if (canManage) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (m) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="Quitar del proyecto"
          aria-label={`Quitar a ${m.user_detail.email}`}
          onClick={() => setRemoving(m)}
        >
          <Trash2 className="size-4 text-red-500" />
        </Button>
      ),
    });
  }

  return (
    <Card>
      <CardHeader
        title="Desarrolladores asignados"
        description={`Responsable: ${project.owner.full_name}`}
        actions={
          canManage && (
            <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setAssigning(true)}>
              Asignar
            </Button>
          )
        }
      />
      <DataTable
        caption="Desarrolladores asignados"
        columns={columns}
        rows={members.data?.results}
        rowKey={(m) => m.id}
        loading={members.isPending}
        error={members.error}
        onRetry={() => void members.refetch()}
        empty={<EmptyState icon={<Users className="size-5" />} title="Sin desarrolladores asignados" />}
      />
      {canManage && (
        <AssignDeveloperDialog project={project} assigned={assigned} open={assigning} onClose={() => setAssigning(false)} />
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Quitar del proyecto"
        message={
          <>
            <strong>{removing?.user_detail.email}</strong> dejará de ver este proyecto (salvo que sea su responsable).
          </>
        }
        confirmLabel="Quitar"
        loading={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => toast.success("Desarrollador removido", removing.user_detail.email),
            onError: (e) => toast.error("No se pudo quitar", errorMessage(e)),
            onSettled: () => setRemoving(null),
          })
        }
      />
    </Card>
  );
}
