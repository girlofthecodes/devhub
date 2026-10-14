import { AppWindow, ArrowLeft, Building2, CirclePlay, ExternalLink, FileText, Megaphone, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton, Spinner } from "@/components/ui/Feedback";
import { Pagination, SearchInput } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";
import { ProjectLogo } from "@/modules/projects/components/ProjectLogo";
import { ApiError } from "@/services/http";
import { formatDate, formatDay } from "@/utils/format";
import { errorMessage } from "@/utils/forms";
import { displayUrl } from "@/utils/urls";

import { portalApi } from "./api";
import { AvailabilityBadge, DemoButton, PortalAppCard, ReleaseNotes } from "./components";
import { usePortalApp, usePortalApps, usePortalContracts, usePortalReleases } from "./hooks";

const PAGE_SIZE = 12;

function AppsGrid({ demosOnly }: { demosOnly: boolean }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search);
  const apps = usePortalApps({ search: debounced || undefined, has_demo: demosOnly || undefined, page, page_size: PAGE_SIZE });
  return (
    <>
      <SearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Buscar aplicación…"
        className="mb-4 max-w-md"
      />
      {apps.isError ? (
        <Card>
          <ErrorState message={apps.error.message} onRetry={() => void apps.refetch()} />
        </Card>
      ) : apps.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : apps.data.results.length === 0 ? (
        <Card>
          <EmptyState
            icon={demosOnly ? <CirclePlay className="size-5" /> : <AppWindow className="size-5" />}
            title={debounced ? "Sin coincidencias" : demosOnly ? "No hay demostraciones disponibles" : "Aún no tienes aplicaciones asignadas"}
            description={debounced ? "Prueba con otro término." : "Cuando el equipo comparta una aplicación con tu organización, aparecerá aquí."}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {apps.data.results.map((app) => (
              <PortalAppCard key={app.id} app={app} />
            ))}
          </div>
          {apps.data.count > PAGE_SIZE && (
            <Card className="mt-4">
              <Pagination page={page} pageSize={PAGE_SIZE} count={apps.data.count} onPageChange={setPage} />
            </Card>
          )}
        </>
      )}
    </>
  );
}

export function PortalAppsPage() {
  return (
    <>
      <PageHeader title="Mis aplicaciones" description="Aplicaciones que tu organización tiene autorizadas." />
      <AppsGrid demosOnly={false} />
    </>
  );
}

export function PortalDemosPage() {
  return (
    <>
      <PageHeader
        title="Demostraciones"
        description="Cada demo se abre con un acceso temporal y de un solo uso emitido para tu cuenta."
      />
      <AppsGrid demosOnly />
    </>
  );
}

export function PortalContractsPage() {
  const contracts = usePortalContracts();
  return (
    <>
      <PageHeader
        title="Mis contratos"
        description="Aplicaciones contratadas por tu organización, su modalidad, vigencia y próximo vencimiento."
      />
      {contracts.isError ? (
        <Card>
          <ErrorState message={contracts.error.message} onRetry={() => void contracts.refetch()} />
        </Card>
      ) : contracts.isPending ? (
        <Skeleton className="h-40" />
      ) : contracts.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="size-5" />}
            title="Sin contratos para mostrar"
            description="Cuando tu proveedor habilite la consulta de un contrato, aparecerá aquí."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {contracts.data.map((c) => (
            <Card key={c.id}>
              <CardBody className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/cliente/apps/${c.project}`} className="font-semibold text-fg hover:underline">
                      {c.project_name}
                    </Link>
                    <p className="text-sm text-muted">{c.organization_name}</p>
                  </div>
                  <Badge tone={c.status === "ACTIVE" ? "success" : c.status === "SUSPENDED" ? "warning" : "neutral"} dot>
                    {c.status_label}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">Modalidad</dt>
                    <dd className="mt-0.5 text-fg">
                      {c.kind_label}
                      {c.billing_period_label && ` · ${c.billing_period_label.toLowerCase()}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Vigencia</dt>
                    <dd className="mt-0.5 text-fg">
                      {formatDay(c.start_date)} – {c.end_date ? formatDay(c.end_date) : "indefinida"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Próximo vencimiento</dt>
                    <dd className="mt-0.5 text-fg">{c.next_due_date ? formatDay(c.next_due_date) : "Sin pagos pendientes"}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function PortalAppDetailPage() {
  const { id = "" } = useParams();
  const app = usePortalApp(id);
  const releases = usePortalReleases(id);

  if (app.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-96" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (app.isError) {
    const notFound = app.error instanceof ApiError && app.error.status === 404;
    return (
      <Card>
        <ErrorState
          title={notFound ? "Aplicación no disponible" : "No se pudo cargar la aplicación"}
          message={notFound ? "No existe o tu organización no tiene acceso a ella." : app.error.message}
          onRetry={notFound ? undefined : () => void app.refetch()}
        />
      </Card>
    );
  }
  const a = app.data;
  return (
    <>
      <Link to="/cliente/apps" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Mis aplicaciones
      </Link>
      <section className="mb-6 flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-surface p-6">
        <ProjectLogo name={a.name} url={a.logo_url} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{a.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <AvailabilityBadge availability={a.availability} />
            {a.published_version ? <Badge tone="accent">Versión {a.published_version}</Badge> : <Badge>Sin versión publicada</Badge>}
            <Badge>{a.status_label}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.site_url && (
            <a
              href={a.site_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2"
            >
              <ExternalLink className="size-4" /> Abrir aplicación
            </a>
          )}
          {a.has_demo && <DemoButton appId={a.id} />}
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Acerca de la aplicación" />
            <CardBody>
              <p className="whitespace-pre-line text-sm text-fg">{a.description || <span className="italic text-muted">Sin descripción.</span>}</p>
              {a.technologies.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {a.technologies.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Historial de versiones" description="Notas de versión compartidas con tu organización." />
            <CardBody>
              {releases.isError ? (
                <ErrorState message={releases.error.message} onRetry={() => void releases.refetch()} />
              ) : releases.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : releases.data.length === 0 ? (
                <EmptyState icon={<Megaphone className="size-5" />} title="Aún no hay versiones publicadas" />
              ) : (
                <ReleaseNotes releases={releases.data} />
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Tu acceso" />
            <CardBody>
              <ul className="space-y-3 text-sm">
                {a.access.map((g) => (
                  <li key={g.organization} className="flex items-start gap-2">
                    <Building2 className="mt-0.5 size-4 text-muted" />
                    <span>
                      <span className="font-medium text-fg">{g.organization}</span>
                      <span className="block text-xs text-muted">{g.expires_at ? `Vigente hasta ${formatDate(g.expires_at)}` : "Sin fecha de expiración"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          {a.site_url && (
            <Card>
              <CardHeader title="Sitio" />
              <CardBody>
                <a href={a.site_url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-accent hover:underline">
                  {displayUrl(a.site_url)}
                </a>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Launch page opened in a new tab by "Abrir demo": requests a one-time ticket and
 * redirects to the demo, which validates it against DevHub.
 */
export function DemoLaunchPage() {
  const { id = "" } = useParams();
  const requested = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (requested.current) return; // StrictMode runs effects twice; issue a single ticket.
    requested.current = true;
    portalApi
      .demoAccess(id)
      .then(({ launch_url }) => window.location.replace(launch_url))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      {error ? (
        <Card>
          <CardBody className="py-10">
            <TriangleAlert className="mx-auto size-8 text-amber-500" />
            <h1 className="mt-3 text-lg font-semibold text-fg">No se pudo abrir la demostración</h1>
            <p className="mt-1 text-sm text-muted">{error}</p>
            <Link to={`/cliente/apps/${id}`} className="mt-5 inline-block text-sm font-medium text-accent hover:underline">
              Volver a la aplicación
            </Link>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="flex flex-col items-center py-10">
            <ShieldCheck className="size-8 text-accent" />
            <h1 className="mt-3 text-lg font-semibold text-fg">Preparando tu acceso seguro</h1>
            <p className="mt-1 text-sm text-muted">Verificamos tu autorización y abrimos la demostración.</p>
            <Spinner className="mt-5" label="Redirigiendo…" />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
