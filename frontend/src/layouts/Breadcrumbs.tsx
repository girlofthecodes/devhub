import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { Link, useMatches } from "react-router";

export interface RouteHandle {
  crumb?: string;
}

export function Breadcrumbs() {
  const crumbs = useMatches()
    .filter((m) => (m.handle as RouteHandle | undefined)?.crumb)
    .map((m) => ({ label: (m.handle as RouteHandle).crumb as string, to: m.pathname }));

  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Ruta de navegación" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={crumb.to + crumb.label}>
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted/60" aria-hidden />}
              <li className="min-w-0 truncate">
                {last ? (
                  <span aria-current="page" className="font-medium text-fg">
                    {crumb.label}
                  </span>
                ) : (
                  <Link to={crumb.to} className="text-muted hover:text-fg">
                    {crumb.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
