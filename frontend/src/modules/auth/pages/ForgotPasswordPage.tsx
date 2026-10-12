import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Mail } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, Input } from "@/components/ui/Field";
import { AuthLayout } from "@/layouts/AuthLayout";
import { errorMessage } from "@/utils/forms";

import { authApi } from "../api";
import { forgotPasswordSchema, type ForgotPasswordValues } from "../schemas";

export function ForgotPasswordPage() {
  const request = useMutation({ mutationFn: authApi.requestPasswordReset });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  return (
    <AuthLayout
      variant="admin"
      title="Recuperar contraseña"
      subtitle="Te enviaremos un enlace para restablecerla."
    >
      {request.isSuccess ? (
        <div className="space-y-6">
          <div className="flex gap-3 rounded-lg border border-border bg-surface p-4">
            <Mail className="mt-0.5 size-5 text-accent" />
            <p className="text-sm text-muted">{request.data.detail} El enlace expira en 1 hora.</p>
          </div>
          <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
            <ArrowLeft className="size-4" /> Volver a iniciar sesión
          </Link>
        </div>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={handleSubmit((values) => request.mutate(values))}
        >
          {request.isError && <Alert>{errorMessage(request.error)}</Alert>}
          <Field label="Correo electrónico" error={errors.email?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                autoFocus
                aria-describedby={describedBy}
                invalid={invalid}
                {...register("email")}
              />
            )}
          </Field>
          <Button type="submit" size="lg" className="w-full justify-center" loading={request.isPending}>
            Enviar enlace
          </Button>
          <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Volver
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
