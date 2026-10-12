import { useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert, Skeleton } from "@/components/ui/Feedback";
import { Field, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { SearchInput } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { useDebounce } from "@/hooks/useDebounce";
import { useUsers } from "@/modules/users/hooks";
import { cn } from "@/utils/cn";
import { errorMessage } from "@/utils/forms";

import { MEMBERSHIP_ROLE_LABEL, type MembershipRole, type Organization } from "../api";
import { useAddMember } from "../hooks";

interface Props {
  organization: Organization;
  existingUserIds: Set<string>;
  open: boolean;
  onClose: () => void;
}

export function AddMemberDialog({ organization, existingUserIds, open, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [role, setRole] = useState<MembershipRole>("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounce(search);
  const users = useUsers({ search: debounced || undefined, is_active: true, page_size: 8 }, open);
  const add = useAddMember();
  const toast = useToast();

  const candidates = (users.data?.results ?? []).filter(
    (u) => !existingUserIds.has(u.id) && u.role !== "VISITOR",
  );

  function close() {
    setSearch("");
    setSelected(null);
    setRole("MEMBER");
    setError(null);
    onClose();
  }

  function submit() {
    if (!selected) {
      setError("Selecciona un usuario.");
      return;
    }
    setError(null);
    add.mutate(
      { organization: organization.id, user: selected, role },
      {
        onSuccess: (m) => {
          toast.success("Miembro agregado", m.user_detail.email);
          close();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      busy={add.isPending}
      title="Agregar miembro"
      description={`Asociar un usuario activo a ${organization.name}.`}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={add.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={add.isPending} disabled={!selected}>
            Agregar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar usuario por nombre o correo…" />
        <div role="radiogroup" aria-label="Usuarios disponibles" className="max-h-64 space-y-1 overflow-y-auto">
          {users.isPending ? (
            Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)
          ) : users.isError ? (
            <Alert>{errorMessage(users.error)}</Alert>
          ) : candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No hay usuarios disponibles con ese criterio.</p>
          ) : (
            candidates.map((u) => (
              <button
                key={u.id}
                type="button"
                role="radio"
                aria-checked={selected === u.id}
                onClick={() => setSelected(u.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                  selected === u.id ? "border-accent bg-accent-soft" : "border-transparent hover:bg-surface-2",
                )}
              >
                <Avatar name={u.full_name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{u.full_name}</span>
                  <span className="block truncate text-xs text-muted">{u.email}</span>
                </span>
                <Badge>{u.role_label}</Badge>
              </button>
            ))
          )}
        </div>
        <Field label="Rol en la organización">
          {({ id }) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value as MembershipRole)}>
              {(Object.keys(MEMBERSHIP_ROLE_LABEL) as MembershipRole[]).map((r) => (
                <option key={r} value={r}>
                  {MEMBERSHIP_ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}
