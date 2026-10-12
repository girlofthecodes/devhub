import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { infrastructureApi } from "@/modules/infrastructure/api";
import { projectsApi } from "@/modules/projects/api";
import { IntegrationsPage } from "@/modules/settings/IntegrationsPage";
import { eventsApi, type TraceEvent } from "@/modules/traceability/api";
import { TraceabilityPage } from "@/modules/traceability/pages/TraceabilityPage";
import { makeUser, renderPage, renderRoutes } from "@/test/utils";
import type { Paginated } from "@/types/api";

import { deploymentsApi, type Deployment, type DeploymentStats } from "./api";
import { commitUrl, formatDuration } from "./constants";
import { DeploymentDetailPage } from "./pages/DeploymentDetailPage";
import { DeploymentsPage } from "./pages/DeploymentsPage";

vi.mock("./api", async (orig) => {
  const o = await orig<typeof import("./api")>();
  const f = () => vi.fn();
  return { ...o, deploymentsApi: { list: f(), get: f(), create: f(), transition: f(), stats: f(), listTokens: f(), createToken: f(), revokeToken: f() } };
});
vi.mock("@/modules/traceability/api", async (orig) => {
  const o = await orig<typeof import("@/modules/traceability/api")>();
  return { ...o, eventsApi: { list: vi.fn() } };
});
vi.mock("@/modules/projects/api", async (orig) => {
  const o = await orig<typeof import("@/modules/projects/api")>();
  return { ...o, projectsApi: { ...o.projectsApi, list: vi.fn() } };
});
vi.mock("@/modules/infrastructure/api", async (orig) => {
  const o = await orig<typeof import("@/modules/infrastructure/api")>();
  return { ...o, infrastructureApi: { ...o.infrastructureApi, listEnvironments: vi.fn() } };
});

const api = vi.mocked(deploymentsApi);
const events = vi.mocked(eventsApi);
const projects = vi.mocked(projectsApi);
const infra = vi.mocked(infrastructureApi);
const admin = makeUser({ role: "ADMIN" });
const page = <T,>(results: T[]): Paginated<T> => ({ count: results.length, next: null, previous: null, results });

const stats: DeploymentStats = {
  days: [
    { date: "2026-10-11", SUCCESS: 2, FAILED: 1, CANCELLED: 0, IN_PROGRESS: 0 },
    { date: "2026-10-12", SUCCESS: 1, FAILED: 0, CANCELLED: 1, IN_PROGRESS: 1 },
  ],
  totals: { SUCCESS: 3, FAILED: 1, CANCELLED: 1, IN_PROGRESS: 1 },
  success_rate: 0.75,
};

function makeDeployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: "d-1",
    project: "p-1",
    project_name: "Portal de Pedidos",
    project_slug: "portal-de-pedidos",
    repository_url: "https://github.com/acme/pedidos",
    environment: "e-1",
    environment_kind: "PRODUCTION",
    environment_label: "Production",
    version: "v1.6.0",
    commit_sha: "9f2c1e7a5b3d4c6e8f0a1b2c3d4e5f60718293a4",
    branch: "main",
    source: "GITHUB_ACTIONS",
    source_label: "GitHub Actions",
    triggered_by_label: "octocat",
    status: "RUNNING",
    status_label: "En ejecución",
    is_terminal: false,
    started_at: "2026-10-12T10:00:00Z",
    finished_at: null,
    duration_seconds: 42,
    ci_run_id: "7003-1",
    ci_run_url: "https://github.com/acme/pedidos/actions/runs/7003",
    message: "",
    correlation_id: "dep-abc",
    can_manage: true,
    created_at: "2026-10-12T10:00:00Z",
    ...overrides,
  };
}

const event = (overrides: Partial<TraceEvent> = {}): TraceEvent => ({
  id: "ev-1",
  occurred_at: "2026-10-12T10:00:00Z",
  event_type: "DEPLOYMENT_STARTED",
  event_type_label: "Despliegue iniciado",
  severity: "INFO",
  severity_label: "Información",
  source: "GITHUB_ACTIONS",
  source_label: "GitHub Actions",
  description: "Despliegue de v1.6.0 iniciado en Portal de Pedidos · Production",
  project: "p-1",
  project_name: "Portal de Pedidos",
  environment: "e-1",
  environment_kind: "PRODUCTION",
  deployment: "d-1",
  deployment_version: "v1.6.0",
  correlation_id: "dep-abc",
  actor_label: "octocat",
  metadata: { version: "v1.6.0", ci_run_id: "7003-1" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.stats.mockResolvedValue(stats);
  api.list.mockResolvedValue(page([makeDeployment()]));
  events.list.mockResolvedValue(page([event()]));
  projects.list.mockResolvedValue(page([]));
  infra.listEnvironments.mockResolvedValue(page([]));
});

describe("helpers", () => {
  it("formats durations and builds commit links", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(125)).toBe("2 min 5 s");
    expect(formatDuration(3720)).toBe("1 h 2 min");
    expect(commitUrl("https://github.com/acme/p.git", "abc1234")).toBe("https://github.com/acme/p/commit/abc1234");
    expect(commitUrl("https://gitlab.com/acme/p", "abc1234")).toBe("https://gitlab.com/acme/p/-/commit/abc1234");
    expect(commitUrl("https://git.example.com/p", "abc1234")).toBeNull();
  });
});

describe("DeploymentsPage", () => {
  it("lists deployments and shows the chart legend with real totals", async () => {
    renderPage(<DeploymentsPage />, "/", { user: admin });
    expect(await screen.findByText("v1.6.0")).toBeInTheDocument();
    expect(screen.getByText(/9f2c1e7/)).toBeInTheDocument();
    expect(await screen.findByText("6 en 14 días · tasa de éxito 75 %")).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: "Leyenda" });
    expect(within(legend).getByText("Exitosos").parentElement).toHaveTextContent("3");
    expect(within(legend).getByText("Fallidos").parentElement).toHaveTextContent("1");
  });

  it("offers an accessible table view of the chart and range switch", async () => {
    const user = userEvent.setup();
    renderPage(<DeploymentsPage />, "/", { user: admin });
    await user.click(await screen.findByRole("button", { name: "Ver como tabla" }));
    const table = screen.getByRole("table", { name: "Despliegues por día" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: "30 d" }));
    await waitFor(() => expect(api.stats).toHaveBeenLastCalledWith({ days: 30, project: undefined }));
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    renderPage(<DeploymentsPage />, "/", { user: admin });
    await screen.findByText("v1.6.0");
    await user.selectOptions(screen.getByLabelText("Filtrar por estado"), "FAILED");
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "FAILED", page: 1 })));
  });

  it("validates and submits a manual deployment", async () => {
    infra.listEnvironments.mockResolvedValue(
      page([
        {
          id: "e-1", project: "p-1", project_name: "Portal de Pedidos", project_slug: "portal-de-pedidos", kind: "PRODUCTION",
          kind_label: "Production", name: "", display_name: "Production", server: null, server_detail: null,
          public_url: "", deployed_version: "v1.5.0", status: "ACTIVE", status_label: "Activo", can_edit: true,
          created_at: "", updated_at: "",
        },
      ]),
    );
    api.create.mockResolvedValue(makeDeployment({ id: "d-9", status: "SUCCESS" }));
    const user = userEvent.setup();
    const { router } = renderRoutes(
      [
        { path: "/admin/deployments", element: <DeploymentsPage /> },
        { path: "/admin/deployments/:id", element: <p>detalle</p> },
      ],
      "/admin/deployments",
      { user: admin },
    );
    await user.click(await screen.findByRole("button", { name: "Registrar despliegue" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar despliegue" });
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));
    expect(await within(dialog).findByText("Selecciona un entorno.")).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByLabelText(/Entorno/), "e-1");
    await user.type(within(dialog).getByLabelText(/Versión/), "v1.6.0");
    await user.type(within(dialog).getByLabelText("Commit"), "XYZ");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));
    expect(await within(dialog).findByText(/SHA de commit no válido/)).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("Commit"));
    await user.type(within(dialog).getByLabelText("Commit"), "ABCDEF1");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0]).toEqual({
      environment: "e-1",
      version: "v1.6.0",
      commit_sha: "abcdef1",
      branch: "",
      ci_run_url: "",
      status: "SUCCESS",
      message: "",
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/deployments/d-9"));
  }, 20_000);
});

describe("DeploymentDetailPage", () => {
  const renderDetail = (d: Deployment) => {
    api.get.mockResolvedValue(d);
    return renderRoutes([{ path: "/admin/deployments/:id", element: <DeploymentDetailPage /> }], `/admin/deployments/${d.id}`, { user: admin });
  };

  it("shows CI links, events and allowed transitions", async () => {
    renderDetail(makeDeployment());
    expect(await screen.findByRole("link", { name: "9f2c1e7a5b3d" })).toHaveAttribute(
      "href",
      "https://github.com/acme/pedidos/commit/9f2c1e7a5b3d4c6e8f0a1b2c3d4e5f60718293a4",
    );
    expect(screen.getByRole("link", { name: /Ver ejecución/ })).toHaveAttribute("href", "https://github.com/acme/pedidos/actions/runs/7003");
    expect(await screen.findByText("Despliegue iniciado")).toBeInTheDocument();
    expect(events.list).toHaveBeenCalledWith(expect.objectContaining({ deployment: "d-1" }));
    for (const name of ["Marcar exitoso", "Marcar fallido", "Cancelar"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/se actualiza automáticamente/)).toBeInTheDocument();
  });

  it("confirms a transition with a message", async () => {
    api.transition.mockResolvedValue(makeDeployment({ status: "SUCCESS", is_terminal: true }));
    const user = userEvent.setup();
    renderDetail(makeDeployment());
    await user.click(await screen.findByRole("button", { name: "Marcar exitoso" }));
    const dialog = screen.getByRole("dialog", { name: "Marcar como exitoso" });
    expect(dialog).toHaveTextContent("La versión del entorno pasará a v1.6.0");
    await user.type(within(dialog).getByLabelText(/Mensaje/), "Verificado en producción");
    await user.click(within(dialog).getByRole("button", { name: "Marcar exitoso" }));
    await waitFor(() => expect(api.transition).toHaveBeenCalledWith("d-1", "SUCCESS", "Verificado en producción"));
  });

  it("is read-only when terminal or without permission", async () => {
    renderDetail(makeDeployment({ status: "SUCCESS", status_label: "Exitoso", is_terminal: true }));
    await screen.findByText("Despliegue iniciado");
    expect(screen.queryByRole("button", { name: /Marcar|Cancelar|Iniciar/ })).not.toBeInTheDocument();
  });
});

describe("TraceabilityPage", () => {
  it("renders the timeline and filters by severity and correlation", async () => {
    events.list.mockResolvedValue(
      page([event(), event({ id: "ev-2", event_type: "DEPLOYMENT_FAILED", severity: "ERROR", severity_label: "Error", description: "falló" })]),
    );
    const user = userEvent.setup();
    renderPage(<TraceabilityPage />, "/admin/traceability", { user: admin });
    // Wait for the timeline itself (the label also exists as a filter <option>).
    const failed = (await screen.findByText("falló")).closest("li")!;
    expect(within(failed).getByText("Despliegue fallido")).toBeInTheDocument();
    expect(within(failed).getByText("Error")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Error" }));
    await waitFor(() => expect(events.list).toHaveBeenLastCalledWith(expect.objectContaining({ severity: "ERROR" })));

    await user.click(screen.getAllByRole("button", { name: /Detalle/ })[0]);
    expect(screen.getByText(/"ci_run_id": "7003-1"/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ver eventos relacionados/ }));
    await waitFor(() => expect(events.list).toHaveBeenLastCalledWith(expect.objectContaining({ correlation_id: "dep-abc" })));
    expect(screen.getByText(/Mostrando eventos correlacionados/)).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    events.list.mockResolvedValue(page([]));
    renderPage(<TraceabilityPage />, "/admin/traceability", { user: admin });
    expect(await screen.findByText("Aún no hay eventos")).toBeInTheDocument();
  });
});

describe("IntegrationsPage", () => {
  it("creates a token, shows it once and allows copying", async () => {
    api.listTokens.mockResolvedValue(page([]));
    projects.list.mockResolvedValue(page([{ id: "p-1", name: "Portal de Pedidos", slug: "portal-de-pedidos" }] as never));
    api.createToken.mockResolvedValue({
      id: "t-1", name: "GitHub Actions", key_prefix: "ab12cd34", projects: [], state: "ACTIVE", expires_at: null,
      last_used_at: null, revoked_at: null, created_by_email: "", created_at: "", token: "dhs_ab12cd34_secret",
    });
    const user = userEvent.setup();
    renderPage(<IntegrationsPage />, "/", { user: admin });

    await user.click(await screen.findByRole("button", { name: "Nuevo token" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo token de servicio" });
    await user.click(within(dialog).getByRole("button", { name: "Crear token" }));
    expect(within(dialog).getByText("Selecciona al menos un proyecto.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Nombre/), "GitHub Actions");
    await user.click(await within(dialog).findByRole("checkbox", { name: /Portal de Pedidos/ }));
    await user.click(within(dialog).getByRole("button", { name: "Crear token" }));

    expect(await screen.findByText("dhs_ab12cd34_secret")).toBeInTheDocument();
    expect(api.createToken.mock.calls[0][0]).toEqual({ name: "GitHub Actions", projects: ["p-1"], expires_at: null });
    await user.click(screen.getByRole("button", { name: "Copiar" }));
    // user-event provides the clipboard implementation in tests.
    expect(await navigator.clipboard.readText()).toBe("dhs_ab12cd34_secret");
    expect(screen.getByRole("button", { name: "Copiado" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Listo, ya lo guardé" }));
    expect(screen.queryByText("dhs_ab12cd34_secret")).not.toBeInTheDocument();
  });

  it("lists masked tokens and revokes after confirmation", async () => {
    api.listTokens.mockResolvedValue(
      page([
        {
          id: "t-1", name: "CI pedidos", key_prefix: "ab12cd34", projects: [{ id: "p-1", name: "Portal de Pedidos", slug: "p" }],
          state: "ACTIVE", expires_at: null, last_used_at: null, revoked_at: null, created_by_email: "", created_at: "",
        },
      ]),
    );
    api.revokeToken.mockResolvedValue({} as never);
    const user = userEvent.setup();
    renderPage(<IntegrationsPage />, "/", { user: admin });
    expect(await screen.findByText("dhs_ab12cd34_••••••••")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revocar" }));
    expect(api.revokeToken).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revocar" }));
    await waitFor(() => expect(api.revokeToken).toHaveBeenCalledWith("t-1", expect.anything()));
  });
});
