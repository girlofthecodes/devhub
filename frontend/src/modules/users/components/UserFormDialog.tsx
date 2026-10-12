import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, Input, PasswordInput, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { applyApiErrors } from "@/utils/forms";

import { ROLE_OPTIONS, type User } from "../api";
import { useCreateUser, useUpdateUser } from "../hooks";
import {
  userCreateSchema,
  userUpdateSchema,
  type UserCreateValues,
  type UserUpdateValues,
} from "../schemas";

function RoleSelect(props: React.ComponentProps<typeof Select>) {
  return (
    <Select {...props}>
      {ROLE_OPTIONS.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label} — {r.description}
        </option>
      ))}
    </Select>
  );
}

const FORM_ID = "user-form";

export function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateUser();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<UserCreateValues>({
    resolver: zodResolver(userCreateSchema),
    defaultValues: { email: "", first_name: "", last_name: "", role: "CLIENT", password: "" },
  });

  function close() {
    reset();
    setFormError(null);
    onClose();
  }

  const onSubmit = handleSubmit(({ password, ...values }) => {
    setFormError(null);
    create.mutate(password ? { ...values, password } : values, {
      onSuccess: (user) => {
        toast.success("Usuario creado", user.email);
        close();
      },
      onError: (e) =>
        setFormError(
          applyApiErrors(e, setError, ["email", "first_name", "last_name", "role", "password"]),
        ),
    });
  });

  return (
    <Modal
      open={open}
      onClose={close}
      title="Nuevo usuario"
      description="El usuario podrá iniciar sesión según su rol."
      busy={create.isPending}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form={FORM_ID} loading={create.isPending}>
            Crear usuario
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Correo electrónico" required error={errors.email?.message}>
          {({ id, invalid }) => <Input id={id} type="email" invalid={invalid} data-autofocus {...register("email")} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" error={errors.first_name?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} {...register("first_name")} />}
          </Field>
          <Field label="Apellidos" error={errors.last_name?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} {...register("last_name")} />}
          </Field>
        </div>
        <Field label="Rol" required error={errors.role?.message}>
          {({ id, invalid }) => <RoleSelect id={id} invalid={invalid} {...register("role")} />}
        </Field>
        <Field
          label="Contraseña inicial"
          error={errors.password?.message}
          hint="Opcional. Si la dejas vacía, el usuario deberá usar «¿Olvidaste tu contraseña?»."
        >
          {({ id, invalid, describedBy }) => (
            <PasswordInput
              id={id}
              invalid={invalid}
              aria-describedby={describedBy}
              autoComplete="new-password"
              {...register("password")}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

export function EditUserDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  return user ? <EditUserForm key={user.id} user={user} onClose={onClose} /> : null;
}

function EditUserForm({ user, onClose }: { user: User; onClose: () => void }) {
  const update = useUpdateUser();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<UserUpdateValues>({
    resolver: zodResolver(userUpdateSchema),
    defaultValues: {
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role ?? "CLIENT",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    update.mutate(
      { id: user.id, payload: values },
      {
        onSuccess: () => {
          toast.success("Usuario actualizado", user.email);
          onClose();
        },
        onError: (e) =>
          setFormError(applyApiErrors(e, setError, ["first_name", "last_name", "role"])),
      },
    );
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Editar usuario"
      description={user.email}
      busy={update.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form={FORM_ID} loading={update.isPending} disabled={!isDirty}>
            Guardar cambios
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" error={errors.first_name?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} data-autofocus {...register("first_name")} />}
          </Field>
          <Field label="Apellidos" error={errors.last_name?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} {...register("last_name")} />}
          </Field>
        </div>
        <Field label="Rol" required error={errors.role?.message} hint="El cambio de rol queda registrado en auditoría.">
          {({ id, invalid, describedBy }) => (
            <RoleSelect id={id} invalid={invalid} aria-describedby={describedBy} {...register("role")} />
          )}
        </Field>
      </form>
    </Modal>
  );
}
