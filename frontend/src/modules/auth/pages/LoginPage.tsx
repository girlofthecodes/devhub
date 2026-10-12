import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Alert, FullPageSpinner } from "@/components/ui/Feedback";
import { Field, Input, PasswordInput } from "@/components/ui/Field";
import { AuthLayout } from "@/layouts/AuthLayout";
import { applyApiErrors } from "@/utils/forms";

import { useCurrentUser, useLogin } from "../hooks";
import { loginSchema, type LoginValues } from "../schemas";
import { homePathFor } from "../types";

interface LoginPageProps {
  variant: "admin" | "portal";
}

export function LoginPage({ variant }: LoginPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: currentUser, isPending } = useCurrentUser();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  if (isPending) return <FullPageSpinner />;
  if (currentUser) return <Navigate to={homePathFor(currentUser.role)} replace />;

  const from = (location.state as { from?: string } | null)?.from;

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    login.mutate(values, {
      onSuccess: (user) => {
        const home = homePathFor(user.role);
        // Only honor the redirect target if it belongs to the user's own area.
        navigate(from && from.startsWith(home) ? from : home, { replace: true });
      },
      onError: (error) => setFormError(applyApiErrors(error, setError, ["email", "password"])),
    });
  });

  return (
    <AuthLayout
      variant={variant}
      title={variant === "admin" ? "Iniciar sesión" : "Bienvenido a tu portal"}
      subtitle={
        variant === "admin"
          ? "Accede al panel de administración de DevHub."
          : "Inicia sesión para consultar tus aplicaciones."
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
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
        <Field label="Contraseña" error={errors.password?.message}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="current-password"
              aria-describedby={describedBy}
              invalid={invalid}
              {...register("password")}
            />
          )}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-accent hover:underline">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full justify-center" loading={login.isPending}>
          Iniciar sesión
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        {variant === "admin" ? (
          <>
            ¿Eres cliente?{" "}
            <Link to="/portal/login" className="font-medium text-accent hover:underline">
              Ir al portal de clientes
            </Link>
          </>
        ) : (
          <>
            ¿Formas parte del equipo?{" "}
            <Link to="/login" className="font-medium text-accent hover:underline">
              Ir al panel administrativo
            </Link>
          </>
        )}
      </p>
    </AuthLayout>
  );
}
