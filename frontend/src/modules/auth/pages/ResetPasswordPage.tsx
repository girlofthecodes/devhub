import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, PasswordInput } from "@/components/ui/Field";
import { AuthLayout } from "@/layouts/AuthLayout";
import { applyApiErrors } from "@/utils/forms";

import { authApi } from "../api";
import { resetPasswordSchema, type ResetPasswordValues } from "../schemas";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [formError, setFormError] = useState<string | null>(null);
  const confirm = useMutation({ mutationFn: authApi.confirmPasswordReset });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { new_password: "", confirm_password: "" },
  });

  const invalidLink = !uid || !token;

  return (
    <AuthLayout variant="admin" title="Nueva contraseña" subtitle="Define una contraseña segura.">
      {invalidLink ? (
        <Alert>
          El enlace está incompleto.{" "}
          <Link to="/forgot-password" className="font-medium underline">
            Solicita uno nuevo
          </Link>
          .
        </Alert>
      ) : confirm.isSuccess ? (
        <div className="space-y-6">
          <div className="flex gap-3 rounded-lg border border-border bg-surface p-4">
            <CircleCheck className="mt-0.5 size-5 text-emerald-500" />
            <p className="text-sm text-muted">{confirm.data.detail}</p>
          </div>
          <Link to="/" className="text-sm font-medium text-accent hover:underline">
            Elegir portal e iniciar sesión
          </Link>
        </div>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={handleSubmit((values) => {
            setFormError(null);
            confirm.mutate(
              { uid, token, new_password: values.new_password },
              { onError: (e) => setFormError(applyApiErrors(e, setError, ["new_password"])) },
            );
          })}
        >
          {formError && (
            <Alert>
              {formError}{" "}
              <Link to="/forgot-password" className="font-medium underline">
                Solicitar otro enlace
              </Link>
            </Alert>
          )}
          <Field
            label="Nueva contraseña"
            error={errors.new_password?.message}
            hint="Mínimo 10 caracteres; evita contraseñas comunes."
          >
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                aria-describedby={describedBy}
                invalid={invalid}
                {...register("new_password")}
              />
            )}
          </Field>
          <Field label="Confirmar contraseña" error={errors.confirm_password?.message}>
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                aria-describedby={describedBy}
                invalid={invalid}
                {...register("confirm_password")}
              />
            )}
          </Field>
          <Button type="submit" size="lg" className="w-full justify-center" loading={confirm.isPending}>
            Restablecer contraseña
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
