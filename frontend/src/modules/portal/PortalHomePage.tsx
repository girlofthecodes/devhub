import { AppWindow, Building2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Feedback";
import { useAuthenticatedUser } from "@/modules/auth/hooks";

export function PortalHomePage() {
  const user = useAuthenticatedUser();
  const orgNames = user.organizations.map((o) => o.name);
  return (
    <>
      <section className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-surface px-6 py-8 sm:px-10">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-accent opacity-10 blur-3xl" />
        <p className="text-sm font-medium text-accent">Portal de clientes</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          Hola, {user.first_name || user.full_name}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          {orgNames.length > 0
            ? `Consulta las aplicaciones compartidas con ${orgNames.join(", ")}.`
            : "Tu cuenta aún no está asociada a ninguna organización."}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader title="Mis aplicaciones" description="Aplicaciones autorizadas para tu organización." />
          <EmptyState
            icon={<AppWindow className="size-5" />}
            title="Aún no tienes aplicaciones asignadas"
            description="Cuando el equipo comparta una aplicación con tu organización, aparecerá aquí con su estado y su acceso a demostración."
          />
        </Card>
        <Card className="h-fit">
          <CardHeader title="Mis organizaciones" />
          {user.organizations.length === 0 ? (
            <EmptyState
              icon={<Building2 className="size-5" />}
              title="Sin organización"
              description="Contacta a tu administrador para obtener acceso."
            />
          ) : (
            <ul className="divide-y divide-border">
              {user.organizations.map((org) => (
                <li key={org.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="font-medium text-fg">{org.name}</span>
                  <Badge tone="accent">{org.membership_role === "OWNER" ? "Responsable" : "Miembro"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
