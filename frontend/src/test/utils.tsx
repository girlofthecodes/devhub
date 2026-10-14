import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";

import { ToastProvider } from "@/components/ui/Toast";
import { meQueryKey } from "@/modules/auth/hooks";
import type { CurrentUser } from "@/modules/auth/types";

export function makeUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "u-1",
    email: "ana@example.com",
    first_name: "Ana",
    last_name: "López",
    full_name: "Ana López",
    role: "ADMIN",
    role_label: "Administrador",
    is_active: true,
    date_joined: "2026-01-01T00:00:00Z",
    last_login: null,
    client_portal_access: false,
    finance_access: "MANAGE",
    organizations: [],
    portal: overrides.role === "CLIENT" || overrides.role === "VISITOR" ? "client" : "admin",
    available_portals: overrides.role === "CLIENT" || overrides.role === "VISITOR" ? ["client"] : ["admin"],
    ...overrides,
  };
}

export function renderRoutes(
  routes: RouteObject[],
  initialPath: string,
  options: { user?: CurrentUser } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (options.user) queryClient.setQueryData(meQueryKey, options.user);
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}

export function renderPage(element: ReactElement, path = "/", options: { user?: CurrentUser } = {}) {
  return renderRoutes([{ path: "*", element }], path, options);
}
