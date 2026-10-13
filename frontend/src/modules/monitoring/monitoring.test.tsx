import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { infrastructureApi } from "@/modules/infrastructure/api";
import { makeUser, renderPage, renderRoutes } from "@/test/utils";
import type { Paginated } from "@/types/api";

import { monitoringApi, type CheckResult, type HealthCheck } from "./api";
import { HealthCheckDetailPage, MonitoringPage } from "./pages";

vi.mock("./api", async (orig) => {
  const o = await orig<typeof import("./api")>();
  const f = () => vi.fn();
  return { ...o, monitoringApi: { list: f(), get: f(), results: f(), summary: f(), create: f(), update: f(), run: f() } };
});
vi.mock("@/modules/infrastructure/api", async (orig) => {
  const o = await orig<typeof import("@/modules/infrastructure/api")>();
  return { ...o, infrastructureApi: { ...o.infrastructureApi, listEnvironments: vi.fn() } };
});

const api = vi.mocked(monitoringApi);
const admin = makeUser({ role: "ADMIN" });
const page = <T,>(results: T[]): Paginated<T> => ({ count: results.length, next: null, previous: null, results });

function makeCheck(overrides: Partial<HealthCheck> = {}): HealthCheck {
  return {
    id: "h-1", environment: "e-1", project: "p-1", project_name: "Pedidos", environment_kind: "PRODUCTION",
    environment_label: "Production", server_name: "Servidor A", target_url: "https://pedidos.example.com/health",
    path: "/health", expected_status_min: 200, expected_status_max: 399, interval_seconds: 300, timeout_seconds: 5,
    degraded_threshold_ms: 2000, failure_threshold: 2, enabled: true, status: "HEALTHY", effective_status: "HEALTHY",
    effective_status_label: "Disponible", is_stale: false, last_checked_at: "2026-10-12T10:00:00Z", last_response_ms: 142,
    last_status_code: 200, last_error: "", consecutive_failures: 0, status_changed_at: null, uptime_24h: 0.995,
    uptime_7d: 1, can_edit: true, created_at: "", ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.summary.mockResolvedValue({ total: 2, by_status: { HEALTHY: 1, DEGRADED: 0, UNAVAILABLE: 1, UNKNOWN: 0 }, stale: 0, environments_without_check: 3 });
  api.list.mockResolvedValue(
    page([
      makeCheck(),
      makeCheck({ id: "h-2", project_name: "Reservas", effective_status: "UNAVAILABLE", effective_status_label: "No disponible", last_response_ms: null, last_error: "Tiempo de espera agotado (5 s)", uptime_24h: 0.5 }),
    ]),
  );
});

describe("MonitoringPage", () => {
  it("shows real summary and each check with icon+label status", async () => {
    renderPage(<MonitoringPage />, "/", { user: admin });
    expect(await screen.findByText("Pedidos")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Disponible")).toBeInTheDocument();
    expect(within(table).getByText("No disponible")).toBeInTheDocument();
    expect(within(table).getByText("142 ms")).toBeInTheDocument();
    expect(within(table).getByText("99.5 %")).toBeInTheDocument();
    expect(screen.getByText("Entornos sin monitoreo").previousElementSibling).toHaveTextContent("3");
  });

  it("runs a check on demand", async () => {
    api.run.mockResolvedValue(makeCheck({ last_response_ms: 98 }));
    const user = userEvent.setup();
    renderPage(<MonitoringPage />, "/", { user: admin });
    await user.click((await screen.findAllByRole("button", { name: "Verificar ahora" }))[0]);
    await waitFor(() => expect(api.run).toHaveBeenCalledWith("h-1"));
    expect(await screen.findByText("Verificación ejecutada")).toBeInTheDocument();
  });

  it("validates the health check form before saving", async () => {
    vi.mocked(infrastructureApi.listEnvironments).mockResolvedValue(
      page([
        {
          id: "e-9", project: "p-1", project_name: "Pedidos", project_slug: "p", kind: "DEMO", kind_label: "Demo", name: "",
          display_name: "Demo", server: null, server_detail: null, public_url: "https://demo.example.com", deployed_version: "",
          status: "ACTIVE", status_label: "Activo", can_edit: true, created_at: "", updated_at: "",
        },
      ]),
    );
    api.create.mockResolvedValue(makeCheck());
    const user = userEvent.setup();
    renderPage(<MonitoringPage />, "/", { user: admin });
    await user.click(await screen.findByRole("button", { name: "Nuevo health check" }));
    const dialog = screen.getByRole("dialog", { name: "Nuevo health check" });
    await user.selectOptions(await within(dialog).findByLabelText(/Entorno/), "e-9");
    const path = within(dialog).getByLabelText(/Ruta/);
    await user.clear(path);
    await user.type(path, "/../admin");
    const interval = within(dialog).getByLabelText("Intervalo (s)");
    await user.clear(interval);
    await user.type(interval, "30");
    await user.click(within(dialog).getByRole("button", { name: "Crear" }));
    expect(await within(dialog).findByText("No se permite «//» ni «..».")).toBeInTheDocument();
    expect(within(dialog).getByText("Mínimo 60 s.", { selector: "[role=alert]" })).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();

    await user.clear(path);
    await user.type(path, "/health");
    await user.clear(interval);
    await user.type(interval, "120");
    await user.click(within(dialog).getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0]).toMatchObject({ environment: "e-9", path: "/health", interval_seconds: 120, timeout_seconds: 5 });
  }, 20_000);
});

describe("HealthCheckDetailPage", () => {
  const results: CheckResult[] = [
    { id: "r1", checked_at: "2026-10-12T09:50:00Z", status: "HEALTHY", response_ms: 130, status_code: 200, error: "" },
    { id: "r2", checked_at: "2026-10-12T09:55:00Z", status: "DEGRADED", response_ms: 2600, status_code: 200, error: "Respuesta lenta (2600 ms)" },
  ];

  it("warns when results are stale instead of claiming availability", async () => {
    api.get.mockResolvedValue(makeCheck({ is_stale: true, effective_status: "UNKNOWN", effective_status_label: "Verificación desactualizada" }));
    api.results.mockResolvedValue(results);
    renderRoutes([{ path: "/admin/monitoring/:id", element: <HealthCheckDetailPage /> }], "/admin/monitoring/h-1", { user: admin });
    expect((await screen.findAllByText("Verificación desactualizada")).length).toBeGreaterThan(0);
    expect(screen.getByText(/El estado se muestra como desconocido/)).toBeInTheDocument();
    expect(await screen.findByText("Respuesta lenta (2600 ms)")).toBeInTheDocument();
    expect(screen.getByText("100 %")).toBeInTheDocument();
  });
});
