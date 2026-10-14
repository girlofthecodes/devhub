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
import { ADMIN_LOGIN, CLIENT_LOGIN, homePathFor, type Portal } from "../types";

interface LoginPageProps {
  /** Portal this form logs in to; the server validates it for every account. */
  portal: Portal;
}

export function LoginPage({ portal }: LoginPageProps) {
  const variant = portal === "admin" ? "admin" : "portal";
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
  // A session already open in this same portal goes straight to its home. A session from
  // the other portal stays on this form: logging in here replaces it.
  if (currentUser?.portal === portal) return <Navigate to={homePathFor(currentUser.role)} replace />;
  const otherSession = currentUser && currentUser.portal !== portal;

  const from = (location.state as { from?: string } | null)?.from;

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    login.mutate({ portal, ...values }, {
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
        {otherSession && (
          <Alert tone="info">
            Tienes una sesión abierta en el {portal === "admin" ? "portal de clientes" : "panel administrativo"}. Si
            inicias sesión aquí, esa sesión se cerrará.
          </Alert>
        )}
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
          <Link
            to={portal === "admin" ? "/forgot-password" : "/forgot-password?portal=cliente"}
            className="text-sm font-medium text-accent hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full justify-center" loading={login.isPending}>
          Iniciar sesión
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        {portal === "admin" ? (
          <>
            ¿Eres cliente?{" "}
            <Link to={CLIENT_LOGIN} className="font-medium text-accent hover:underline">
              Ir al portal de clientes
            </Link>
          </>
        ) : (
          <>
            ¿Formas parte del equipo?{" "}
            <Link to={ADMIN_LOGIN} className="font-medium text-accent hover:underline">
              Ir al panel administrativo
            </Link>
          </>
        )}
        <span className="mt-2 block">
          <Link to="/" className="hover:text-fg hover:underline">
            Volver al inicio
          </Link>
        </span>
      </p>
    </AuthLayout>
  );
}
