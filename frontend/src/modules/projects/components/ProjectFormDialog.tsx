import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import { useUsers } from "@/modules/users/hooks";
import { applyApiErrors } from "@/utils/forms";

import type { Project } from "../api";
import { EDITABLE_STATUS_OPTIONS } from "../constants";
import { useCreateProject, useTechnologies, useUpdateProject } from "../hooks";
import { projectSchema, type ProjectValues } from "../schemas";
import { TechnologyInput } from "./TechnologyInput";

interface Props {
  open: boolean;
  onClose: () => void;
  project?: Project;
  onCreated?: (project: Project) => void;
}

const FIELDS = [
  "name",
  "owner",
  "status",
  "description",
  "repository_url",
  "documentation_url",
  "site_url",
  "technologies",
] as const;

export function ProjectFormDialog(props: Props) {
  if (!props.open) return null;
  return <ProjectForm key={props.project?.id ?? "new"} {...props} />;
}

function ProjectForm({ onClose, project, onCreated }: Props) {
  const me = useAuthenticatedUser();
  const isAdmin = me.role === "ADMIN";
  const editing = Boolean(project);
  const create = useCreateProject();
  const update = useUpdateProject();
  const toast = useToast();
  const technologies = useTechnologies();
  const staff = useUsers({ roles: "ADMIN,DEVELOPER", is_active: true, page_size: 100 }, isAdmin);
  const [formError, setFormError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<ProjectValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: project?.name ?? "",
      owner: project?.owner.id ?? (isAdmin ? me.id : ""),
      status: project && project.status !== "ARCHIVED" ? project.status : "PLANNING",
      description: project?.description ?? "",
      repository_url: project?.repository_url ?? "",
      documentation_url: project?.documentation_url ?? "",
      site_url: project?.site_url ?? "",
      technologies: project?.technologies ?? [],
    },
  });

  const onError = (e: unknown) => setFormError(applyApiErrors(e, setError, FIELDS));

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    if (project) {
      update.mutate(
        { id: project.id, payload: values },
        {
          onSuccess: () => {
            toast.success("Proyecto actualizado");
            onClose();
          },
          onError,
        },
      );
    } else {
      create.mutate(values, {
        onSuccess: (created) => {
          toast.success("Proyecto creado", created.name);
          onClose();
          onCreated?.(created);
        },
        onError,
      });
    }
  });

  // The current owner may not be in the active staff list (e.g. deactivated); keep it selectable.
  const ownerOptions = (staff.data?.results ?? []).map((u) => ({ id: u.id, label: `${u.full_name} — ${u.email}` }));
  if (project && !ownerOptions.some((o) => o.id === project.owner.id)) {
    ownerOptions.unshift({ id: project.owner.id, label: `${project.owner.full_name} — ${project.owner.email}` });
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      size="lg"
      title={editing ? "Editar proyecto" : "Nuevo proyecto"}
      description={editing ? project?.slug : "Registra una aplicación independiente para administrarla en DevHub."}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="project-form" loading={busy} disabled={editing && !isDirty}>
            {editing ? "Guardar cambios" : "Crear proyecto"}
          </Button>
        </>
      }
    >
      <form id="project-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nombre"
            required
            error={errors.name?.message}
            hint={!isAdmin ? "Solo un administrador puede cambiar el nombre." : undefined}
          >
            {({ id, invalid, describedBy }) => (
              <Input id={id} invalid={invalid} aria-describedby={describedBy} disabled={!isAdmin} data-autofocus {...register("name")} />
            )}
          </Field>
          <Field label="Estado" required error={errors.status?.message}>
            {({ id, invalid }) => (
              <Select id={id} invalid={invalid} {...register("status")}>
                {EDITABLE_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Responsable" required error={errors.owner?.message}>
          {({ id, invalid }) =>
            isAdmin ? (
              <Select id={id} invalid={invalid} disabled={staff.isPending} {...register("owner")}>
                <option value="">{staff.isPending ? "Cargando…" : "Selecciona un responsable"}</option>
                {ownerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={id} value={project ? `${project.owner.full_name} — ${project.owner.email}` : ""} disabled readOnly />
            )
          }
        </Field>
        <Field label="Descripción" error={errors.description?.message}>
          {({ id, invalid }) => <Textarea id={id} invalid={invalid} rows={3} {...register("description")} />}
        </Field>
        <Field
          label="URL del sitio"
          error={errors.site_url?.message}
          hint="Dirección pública donde ya está desplegada la aplicación. Déjala vacía si aún no se despliega."
        >
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              invalid={invalid}
              aria-describedby={describedBy}
              placeholder="https://mi-app.ejemplo.com"
              {...register("site_url")}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Repositorio Git" error={errors.repository_url?.message}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} placeholder="https://github.com/org/repo" {...register("repository_url")} />
            )}
          </Field>
          <Field label="Documentación" error={errors.documentation_url?.message}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} placeholder="https://docs…" {...register("documentation_url")} />
            )}
          </Field>
        </div>
        <Field
          label="Tecnologías"
          error={errors.technologies?.message ?? errors.technologies?.[0]?.message}
          hint="Presiona Enter o coma para agregar."
        >
          {({ id, invalid, describedBy }) => (
            <Controller
              control={control}
              name="technologies"
              render={({ field }) => (
                <TechnologyInput
                  id={id}
                  invalid={invalid}
                  describedBy={describedBy}
                  value={field.value}
                  onChange={field.onChange}
                  suggestions={technologies.data}
                />
              )}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
