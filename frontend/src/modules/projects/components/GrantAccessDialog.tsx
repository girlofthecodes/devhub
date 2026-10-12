import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, FolderKanban } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { PickerList } from "@/components/ui/PickerList";
import { SearchInput } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { useDebounce } from "@/hooks/useDebounce";
import { useOrganizations } from "@/modules/organizations/hooks";
import { applyApiErrors } from "@/utils/forms";

import { endOfDayIso } from "../constants";
import { useGrantAccess, useProjects } from "../hooks";
import { grantSchema, type GrantValues } from "../schemas";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fix one side of the grant: from a project page pass the project, from an organization page the organization. */
  fixed: { project: { id: string; name: string } } | { organization: { id: string; name: string } };
  /** IDs already holding a current grant (hidden from the picker). */
  excludeIds: Set<string>;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function GrantAccessDialog(props: Props) {
  if (!props.open) return null;
  return <GrantAccessForm {...props} />;
}

function GrantAccessForm({ onClose, fixed, excludeIds }: Props) {
  const pickOrganization = "project" in fixed;
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search);
  const [formError, setFormError] = useState<string | null>(null);
  const grant = useGrantAccess();
  const toast = useToast();
  const orgs = useOrganizations({ is_active: true, search: debounced || undefined, page_size: 20 });
  const projects = useProjects({ archived: false, search: debounced || undefined, page_size: 20 }, !pickOrganization);

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<GrantValues>({
    resolver: zodResolver(grantSchema),
    defaultValues: {
      project: "project" in fixed ? fixed.project.id : "",
      organization: "organization" in fixed ? fixed.organization.id : "",
      expires_on: "",
      notes: "",
    },
  });

  const source = pickOrganization ? orgs : projects;
  const items = pickOrganization
    ? (orgs.data?.results ?? [])
        .filter((o) => !excludeIds.has(o.id))
        .map((o) => ({ id: o.id, title: o.name, subtitle: `${o.member_count} miembro(s)`, leading: <Building2 className="size-4 text-muted" /> }))
    : (projects.data?.results ?? [])
        .filter((p) => !excludeIds.has(p.id))
        .map((p) => ({ id: p.id, title: p.name, subtitle: p.status_label, leading: <FolderKanban className="size-4 text-muted" /> }));

  const onSubmit = handleSubmit(({ project, organization, expires_on, notes }) => {
    setFormError(null);
    grant.mutate(
      { project, organization, notes, expires_at: endOfDayIso(expires_on) },
      {
        onSuccess: (g) => {
          toast.success("Acceso concedido", `${g.organization_name} → ${g.project_name}`);
          onClose();
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, ["project", "organization", "notes"])),
      },
    );
  });

  const target = "project" in fixed ? fixed.project.name : fixed.organization.name;

  return (
    <Modal
      open
      onClose={onClose}
      busy={grant.isPending}
      title="Conceder acceso"
      description={
        pickOrganization
          ? `Selecciona la organización que podrá ver ${target} en el portal.`
          : `Selecciona el proyecto que ${target} podrá ver en el portal.`
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={grant.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="grant-form" loading={grant.isPending}>
            Conceder acceso
          </Button>
        </>
      }
    >
      <form id="grant-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={pickOrganization ? "Buscar organización…" : "Buscar proyecto…"}
        />
        <Controller
          control={control}
          name={pickOrganization ? "organization" : "project"}
          render={({ field }) => (
            <PickerList
              label={pickOrganization ? "Organizaciones activas" : "Proyectos"}
              items={items}
              selected={field.value || null}
              onSelect={field.onChange}
              loading={source.isPending}
              error={source.error}
              emptyText={pickOrganization ? "No hay organizaciones disponibles." : "No hay proyectos disponibles."}
            />
          )}
        />
        {(errors.organization || errors.project) && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {errors.organization?.message ?? errors.project?.message}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expira el" error={errors.expires_on?.message} hint="Opcional. Vacío = sin expiración.">
            {({ id, invalid, describedBy }) => (
              <Input id={id} type="date" min={today()} invalid={invalid} aria-describedby={describedBy} {...register("expires_on")} />
            )}
          </Field>
          <Field label="Notas" error={errors.notes?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} placeholder="Contrato, demo…" {...register("notes")} />}
          </Field>
        </div>
      </form>
    </Modal>
  );
}
