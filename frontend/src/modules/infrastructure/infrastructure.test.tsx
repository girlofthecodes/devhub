import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/services/http";
import { makeUser, renderPage, renderRoutes } from "@/test/utils";
import type { Paginated } from "@/types/api";
import { publicUrlError } from "@/utils/urls";

import { infrastructureApi, type Environment, type InfrastructureSummary, type Server } from "./api";
import { ProjectEnvironmentsCard } from "./components/ProjectEnvironmentsCard";
import { EnvironmentsPage } from "./pages/EnvironmentsPage";
import { InfrastructurePage } from "./pages/InfrastructurePage";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    infrastructureApi: {
      summary: vi.fn(),
      listServers: vi.fn(),
      getServer: vi.fn(),
      createServer: vi.fn(),
      updateServer: vi.fn(),
      listEnvironments: vi.fn(),
      createEnvironment: vi.fn(),
      updateEnvironment: vi.fn(),
    },
  };
});
const api = vi.mocked(infrastructureApi);

const admin = makeUser({ role: "ADMIN" });
const developer = makeUser({ id: "dev-1", role: "DEVELOPER", role_label: "Desarrollador" });

const page = <T,>(results: T[]): Paginated<T> => ({ count: results.length, next: null, previous: null, results });

const server: Server = {
  id: "s-1",
  name: "Servidor A",
  identifier: "homelab-app-01",
  location: "Casa",
  server_type: "APPLICATION",
  server_type_label: "Aplicaciones",
  operating_system: "Ubuntu 24.04",
  vpn_address: "100.64.0.10",
  status: "ACTIVE",
  status_label: "Activo",
  notes: "",
  last_checked_at: null,
  environment_count: 2,
  active_environment_count: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const summary: InfrastructureSummary = {
  servers: { total: 2, by_status: { ACTIVE: 1, MAINTENANCE: 1, INACTIVE: 0 }, by_type: { APPLICATION: 1, DATABASE: 1, MIXED: 0, OTHER: 0 } },
  environments: {
    total: 3,
    by_status: { ACTIVE: 2, MAINTENANCE: 0, INACTIVE: 1 },
    by_kind: { DEVELOPMENT: 0, DEMO: 2, PRODUCTION: 1 },
    without_server: 1,
  },
};

function makeEnv(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "e-1",
    project: "p-1",
    project_name: "Portal de Pedidos",
    project_slug: "portal-de-pedidos",
    kind: "PRODUCTION",
    kind_label: "Production",
    name: "",
    display_name: "Production",
    server: "s-1",
    server_detail: { id: "s-1", name: "Servidor A", identifier: "homelab-app-01", status: "ACTIVE" },
    public_url: "https://pedidos.example.com",
    deployed_version: "v1.2.0",
    status: "ACTIVE",
    status_label: "Activo",
    can_edit: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.summary.mockResolvedValue(summary);
  api.listServers.mockResolvedValue(page([server]));
  api.listEnvironments.mockResolvedValue(page([]));
});

describe("publicUrlError", () => {
  it.each([
    ["http://app.example.com", "https"],
    ["https://192.168.1.10", "IP"],
    ["https://localhost:8000", "público"],
    ["https://db.local", "público"],
    ["https://intranet", "público"],
    ["https://u:p@app.example.com", "credenciales"],
  ])("rejects %s", (url, fragment) => {
    expect(publicUrlError(url)).toContain(fragment);
  });

  it("accepts public https domains and empty values", () => {
    expect(publicUrlError("https://demo.girlofthecodes.dev/app")).toBeNull();
    expect(publicUrlError("")).toBeNull();
  });
});

describe("InfrastructurePage", () => {
  it("shows real summary KPIs and server cards", async () => {
    renderPage(<InfrastructurePage />, "/", { user: admin });
    expect(await screen.findByText("Servidor A")).toBeInTheDocument();
    expect(screen.getByText("homelab-app-01")).toBeInTheDocument();
    expect(screen.getByText("1/2 entornos")).toBeInTheDocument();
    // Never invents a health check: monitoring arrives in Fase 6.
    expect(screen.getByText("Sin verificar")).toBeInTheDocument();
    expect(screen.getByText("2 registrados · 1 en mantenimiento")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar servidor" })).toBeInTheDocument();
  });

  it("is read-only for developers", async () => {
    renderPage(<InfrastructurePage />, "/", { user: developer });
    expect(await screen.findByText("Servidor A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar servidor" })).not.toBeInTheDocument();
  });

  it("validates the server form (no public VPN IPs)", async () => {
    api.listServers.mockResolvedValue(page([]));
    api.createServer.mockResolvedValue(server);
    const user = userEvent.setup();
    const { router } = renderRoutes(
      [
        { path: "/admin/infrastructure", element: <InfrastructurePage /> },
        { path: "/admin/infrastructure/servers/:id", element: <p>Ficha</p> },
      ],
      "/admin/infrastructure",
      { user: admin },
    );
    await user.click((await screen.findAllByRole("button", { name: "Registrar servidor" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Registrar servidor" });
    await user.type(within(dialog).getByLabelText(/^Nombre/), "Servidor A");
    await user.type(within(dialog).getByLabelText(/Identificador/), "Home Lab");
    await user.type(within(dialog).getByLabelText("Dirección VPN"), "8.8.8.8");
    await user.click(within(dialog).getByRole("button", { name: "Registrar servidor" }));
    expect(await within(dialog).findByText(/nunca pública/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Usa minúsculas/)).toBeInTheDocument();
    expect(api.createServer).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText(/Identificador/));
    await user.type(within(dialog).getByLabelText(/Identificador/), "homelab-app-01");
    await user.clear(within(dialog).getByLabelText("Dirección VPN"));
    await user.type(within(dialog).getByLabelText("Dirección VPN"), "100.64.0.10");
    await user.click(within(dialog).getByRole("button", { name: "Registrar servidor" }));
    await waitFor(() => expect(api.createServer).toHaveBeenCalled());
    expect(api.createServer.mock.calls[0][0]).toMatchObject({
      name: "Servidor A",
      identifier: "homelab-app-01",
      vpn_address: "100.64.0.10",
      status: "ACTIVE",
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/infrastructure/servers/s-1"));
  }, 20_000);

  it("shows an error state", async () => {
    api.listServers.mockRejectedValue(new ApiError(500, { code: "server_error", detail: "Error interno del servidor." }));
    renderPage(<InfrastructurePage />, "/", { user: admin });
    expect(await screen.findByText("Error interno del servidor.")).toBeInTheDocument();
  });
});

describe("ProjectEnvironmentsCard", () => {
  const project = { id: "p-1", name: "Portal de Pedidos", is_archived: false };

  it("lists configured slots and offers to configure missing ones", async () => {
    api.listEnvironments.mockResolvedValue(page([makeEnv()]));
    renderPage(<ProjectEnvironmentsCard project={project} canEdit />, "/", { user: admin });
    expect(await screen.findByRole("link", { name: /pedidos\.example\.com/ })).toHaveAttribute("href", "https://pedidos.example.com");
    expect(screen.getByText("v1.2.0")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Configurar" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Editar entorno Production" })).toBeInTheDocument();
  });

  it("creates a missing environment with a pre-selected kind", async () => {
    api.listEnvironments.mockResolvedValue(page([makeEnv()]));
    api.createEnvironment.mockResolvedValue(makeEnv({ id: "e-2", kind: "DEMO", display_name: "Demo" }));
    const user = userEvent.setup();
    renderPage(<ProjectEnvironmentsCard project={project} canEdit />, "/", { user: admin });
    await user.click((await screen.findAllByRole("button", { name: "Configurar" }))[1]); // Demo slot
    const dialog = await screen.findByRole("dialog", { name: "Nuevo entorno" });
    await user.type(within(dialog).getByLabelText("URL pública"), "https://10.0.0.1");
    await user.click(within(dialog).getByRole("button", { name: "Crear entorno" }));
    expect(await within(dialog).findByText("Usa un nombre de dominio, no una dirección IP.")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("URL pública"));
    await user.type(within(dialog).getByLabelText("URL pública"), "https://demo.example.com");
    await user.click(within(dialog).getByRole("button", { name: "Crear entorno" }));
    await waitFor(() => expect(api.createEnvironment).toHaveBeenCalled());
    expect(api.createEnvironment.mock.calls[0][0]).toEqual({
      project: "p-1",
      kind: "DEMO",
      name: "",
      server: null,
      public_url: "https://demo.example.com",
      deployed_version: "",
      status: "ACTIVE",
    });
  });

  it("is read-only without edit permission", async () => {
    api.listEnvironments.mockResolvedValue(page([makeEnv()]));
    renderPage(<ProjectEnvironmentsCard project={project} canEdit={false} />, "/", { user: developer });
    expect(await screen.findByText("v1.2.0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Configurar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar entorno/ })).not.toBeInTheDocument();
  });
});

describe("EnvironmentsPage", () => {
  it("lists environments with links and filters by kind", async () => {
    api.listEnvironments.mockResolvedValue(page([makeEnv(), makeEnv({ id: "e-2", can_edit: false, kind: "DEMO", display_name: "Demo" })]));
    const user = userEvent.setup();
    renderPage(<EnvironmentsPage />, "/", { user: developer });
    expect(await screen.findAllByText("Portal de Pedidos")).toHaveLength(2);
    // Only rows the user may edit get an edit action.
    expect(screen.getAllByRole("button", { name: /^Editar Portal de Pedidos/ })).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText("Filtrar por tipo"), "PRODUCTION");
    await waitFor(() =>
      expect(api.listEnvironments).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "PRODUCTION", page: 1 })),
    );
  });

  it("shows the empty state", async () => {
    renderPage(<EnvironmentsPage />, "/", { user: admin });
    expect(await screen.findByText("Aún no hay entornos")).toBeInTheDocument();
  });
});
