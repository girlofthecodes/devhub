import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, KeyRound } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Field, Input, PasswordInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/utils/format";
import { applyApiErrors } from "@/utils/forms";

import { useAuthenticatedUser, useChangePassword, useUpdateProfile } from "../hooks";
import {
  changePasswordSchema,
  profileSchema,
  type ChangePasswordValues,
  type ProfileValues,
} from "../schemas";

function ProfileForm() {
  const user = useAuthenticatedUser();
  const update = useUpdateProfile();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { first_name: user.first_name, last_name: user.last_name },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    update.mutate(values, {
      onSuccess: (updated) => {
        reset({ first_name: updated.first_name, last_name: updated.last_name });
        toast.success("Perfil actualizado");
      },
      onError: (e) => setFormError(applyApiErrors(e, setError, ["first_name", "last_name"])),
    });
  });

  return (
    <Card>
      <CardHeader title="Información personal" description="Tu nombre visible en DevHub." />
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="space-y-4">
          {formError && <Alert>{formError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" error={errors.first_name?.message}>
              {({ id, invalid }) => <Input id={id} invalid={invalid} autoComplete="given-name" {...register("first_name")} />}
            </Field>
            <Field label="Apellidos" error={errors.last_name?.message}>
              {({ id, invalid }) => <Input id={id} invalid={invalid} autoComplete="family-name" {...register("last_name")} />}
            </Field>
          </div>
          <Field label="Correo electrónico" hint="Solo un administrador puede cambiar el correo.">
            {({ id, describedBy }) => <Input id={id} value={user.email} disabled readOnly aria-describedby={describedBy} />}
          </Field>
        </CardBody>
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button type="submit" loading={update.isPending} disabled={!isDirty}>
            Guardar cambios
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ChangePasswordForm() {
  const change = useChangePassword();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit(({ current_password, new_password }) => {
    setFormError(null);
    change.mutate(
      { current_password, new_password },
      {
        onSuccess: () => {
          reset();
          toast.success("Contraseña actualizada", "Las demás sesiones abiertas fueron cerradas.");
        },
        onError: (e) =>
          setFormError(applyApiErrors(e, setError, ["current_password", "new_password"])),
      },
    );
  });

  return (
    <Card>
      <CardHeader
        title="Cambiar contraseña"
        description="Al cambiarla se cerrarán tus otras sesiones activas."
      />
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="space-y-4">
          {formError && <Alert>{formError}</Alert>}
          <Field label="Contraseña actual" error={errors.current_password?.message}>
            {({ id, invalid }) => (
              <PasswordInput id={id} invalid={invalid} autoComplete="current-password" {...register("current_password")} />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nueva contraseña" error={errors.new_password?.message} hint="Mínimo 10 caracteres.">
              {({ id, invalid, describedBy }) => (
                <PasswordInput
                  id={id}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  autoComplete="new-password"
                  {...register("new_password")}
                />
              )}
            </Field>
            <Field label="Confirmar contraseña" error={errors.confirm_password?.message}>
              {({ id, invalid }) => (
                <PasswordInput id={id} invalid={invalid} autoComplete="new-password" {...register("confirm_password")} />
              )}
            </Field>
          </div>
        </CardBody>
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button type="submit" variant="outline" icon={<KeyRound className="size-4" />} loading={change.isPending}>
            Actualizar contraseña
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ProfilePage() {
  const user = useAuthenticatedUser();
  return (
    <>
      <PageHeader title="Mi perfil" description="Administra tu información y la seguridad de tu cuenta." />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <ProfileForm />
          <ChangePasswordForm />
        </div>
        <div className="space-y-6">
          <Card>
            <CardBody className="flex flex-col items-center py-6 text-center">
              <Avatar name={user.full_name} className="size-16 text-lg" />
              <p className="mt-3 font-semibold text-fg">{user.full_name}</p>
              <p className="text-sm text-muted">{user.email}</p>
              <Badge tone="accent" className="mt-3">
                {user.role_label}
              </Badge>
              <dl className="mt-5 w-full space-y-2 border-t border-border pt-4 text-left text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Miembro desde</dt>
                  <dd className="text-fg">{formatDateTime(user.date_joined)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Último acceso</dt>
                  <dd className="text-fg">{formatDateTime(user.last_login)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Organizaciones" />
            {user.organizations.length === 0 ? (
              <EmptyState
                icon={<Building2 className="size-5" />}
                title="Sin organizaciones"
                description="Un administrador puede asociarte a una organización."
              />
            ) : (
              <ul className="divide-y divide-border">
                {user.organizations.map((org) => (
                  <li key={org.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span className="font-medium text-fg">{org.name}</span>
                    <Badge>{org.membership_role === "OWNER" ? "Responsable" : "Miembro"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
