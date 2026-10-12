import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { applyApiErrors } from "@/utils/forms";

import type { Organization } from "../api";
import { useCreateOrganization, useUpdateOrganization } from "../hooks";
import { organizationSchema, type OrganizationValues } from "../schemas";

interface Props {
  open: boolean;
  onClose: () => void;
  /** When provided, the dialog edits this organization. */
  organization?: Organization;
  onCreated?: (org: Organization) => void;
}

export function OrganizationFormDialog(props: Props) {
  if (!props.open) return null;
  return <OrganizationForm key={props.organization?.id ?? "new"} {...props} />;
}

function OrganizationForm({ onClose, organization, onCreated }: Props) {
  const create = useCreateOrganization();
  const update = useUpdateOrganization();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const editing = Boolean(organization);
  const busy = create.isPending || update.isPending;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<OrganizationValues>({
    resolver: zodResolver(organizationSchema),
    defaultValues: {
      name: organization?.name ?? "",
      description: organization?.description ?? "",
      contact_email: organization?.contact_email ?? "",
    },
  });

  const onError = (e: unknown) =>
    setFormError(applyApiErrors(e, setError, ["name", "description", "contact_email"]));

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    if (organization) {
      update.mutate(
        { id: organization.id, payload: values },
        {
          onSuccess: () => {
            toast.success("Organización actualizada");
            onClose();
          },
          onError,
        },
      );
    } else {
      create.mutate(values, {
        onSuccess: (org) => {
          toast.success("Organización creada", org.name);
          onClose();
          onCreated?.(org);
        },
        onError,
      });
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={editing ? "Editar organización" : "Nueva organización"}
      description={editing ? organization?.slug : "Representa a un cliente, empresa o equipo."}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="organization-form" loading={busy} disabled={editing && !isDirty}>
            {editing ? "Guardar cambios" : "Crear organización"}
          </Button>
        </>
      }
    >
      <form id="organization-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Nombre" required error={errors.name?.message}>
          {({ id, invalid }) => <Input id={id} invalid={invalid} data-autofocus {...register("name")} />}
        </Field>
        <Field label="Correo de contacto" error={errors.contact_email?.message}>
          {({ id, invalid }) => <Input id={id} type="email" invalid={invalid} {...register("contact_email")} />}
        </Field>
        <Field label="Descripción" error={errors.description?.message}>
          {({ id, invalid }) => <Textarea id={id} invalid={invalid} rows={3} {...register("description")} />}
        </Field>
      </form>
    </Modal>
  );
}
