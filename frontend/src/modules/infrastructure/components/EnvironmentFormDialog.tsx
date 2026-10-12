import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useProjects } from "@/modules/projects/hooks";
import { applyApiErrors } from "@/utils/forms";

import type { Environment, EnvironmentKind } from "../api";
import { ENVIRONMENT_KINDS, INFRA_STATUS_OPTIONS } from "../constants";
import { useEnvironments, useSaveEnvironment, useServers } from "../hooks";
import { environmentSchema, type EnvironmentValues } from "../schemas";

interface Props {
  open: boolean;
  onClose: () => void;
  environment?: Environment;
  /** Pre-selected project (from the project page). */
  project?: { id: string; name: string };
  /** Pre-selected kind (e.g. "configure Production" slot). */
  kind?: EnvironmentKind;
}

const FIELDS = ["project", "kind", "name", "server", "public_url", "deployed_version", "status"] as const;

export function EnvironmentFormDialog(props: Props) {
  if (!props.open) return null;
  return <EnvironmentForm key={props.environment?.id ?? `${props.project?.id}-${props.kind}`} {...props} />;
}

function EnvironmentForm({ onClose, environment, project, kind }: Props) {
  const editing = Boolean(environment);
  const save = useSaveEnvironment();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const servers = useServers({ page_size: 100 });
  // Project picker (only when not fixed): projects the user can edit.
  const projects = useProjects({ archived: false, page_size: 100 }, !project && !editing);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<EnvironmentValues>({
    resolver: zodResolver(environmentSchema),
    defaultValues: {
      project: environment?.project ?? project?.id ?? "",
      kind: environment?.kind ?? kind ?? "DEMO",
      name: environment?.name ?? "",
      server: environment?.server ?? "",
      public_url: environment?.public_url ?? "",
      deployed_version: environment?.deployed_version ?? "",
      status: environment?.status ?? "ACTIVE",
    },
  });
  const selectedProject = useWatch({ control, name: "project" });
  const selectedKind = useWatch({ control, name: "kind" });
  const existing = useEnvironments({ project: selectedProject, page_size: 10 }, !editing && Boolean(selectedProject));
  const takenKinds = new Set((existing.data?.results ?? []).map((e) => e.kind));

  const serverOptions = (servers.data?.results ?? []).filter(
    (s) => s.status !== "INACTIVE" || s.id === environment?.server,
  );
  const editableProjects = (projects.data?.results ?? []).filter((p) => p.permissions.can_edit);

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    save.mutate(
      { id: environment?.id, payload: { ...values, server: values.server || null } },
      {
        onSuccess: (saved) => {
          toast.success(editing ? "Entorno actualizado" : "Entorno creado", `${saved.project_name} · ${saved.display_name}`);
          onClose();
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, FIELDS)),
      },
    );
  });

  const projectName = environment?.project_name ?? project?.name;

  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      title={editing ? `Editar entorno ${environment?.kind_label}` : "Nuevo entorno"}
      description={projectName ? `Proyecto: ${projectName}` : "Asocia un proyecto con un servidor y su URL pública."}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="environment-form" loading={save.isPending} disabled={editing && !isDirty}>
            {editing ? "Guardar cambios" : "Crear entorno"}
          </Button>
        </>
      }
    >
      <form id="environment-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          {!project && !editing && (
            <Field label="Proyecto" required error={errors.project?.message} className="sm:col-span-2">
              {({ id, invalid }) => (
                <Select id={id} invalid={invalid} disabled={projects.isPending} {...register("project")}>
                  <option value="">{projects.isPending ? "Cargando…" : "Selecciona un proyecto"}</option>
                  {editableProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field
            label="Tipo"
            required
            error={errors.kind?.message}
            hint={editing ? "El tipo no se puede cambiar." : undefined}
          >
            {({ id, invalid, describedBy }) => (
              <Select id={id} invalid={invalid} aria-describedby={describedBy} disabled={editing} {...register("kind")}>
                {ENVIRONMENT_KINDS.map((k) => (
                  <option key={k.value} value={k.value} disabled={!editing && takenKinds.has(k.value)}>
                    {k.label}
                    {!editing && takenKinds.has(k.value) ? " (ya existe)" : ""}
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
          <Field label="Servidor" error={errors.server?.message}>
            {({ id, invalid }) => (
              <Select id={id} invalid={invalid} disabled={servers.isPending} {...register("server")}>
                <option value="">Sin asignar</option>
                {serverOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.identifier}){s.status !== "ACTIVE" ? ` · ${s.status_label}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Nombre visible" error={errors.name?.message} hint="Opcional; por defecto el tipo.">
            {({ id, invalid, describedBy }) => <Input id={id} invalid={invalid} aria-describedby={describedBy} {...register("name")} />}
          </Field>
        </div>
        <Field
          label="URL pública"
          error={errors.public_url?.message}
          hint={
            selectedKind === "PRODUCTION"
              ? "https:// con dominio público. Si la URL del sitio del proyecto está vacía o coincide con la anterior, se actualizará también."
              : "https:// con dominio público (no IPs ni nombres internos)."
          }
        >
          {({ id, invalid, describedBy }) => (
            <Input id={id} invalid={invalid} aria-describedby={describedBy} placeholder="https://demo.mi-app.com" {...register("public_url")} />
          )}
        </Field>
        <Field
          label="Versión desplegada"
          error={errors.deployed_version?.message}
          hint="Registro manual; en la Fase 4 se actualizará con cada despliegue."
        >
          {({ id, invalid, describedBy }) => (
            <Input id={id} invalid={invalid} aria-describedby={describedBy} className="font-mono" placeholder="v1.0.0" {...register("deployed_version")} />
          )}
        </Field>
      </form>
    </Modal>
  );
}
