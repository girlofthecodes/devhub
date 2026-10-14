import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/Toast";
import { deploymentsApi } from "@/modules/deployments/api";
import { ReleasesCard } from "@/modules/projects/components/ReleasesCard";
import { releasesApi, type Release } from "@/modules/projects/releases";
import { ApiError } from "@/services/http";
import { makeUser, renderPage, renderRoutes } from "@/test/utils";
import type { Paginated } from "@/types/api";

import { portalApi, type PortalApp, type PortalAppDetail } from "./api";
import { DemoLaunchPage, PortalAppDetailPage } from "./pages";
import { PortalHomePage } from "./PortalHomePage";

vi.mock("./api", async (orig) => {
  const o = await orig<typeof import("./api")>();
  const f = () => vi.fn();
  return { ...o, portalApi: { summary: f(), apps: f(), app: f(), releases: f(), demoAccess: f(), portfolio: f() } };
});
vi.mock("@/modules/projects/releases", async (orig) => {
  const o = await orig<typeof import("@/modules/projects/releases")>();
  const f = () => vi.fn();
  return { ...o, releasesApi: { list: f(), create: f(), update: f(), publish: f(), withdraw: f() } };
});
vi.mock("@/modules/deployments/api", async (orig) => {
  const o = await orig<typeof import("@/modules/deployments/api")>();
  return { ...o, deploymentsApi: { ...o.deploymentsApi, list: vi.fn() } };
});

const api = vi.mocked(portalApi);
const rel = vi.mocked(releasesApi);
const client = makeUser({ role: "CLIENT", role_label: "Cliente", first_name: "Carla", organizations: [{ id: "o", name: "Acme", slug: "acme", membership_role: "OWNER" }] });
const page = <T,>(results: T[]): Paginated<T> => ({ count: results.length, next: null, previous: null, results });

const app: PortalApp = {
  id: "p-1",
  name: "Portal de Pedidos",
  slug: "portal-de-pedidos",
  description: "Gestiona tus pedidos.",
  logo_url: null,
  status: "AVAILABLE",
  status_label: "Disponible",
  technologies: ["React"],
  site_url: "https://pedidos.example.com",
  published_version: "v1.7.0",
  published_at: "2026-10-12T10:00:00Z",
  has_demo: true,
  availability: { status: "UNKNOWN", label: "Sin monitoreo", checked_at: null },
};
const detail: PortalAppDetail = { ...app, access: [{ organization: "Acme", expires_at: "2026-12-31T23:59:59Z" }] };
const release = {
  id: "r-1",
  project: "p-1",
  project_name: "Portal de Pedidos",
  version: "v1.7.0",
  title: "Pagos",
  notes: "Nuevo pago con tarjeta.\n<b>no es HTML</b>",
  published_at: "2026-10-12T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.summary.mockResolvedValue({ applications: 1, demos: 1, organizations: ["Acme"], recent_releases: [release] });
  api.apps.mockResolvedValue(page([app]));
  api.app.mockResolvedValue(detail);
  api.releases.mockResolvedValue([release]);
});

describe("PortalHomePage", () => {
  it("shows the client dashboard with real counts, apps and news", async () => {
    renderPage(<PortalHomePage />, "/cliente", { user: client });
    expect(await screen.findByText("Hola, Carla")).toBeInTheDocument();
    expect(await screen.findByText("Aplicaciones compartidas con Acme.")).toBeInTheDocument();
    expect(screen.getByText("Aplicaciones disponibles").previousElementSibling).toHaveTextContent("1");
    expect(await screen.findByRole("link", { name: /Portal de Pedidos/ })).toBeInTheDocument();
    expect(screen.getByText("Sin monitoreo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir demo" })).toHaveAttribute("href", "/cliente/apps/p-1/demo");
  });

  it("shows only the public portfolio to visitors", async () => {
    api.portfolio.mockResolvedValue([
      { name: "Público", slug: "publico", description: "Visible para todos", logo_url: null, technologies: ["Vue"], site_url: "" },
    ]);
    renderPage(<PortalHomePage />, "/cliente", { user: makeUser({ role: "VISITOR" }) });
    expect(await screen.findByText("Visible para todos")).toBeInTheDocument();
    expect(api.summary).not.toHaveBeenCalled();
    expect(api.apps).not.toHaveBeenCalled();
  });
});

describe("PortalAppDetailPage", () => {
  const renderDetail = () =>
    renderRoutes([{ path: "/cliente/apps/:id", element: <PortalAppDetailPage /> }], "/cliente/apps/p-1", { user: client });

  it("shows functional info, version, access and release notes as plain text", async () => {
    renderDetail();
    expect(await screen.findByRole("heading", { name: "Portal de Pedidos" })).toBeInTheDocument();
    expect(screen.getByText("Gestiona tus pedidos.")).toBeInTheDocument();
    expect(screen.getByText("Versión v1.7.0")).toBeInTheDocument();
    expect(screen.getByText(/Vigente hasta/)).toBeInTheDocument();
    const demo = screen.getByRole("link", { name: "Abrir demo" });
    expect(demo).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: /Abrir aplicación/ })).toHaveAttribute("href", "https://pedidos.example.com");
    const notes = await screen.findByText(/Nuevo pago con tarjeta/);
    expect(notes).toHaveTextContent("<b>no es HTML</b>");
    expect(notes.querySelector("b")).toBeNull();
  });

  it("shows a not-available message for apps outside the client's access", async () => {
    api.app.mockRejectedValue(new ApiError(404, { code: "not_found", detail: "No encontrado." }));
    renderDetail();
    expect(await screen.findByText("Aplicación no disponible")).toBeInTheDocument();
  });
});

describe("DemoLaunchPage", () => {
  function renderLaunch() {
    const qc = new QueryClient();
    const router = createMemoryRouter([{ path: "/cliente/apps/:id/demo", element: <DemoLaunchPage /> }], {
      initialEntries: ["/cliente/apps/p-1/demo"],
    });
    return render(
      <StrictMode>
        <QueryClientProvider client={qc}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  }

  it("requests exactly one ticket and redirects to the demo", async () => {
    const replace = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { value: { ...original, replace }, configurable: true });
    api.demoAccess.mockResolvedValue({ launch_url: "https://demo.example.com/?devhub_demo_token=abc", expires_at: "" });
    try {
      renderLaunch();
      expect(screen.getByText("Preparando tu acceso seguro")).toBeInTheDocument();
      await waitFor(() => expect(replace).toHaveBeenCalledWith("https://demo.example.com/?devhub_demo_token=abc"));
      expect(api.demoAccess).toHaveBeenCalledTimes(1); // StrictMode must not issue two tickets
    } finally {
      Object.defineProperty(window, "location", { value: original, configurable: true });
    }
  });

  it("explains why the demo cannot be opened", async () => {
    api.demoAccess.mockRejectedValue(new ApiError(400, { code: "demo_unavailable", detail: "Esta aplicación no tiene una demostración disponible." }));
    renderLaunch();
    expect(await screen.findByText("No se pudo abrir la demostración")).toBeInTheDocument();
    expect(screen.getByText("Esta aplicación no tiene una demostración disponible.")).toBeInTheDocument();
  });
});

describe("ReleasesCard (admin)", () => {
  const draft: Release = {
    id: "r-9", project: "p-1", project_name: "Portal de Pedidos", version: "v1.8.0", title: "", notes: "Notas",
    status: "DRAFT", status_label: "Borrador", published_at: null, deployment: null, deployment_label: null,
    created_by_email: "", can_edit: true, created_at: "2026-10-12T10:00:00Z", updated_at: "",
  };

  beforeEach(() => {
    rel.list.mockResolvedValue(page([draft]));
    vi.mocked(deploymentsApi.list).mockResolvedValue(page([]));
  });

  it("publishes a draft only after confirmation", async () => {
    rel.publish.mockResolvedValue({ ...draft, status: "PUBLISHED" });
    const user = userEvent.setup();
    renderPage(<ReleasesCard project={{ id: "p-1", is_archived: false }} canEdit />, "/", { user: makeUser() });
    await user.click(await screen.findByRole("button", { name: "Publicar" }));
    expect(rel.publish).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Publicar para clientes" });
    await user.click(within(dialog).getByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(rel.publish).toHaveBeenCalledWith("r-9"));
  });

  it("creates a draft with validation", async () => {
    rel.create.mockResolvedValue(draft);
    const user = userEvent.setup();
    renderPage(<ReleasesCard project={{ id: "p-1", is_archived: false }} canEdit />, "/", { user: makeUser() });
    await user.click(await screen.findByRole("button", { name: "Nueva versión" }));
    const dialog = screen.getByRole("dialog", { name: "Nueva versión para clientes" });
    await user.type(within(dialog).getByLabelText(/Versión/), "v 2");
    await user.click(within(dialog).getByRole("button", { name: "Crear borrador" }));
    expect(await within(dialog).findByText(/Usa letras, números/)).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText(/Versión/));
    await user.type(within(dialog).getByLabelText(/Versión/), "v2.0.0");
    await user.type(within(dialog).getByLabelText(/Notas de versión/), "Novedades");
    await user.click(within(dialog).getByRole("button", { name: "Crear borrador" }));
    await waitFor(() =>
      expect(rel.create).toHaveBeenCalledWith("p-1", { version: "v2.0.0", title: "", notes: "Novedades", deployment: null }),
    );
  });

  it("is read-only without permission", async () => {
    renderPage(<ReleasesCard project={{ id: "p-1", is_archived: false }} canEdit={false} />, "/", { user: makeUser() });
    expect(await screen.findByText("v1.8.0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nueva versión" })).not.toBeInTheDocument();
  });
});
