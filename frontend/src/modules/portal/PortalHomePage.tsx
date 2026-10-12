import { AppWindow, ArrowRight, CirclePlay, ExternalLink, Megaphone } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import { ProjectLogo } from "@/modules/projects/components/ProjectLogo";
import { displayUrl } from "@/utils/urls";

import { PortalAppCard, ReleaseNotes } from "./components";
import { usePortalApps, usePortalSummary, usePortfolio } from "./hooks";

function Hero({ name, subtitle }: { name: string; subtitle: string }) {
  return (
    <section className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-surface px-6 py-8 sm:px-10">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-accent opacity-10 blur-3xl" />
      <p className="text-sm font-medium text-accent">Portal de clientes</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">Hola, {name}</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">{subtitle}</p>
    </section>
  );
}

function Stat({ icon: Icon, label, value, to }: { icon: typeof AppWindow; label: string; value: number | undefined; to: string }) {
  return (
    <Link to={to} className="block">
      <Card className="flex items-center gap-4 p-5 transition-colors hover:border-border-strong">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon className="size-5" />
        </span>
        <div>
          <div className="text-2xl font-semibold tabular-nums text-fg">{value ?? <Skeleton className="h-7 w-8" />}</div>
          <p className="text-sm text-muted">{label}</p>
        </div>
      </Card>
    </Link>
  );
}

function ClientHome() {
  const user = useAuthenticatedUser();
  const summary = usePortalSummary();
  const apps = usePortalApps({ page_size: 3 });
  const orgs = summary.data?.organizations ?? user.organizations.map((o) => o.name);

  return (
    <>
      <Hero
        name={user.first_name || user.full_name}
        subtitle={orgs.length ? `Aplicaciones compartidas con ${orgs.join(", ")}.` : "Tu cuenta aún no está asociada a ninguna organización."}
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Stat icon={AppWindow} label="Aplicaciones disponibles" value={summary.data?.applications} to="/portal/apps" />
        <Stat icon={CirclePlay} label="Demostraciones" value={summary.data?.demos} to="/portal/demos" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="apps-title">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="apps-title" className="text-sm font-semibold text-fg">
              Mis aplicaciones
            </h2>
            <Link to="/portal/apps" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              Ver todas <ArrowRight className="size-4" />
            </Link>
          </div>
          {apps.isError ? (
            <Card>
              <ErrorState message={apps.error.message} onRetry={() => void apps.refetch()} />
            </Card>
          ) : apps.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
            </div>
          ) : apps.data.results.length === 0 ? (
            <Card>
              <EmptyState
                icon={<AppWindow className="size-5" />}
                title="Aún no tienes aplicaciones asignadas"
                description="Cuando el equipo comparta una aplicación con tu organización, aparecerá aquí."
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {apps.data.results.map((app) => (
                <PortalAppCard key={app.id} app={app} />
              ))}
            </div>
          )}
        </section>
        <Card className="h-fit">
          <CardHeader title="Novedades" description="Últimas versiones publicadas." />
          <CardBody>
            {summary.isError ? (
              <ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} />
            ) : summary.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : summary.data.recent_releases.length === 0 ? (
              <EmptyState icon={<Megaphone className="size-5" />} title="Sin novedades todavía" />
            ) : (
              <ReleaseNotes releases={summary.data.recent_releases} showProject />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

/** Visitors only see the public portfolio. */
function VisitorHome() {
  const user = useAuthenticatedUser();
  const portfolio = usePortfolio();
  return (
    <>
      <Hero name={user.first_name || user.full_name} subtitle="Conoce algunas de las aplicaciones que desarrollamos." />
      {portfolio.isError ? (
        <Card>
          <ErrorState title="El portafolio no está disponible" message={portfolio.error.message} />
        </Card>
      ) : portfolio.isPending ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : portfolio.data.length === 0 ? (
        <Card>
          <EmptyState icon={<AppWindow className="size-5" />} title="Aún no hay proyectos públicos" />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {portfolio.data.map((p) => (
            <Card key={p.slug} className="p-5">
              <div className="flex items-center gap-3">
                <ProjectLogo name={p.name} url={p.logo_url} />
                <h3 className="font-semibold text-fg">{p.name}</h3>
              </div>
              <p className="mt-3 text-sm text-muted">{p.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.technologies.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
              {p.site_url && (
                <a href={p.site_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  {displayUrl(p.site_url)} <ExternalLink className="size-3.5" />
                </a>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function PortalHomePage() {
  const user = useAuthenticatedUser();
  return user.role === "VISITOR" ? <VisitorHome /> : <ClientHome />;
}
