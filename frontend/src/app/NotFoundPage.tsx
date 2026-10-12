import { Link } from "react-router";

import { useCurrentUser } from "@/modules/auth/hooks";
import { homePathFor } from "@/modules/auth/types";

export function NotFoundPage() {
  const { data: user } = useCurrentUser();
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Página no encontrada</h1>
      <p className="mt-2 text-sm text-muted">La ruta solicitada no existe o fue movida.</p>
      <Link
        to={homePathFor(user?.role)}
        className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
