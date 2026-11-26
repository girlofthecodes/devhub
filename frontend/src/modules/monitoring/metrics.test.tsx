import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeUser, renderPage, renderRoutes } from "@/test/utils";
import type { Paginated } from "@/types/api";

import { metricsApi, type EnvironmentMetrics, type MetricsOverview, type MonitoringAlert, type ProjectMetrics, type ProjectMetricsDetail } from "./metricsApi";
import { AlertsPage, MetricsOverviewPage, ProjectMetricsPage } from "./metricsPages";

vi.mock("./metricsApi", async (orig) => {
  const o = await orig<typeof import("./metricsApi")>();
  const f = () => vi.fn();
  return { ...o, metricsApi: { overview: f(), project: f(), alerts: f(), alertSummary: f(), acknowledge: f(), resolve: f() } };
});

const api = vi.mocked(metricsApi);
const admin = makeUser({ role: "ADMIN" });
const NOW = "2026-11-26T17:00:00Z";
const page = <T,>(results: T[]): Paginated<T> => ({ count: results.length, next: null, previous: null, results });

const metrics = {
  recorded_at: NOW, is_stale: false, cpu_percent: 42, memory_percent: 61, memory_used_mb: 1250,
  requests_per_minute: 120, error_rate_percent: 0.4, latency_p95_ms: 380, active_connections: 12, process_uptime_seconds: 7200,
};

function env(overrides: Partial<EnvironmentMetrics> = {}): EnvironmentMetrics {
  return {
    id: "e-1", project: "p-1", kind: "PRODUCTION", label: "Production", public_url: "https://pedidos.example.com", server_name: "Servidor A",
    health_check: "h-1", status: "HEALTHY", status_label: "Disponible", is_stale: false, last_checked_at: NOW, last_response_ms: 140,
    status_changed_at: null, uptime_24h: 0.999, uptime_7d: 0.998, uptime_30d: 0.997,
    history_24h: Array.from({ length: 24 }, (_, i) => ({ hour: `2026-11-26T${String(i).padStart(2, "0")}:00:00Z`, status: "HEALTHY" as const, uptime: 1 })),
    metrics, open_alerts: 0, alert_severity: null, last_update: NOW, ...overrides,
  };
}

function project(overrides: Partial<ProjectMetrics> = {}): ProjectMetrics {
  const e = env();
  return {
    id: "p-1", name: "Pedidos", slug: "pedidos", project_status: "AVAILABLE", status: "HEALTHY", status_label: "Disponible",
    environments: [e], primary_environment: e.id, uptime_24h: 0.999, uptime_7d: 0.998, last_response_ms: 140, metrics,
    open_alerts: 0, alert_severity: null, pages_up: 1, pages_down: 0, last_update: NOW, ...overrides,
  };
}

const overview: MetricsOverview = {
  generated_at: NOW,
  totals: {
    projects: 3, monitored_projects: 2, pages: 2, pages_up: 1, pages_degraded: 0, pages_down: 1, pages_unknown: 0,
    open_alerts: 2, critical_alerts: 1, avg_uptime_24h: 0.9812, reporting_metrics: 2, last_update: NOW,
  },
  projects: [
    project({
      id: "p-2", name: "Citas", status: "UNAVAILABLE", status_label: "No disponible", pages_up: 0, pages_down: 1, open_alerts: 2,
      alert_severity: "CRITICAL", metrics: { ...metrics, error_rate_percent: 22.4 }, environments: [env({ id: "e-2", status: "UNAVAILABLE" })],
    }),
    project(),
    project({ id: "p-3", name: "Escolar", status: "UNKNOWN", environments: [], primary_environment: null, metrics: null, uptime_24h: null }),
  ],
};

function alert(overrides: Partial<MonitoringAlert> = {}): MonitoringAlert {
  return {
    id: "a-1", environment: "e-2", project: "p-2", project_name: "Citas", environment_kind: "PRODUCTION", environment_label: "Production",
    kind: "SERVICE_DOWN", kind_label: "Servicio caído", severity: "CRITICAL", status: "OPEN", status_label: "Abierta",
    message: "Production no responde: Tiempo de espera agotado (5 s)", value: null, threshold: null, hits: 5, opened_at: NOW,
    last_seen_at: NOW, acknowledged_at: null, acknowledged_by_email: null, resolved_at: null, resolved_by_email: null,
    duration_seconds: 1800, can_edit: true, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.overview.mockResolvedValue(overview);
  api.alerts.mockResolvedValue(page([alert(), alert({ id: "a-2", kind: "HIGH_CPU", kind_label: "CPU alta", severity: "WARNING", message: "CPU en 91 %", can_edit: false })]));
  api.alertSummary.mockResolvedValue({ open: 2, acknowledged: 0, critical: 1, resolved_7d: 4, opened_24h: 3, mttr_seconds_7d: 1500 });
});

describe("MetricsOverviewPage", () => {
  it("shows totals and every project with status, uptime, metrics and alerts", async () => {
    renderPage(<MetricsOverviewPage />, "/", { user: admin });
    await screen.findByText("Citas");
    const table = screen.getByRole("table");
    expect(screen.getByText("Páginas caídas").closest("div")?.parentElement).toHaveTextContent("1");
    expect(screen.getByText("98.12 %")).toBeInTheDocument();
    expect(within(table).getByText("Citas")).toBeInTheDocument();
    expect(within(table).getByText("No disponible")).toBeInTheDocument();
    expect(within(table).getByText("22.4 % errores")).toBeInTheDocument();
    expect(within(table).getByText("Sin monitoreo configurado")).toBeInTheDocument();
    expect(screen.getByText("En vivo")).toBeInTheDocument();
  });

  it("filters to projects that are down and can pause live updates", async () => {
    const user = userEvent.setup();
    renderPage(<MetricsOverviewPage />, "/", { user: admin });
    await screen.findByText("Citas");
    const table = screen.getByRole("table");
    await user.click(screen.getByRole("radio", { name: "Caídos" }));
    expect(within(table).queryByText("Pedidos")).not.toBeInTheDocument();
    expect(within(table).getByText("Citas")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pausar" }));
    expect(screen.getByText("En pausa")).toBeInTheDocument();
  });
});

describe("ProjectMetricsPage", () => {
  const detail: ProjectMetricsDetail = {
    ...project(),
    generated_at: NOW, window_hours: 24, bucket_seconds: 720, selected_environment: "e-1",
    statistics: {
      checks: 288, failures: 2, degraded: 1, uptime: 0.9931, avg_response_ms: 150, p95_response_ms: 310, max_response_ms: 900,
      incidents: 1, downtime_seconds: 600, mttr_seconds: 600, longest_outage_seconds: 600, alerts: 2, avg_cpu_percent: 40,
      max_cpu_percent: 70, avg_memory_percent: 60, max_memory_percent: 66, avg_requests_per_minute: 120, total_requests: 172800, avg_error_rate_percent: 0.4,
    },
    metric_series: [{ t: NOW, cpu_percent: 40, memory_percent: 60, memory_used_mb: 1200, requests_per_minute: 120, error_rate_percent: 0.4, latency_p95_ms: 300, active_connections: 10 }],
    response_series: [{ t: NOW, avg_ms: 150, max_ms: 200, checks: 3, status: "HEALTHY" }],
    daily_uptime: [{ day: "2026-11-26", uptime: 0.99, checks: 288, failures: 2, avg_ms: 150 }],
  };

  it("shows live values, window statistics and changes the window", async () => {
    api.project.mockResolvedValue(detail);
    const user = userEvent.setup();
    renderRoutes([{ path: "/admin/metrics/:id", element: <ProjectMetricsPage /> }], "/admin/metrics/p-1", { user: admin });
    expect(await screen.findByText(/Tiempo real/)).toBeInTheDocument();
    expect(screen.getByText("1,250 MB")).toBeInTheDocument();
    expect(screen.getByText("99.31 %")).toBeInTheDocument();
    expect(screen.getByText("172,800")).toBeInTheDocument();
    expect(screen.getByText("Estadísticas · últimas 24 h")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "7 días" }));
    await waitFor(() => expect(api.project).toHaveBeenLastCalledWith("p-1", { hours: 168, environment: undefined }));
  });

  it("explains a project without monitoring", async () => {
    api.project.mockResolvedValue({ ...detail, environments: [], selected_environment: null, statistics: null });
    renderRoutes([{ path: "/admin/metrics/:id", element: <ProjectMetricsPage /> }], "/admin/metrics/p-1", { user: admin });
    expect(await screen.findByText("Proyecto sin monitoreo")).toBeInTheDocument();
  });
});

describe("AlertsPage", () => {
  it("lists active alerts with severity and lets editors acknowledge", async () => {
    api.acknowledge.mockResolvedValue(alert({ status: "ACKNOWLEDGED" }));
    const user = userEvent.setup();
    renderPage(<AlertsPage />, "/", { user: admin });
    await screen.findByText("Servicio caído");
    const table = screen.getByRole("table");
    expect(within(table).getByText("Crítica")).toBeInTheDocument();
    expect(api.alerts).toHaveBeenCalledWith(expect.objectContaining({ status: "ACTIVE" }));
    // Only one row is editable.
    expect(within(table).getAllByRole("button", { name: "Reconocer" })).toHaveLength(1);
    await user.click(within(table).getByRole("button", { name: "Reconocer" }));
    await waitFor(() => expect(api.acknowledge).toHaveBeenCalledWith("a-1"));
    expect(screen.getByText("25 min")).toBeInTheDocument(); // MTTR
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    renderPage(<AlertsPage />, "/", { user: admin });
    await screen.findByText("Servicio caído");
    await user.click(screen.getByRole("radio", { name: "Resueltas" }));
    await waitFor(() => expect(api.alerts).toHaveBeenLastCalledWith(expect.objectContaining({ status: "RESOLVED" })));
  });
});
