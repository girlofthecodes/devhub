import { KeyRound, Pencil, Plus, Power, PowerOff, Users } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Modal";
import { DataTable, Pagination, SearchInput, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { useDebounce } from "@/hooks/useDebounce";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import type { Role } from "@/types/api";
import { formatRelative } from "@/utils/format";
import { errorMessage } from "@/utils/forms";

import { ROLE_OPTIONS, roleTone, type User } from "../api";
import { CreateUserDialog, EditUserDialog } from "../components/UserFormDialog";
import { useRevokeSessions, useSetUserActive, useUsers } from "../hooks";

const PAGE_SIZE = 20;

type PendingAction = { kind: "toggle" | "revoke"; user: User } | null;

export function UsersPage() {
  const me = useAuthenticatedUser();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [status, setStatus] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const debouncedSearch = useDebounce(search);

  const params = {
    page,
    page_size: PAGE_SIZE,
    search: debouncedSearch || undefined,
    role: role || undefined,
    is_active: status === "" ? undefined : status === "true",
  };
  const users = useUsers(params);
  const setActive = useSetUserActive();
  const revoke = useRevokeSessions();

  function resetPage<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function confirmPending() {
    if (!pending) return;
    const { user, kind } = pending;
    const done = { onSettled: () => setPending(null) };
    if (kind === "toggle") {
      setActive.mutate(
        { id: user.id, active: !user.is_active },
        {
          ...done,
          onSuccess: (u) => toast.success(u.is_active ? "Usuario activado" : "Usuario desactivado", u.email),
          onError: (e) => toast.error("No se pudo completar la acción", errorMessage(e)),
        },
      );
    } else {
      revoke.mutate(user.id, {
        ...done,
        onSuccess: (r) => toast.success(r.detail, user.email),
        onError: (e) => toast.error("No se pudieron revocar las sesiones", errorMessage(e)),
      });
    }
  }

  const columns: Column<User>[] = [
    {
      key: "user",
      header: "Usuario",
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.full_name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{u.full_name}</p>
            <p className="truncate text-xs text-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Rol",
      cell: (u) => (u.role ? <Badge tone={roleTone[u.role]}>{u.role_label}</Badge> : "—"),
    },
    {
      key: "status",
      header: "Estado",
      cell: (u) => (
        <Badge tone={u.is_active ? "success" : "neutral"} dot>
          {u.is_active ? "Activo" : "Inactivo"}
        </Badge>
      ),
    },
    {
      key: "last_login",
      header: "Último acceso",
      hideOnMobile: true,
      cell: (u) => <span className="text-muted">{formatRelative(u.last_login)}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (u) => {
        const self = u.id === me.id;
        return (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="size-8" title="Editar" aria-label={`Editar ${u.email}`} onClick={() => setEditing(u)}>
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title="Cerrar sesiones activas"
              aria-label={`Cerrar sesiones de ${u.email}`}
              onClick={() => setPending({ kind: "revoke", user: u })}
            >
              <KeyRound className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={self}
              title={self ? "No puedes desactivar tu propia cuenta" : u.is_active ? "Desactivar" : "Activar"}
              aria-label={`${u.is_active ? "Desactivar" : "Activar"} ${u.email}`}
              onClick={() => setPending({ kind: "toggle", user: u })}
            >
              {u.is_active ? <PowerOff className="size-4 text-red-500" /> : <Power className="size-4 text-emerald-500" />}
            </Button>
          </div>
        );
      },
    },
  ];

  const hasFilters = Boolean(debouncedSearch || role || status);

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Cuentas del equipo interno y de clientes. Las cuentas no se eliminan: se desactivan."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nuevo usuario
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <SearchInput
            value={search}
            onChange={resetPage(setSearch)}
            placeholder="Buscar por nombre o correo…"
            className="flex-1"
          />
          <Select
            value={role}
            onChange={(e) => resetPage(setRole)(e.target.value as Role | "")}
            aria-label="Filtrar por rol"
            className="sm:w-44"
          >
            <option value="">Todos los roles</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(e) => resetPage(setStatus)(e.target.value as "" | "true" | "false")}
            aria-label="Filtrar por estado"
            className="sm:w-40"
          >
            <option value="">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </Select>
        </div>
        <DataTable
          caption="Usuarios"
          columns={columns}
          rows={users.data?.results}
          rowKey={(u) => u.id}
          loading={users.isPending}
          error={users.error}
          onRetry={() => void users.refetch()}
          empty={
            <EmptyState
              icon={<Users className="size-5" />}
              title={hasFilters ? "Sin coincidencias" : "Aún no hay usuarios"}
              description={hasFilters ? "Prueba con otros filtros." : "Crea el primer usuario para comenzar."}
            />
          }
        />
        {users.data && users.data.count > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} count={users.data.count} onPageChange={setPage} />
        )}
      </Card>

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === "revoke"
            ? "Cerrar sesiones activas"
            : pending?.user.is_active
              ? "Desactivar usuario"
              : "Activar usuario"
        }
        message={
          pending?.kind === "revoke" ? (
            <>Se cerrarán todas las sesiones de <strong>{pending.user.email}</strong>. Deberá iniciar sesión de nuevo.</>
          ) : pending?.user.is_active ? (
            <>
              <strong>{pending.user.email}</strong> no podrá iniciar sesión y sus sesiones activas se cerrarán
              inmediatamente.
            </>
          ) : (
            <>
              <strong>{pending?.user.email}</strong> podrá volver a iniciar sesión.
            </>
          )
        }
        tone={pending?.kind === "toggle" && !pending.user.is_active ? "primary" : "danger"}
        confirmLabel={
          pending?.kind === "revoke" ? "Cerrar sesiones" : pending?.user.is_active ? "Desactivar" : "Activar"
        }
        loading={setActive.isPending || revoke.isPending}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
