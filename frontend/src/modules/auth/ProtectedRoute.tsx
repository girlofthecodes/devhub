import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { ErrorState, FullPageSpinner } from "@/components/ui/Feedback";
import type { Role } from "@/types/api";

import { useCurrentUser } from "./hooks";
import { homePathFor } from "./types";

interface ProtectedRouteProps {
  roles: readonly Role[];
  loginPath: string;
  children: ReactNode;
}

/**
 * Client-side guard for UX only. Every API endpoint enforces its own authorization;
 * hiding a screen here never replaces backend checks.
 */
export function ProtectedRoute({ roles, loginPath, children }: ProtectedRouteProps) {
  const location = useLocation();
  const { data: user, isPending, isError, error, refetch } = useCurrentUser();

  if (isPending) return <FullPageSpinner />;
  if (isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (!user) {
    return <Navigate to={loginPath} replace state={{ from: location.pathname + location.search }} />;
  }
  if (!user.role || !roles.includes(user.role)) {
    const home = homePathFor(user.role);
    return home === location.pathname ? (
      <ErrorState title="Acceso no autorizado" message="Tu cuenta no tiene un rol asignado." />
    ) : (
      <Navigate to={home} replace />
    );
  }
  return <>{children}</>;
}

/** Hides UI fragments from users without the required role (UX only). */
export function RequireRole({
  roles,
  children,
  fallback = null,
}: {
  roles: readonly Role[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { data: user } = useCurrentUser();
  if (!user?.role || !roles.includes(user.role)) return <>{fallback}</>;
  return <>{children}</>;
}
