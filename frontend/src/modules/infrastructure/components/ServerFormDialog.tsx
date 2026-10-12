import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { applyApiErrors } from "@/utils/forms";

import type { Server } from "../api";
import { INFRA_STATUS_OPTIONS, SERVER_TYPES } from "../constants";
import { useSaveServer } from "../hooks";
import { serverSchema, type ServerValues } from "../schemas";

interface Props {
  open: boolean;
  onClose: () => void;
  server?: Server;
  onSaved?: (server: Server) => void;
}

const FIELDS = ["name", "identifier", "location", "server_type", "operating_system", "vpn_address", "status", "notes"] as const;

export function ServerFormDialog(props: Props) {
  if (!props.open) return null;
  return <ServerForm key={props.server?.id ?? "new"} {...props} />;
}

function ServerForm({ onClose, server, onSaved }: Props) {
  const save = useSaveServer();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const editing = Boolean(server);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<ServerValues>({
    resolver: zodResolver(serverSchema),
    defaultValues: {
      name: server?.name ?? "",
      identifier: server?.identifier ?? "",
      location: server?.location ?? "",
      server_type: server?.server_type ?? "APPLICATION",
      operating_system: server?.operating_system ?? "",
      vpn_address: server?.vpn_address ?? "",
      status: server?.status ?? "ACTIVE",
      notes: server?.notes ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    save.mutate(
      { id: server?.id, payload: { ...values, vpn_address: values.vpn_address || null } },
      {
        onSuccess: (saved) => {
          toast.success(editing ? "Servidor actualizado" : "Servidor registrado", saved.name);
          onClose();
          onSaved?.(saved);
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, FIELDS)),
      },
    );
  });

  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      title={editing ? "Editar servidor" : "Registrar servidor"}
      description="Inventario y metadatos. DevHub no almacena contraseñas ni llaves SSH."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="server-form" loading={save.isPending} disabled={editing && !isDirty}>
            {editing ? "Guardar cambios" : "Registrar servidor"}
          </Button>
        </>
      }
    >
      <form id="server-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" required error={errors.name?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} placeholder="Servidor A — Aplicaciones" data-autofocus {...register("name")} />}
          </Field>
          <Field label="Identificador" required error={errors.identifier?.message} hint="Único, p. ej. homelab-app-01.">
            {({ id, invalid, describedBy }) => (
              <Input id={id} invalid={invalid} aria-describedby={describedBy} className="font-mono" {...register("identifier")} />
            )}
          </Field>
          <Field label="Tipo" required error={errors.server_type?.message}>
            {({ id, invalid }) => (
              <Select id={id} invalid={invalid} {...register("server_type")}>
                {SERVER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Estado" required error={errors.status?.message}>
            {({ id, invalid }) => (
              <Select id={id} invalid={invalid} {...register("status")}>
                {INFRA_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Ubicación lógica" error={errors.location?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} placeholder="Casa · red principal" {...register("location")} />}
          </Field>
          <Field label="Sistema operativo" error={errors.operating_system?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} placeholder="Ubuntu Server 24.04 LTS" {...register("operating_system")} />}
          </Field>
        </div>
        <Field
          label="Dirección VPN"
          error={errors.vpn_address?.message}
          hint="Opcional. Solo direcciones privadas (WireGuard/Tailscale o LAN); nunca una IP pública."
        >
          {({ id, invalid, describedBy }) => (
            <Input id={id} invalid={invalid} aria-describedby={describedBy} className="font-mono" placeholder="100.64.0.10" {...register("vpn_address")} />
          )}
        </Field>
        <Field label="Notas" error={errors.notes?.message}>
          {({ id, invalid }) => <Textarea id={id} invalid={invalid} rows={2} {...register("notes")} />}
        </Field>
        <p className="flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          No registres contraseñas, llaves privadas ni cadenas de conexión: los secretos viven en variables de entorno de cada servidor.
        </p>
      </form>
    </Modal>
  );
}
