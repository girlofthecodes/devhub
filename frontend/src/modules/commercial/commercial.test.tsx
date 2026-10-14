import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLayout } from "@/layouts/AdminLayout";
import { organizationsApi } from "@/modules/organizations/api";
import { portalApi } from "@/modules/portal/api";
import { PortalContractsPage } from "@/modules/portal/pages";
import { ApiError } from "@/services/http";
import { makeUser, renderPage, renderRoutes } from "@/test/utils";
import type { Paginated } from "@/types/api";

import { commercialApi, type CommercialApplication, type FinanceSummary, type Receivable, type RecurringSummary } from "./api";
import { ContractFormDialog, PaymentDialog } from "./components/dialogs";
import { BusinessOverviewPage } from "./pages/BusinessOverviewPage";
import { periodRange, type PeriodState } from "./period";

vi.mock("./api", async (orig) => {
  const o = await orig<typeof import("./api")>();
  const fns = Object.fromEntries(Object.keys(o.commercialApi).map((k) => [k, vi.fn()]));
  return { ...o, commercialApi: fns };
});
vi.mock("@/modules/organizations/api", async (orig) => {
  const o = await orig<typeof import("@/modules/organizations/api")>();
  return { ...o, organizationsApi: { ...o.organizationsApi, list: vi.fn() } };
});
vi.mock("@/modules/portal/api", async (orig) => {
  const o = await orig<typeof import("@/modules/portal/api")>();
  return { ...o, portalApi: { ...o.portalApi, contracts: vi.fn() } };
});

const api = vi.mocked(commercialApi);
const page = <T,>(results: T[]): Paginated<T> => ({ count: results.length, next: null, previous: null, results });
const admin = makeUser({ role: "ADMIN", finance_access: "MANAGE" });

const app: CommercialApplication = {
  id: "p-1", name: "Agenda Pro", slug: "agenda-pro", project_status: "AVAILABLE", project_status_label: "Disponible",
  commercial_status: "FOR_SALE_AND_RENT", commercial_status_label: "Disponible para venta y renta",
  modalities: ["SALE", "SUBSCRIPTION"], notes: "", end_users_count: null, active_contracts: 0, active_sales: 0,
  active_subscriptions: 0, organizations: 0, mrr: "0.00",
};

function summary(overrides: Partial<FinanceSummary> = {}): FinanceSummary {
  return {
    currency: "MXN", date_from: "2026-01-01", date_to: "2026-12-31", total_projects: 4, commercial_projects: 2,
    active_contracts: 3, projects_with_active_contracts: 1, organizations_with_active_contracts: 2, active_subscriptions: 2,
    sales_in_period: 1, collected: "12500.00", expected: "15000.00", overdue_amount: "1200.00", overdue_count: 1,
    expenses: "2500.00", expenses_breakdown: { total: "2500.00", direct: "2500.00", general: "0.00", general_allocated: "0.00", general_unallocated: "0.00" },
    profit: "10000.00", margin_pct: "80.00",
    revenue_mix: { sales: "10000.00", subscriptions: "2500.00", sales_pct: "80.00", subscriptions_pct: "20.00" },
    series: [], projects: [], other_currencies: [], is_estimate: true, ...overrides,
  };
}

function recurring(overrides: Partial<RecurringSummary> = {}): RecurringSummary {
  return {
    currency: "MXN", as_of: "2026-10-13", mrr: "9000.00", arr: "108000.00", active_contracts: 8, organizations: 8,
    average_per_contract: "1125.00", suspended_contracts: 0, suspended_mrr: "0.00", by_project: [],
    previous_month_mrr: "0.00", previous_month_as_of: "2026-09-30", growth_pct: null, is_new_recurring_revenue: true,
    recurring_collected: "2500.00", recurring_pending: "6500.00", sales_collected: "10000.00", subscriptions_pct: "20.00",
    sales_pct: "80.00", history: [], ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.applications.mockResolvedValue(page([app]));
  api.summary.mockResolvedValue(summary());
  api.recurring.mockResolvedValue(recurring());
  api.upcoming.mockResolvedValue({ as_of: "2026-10-13", upcoming: [], overdue: [], expiring_contracts: [] });
  api.contracts.mockResolvedValue(page([]));
  vi.mocked(organizationsApi.list).mockResolvedValue(
    page([{ id: "o-1", name: "Acme", slug: "acme", description: "", contact_email: "", is_active: true, member_count: 1, created_at: "", updated_at: "" }] as never),
  );
});

describe("periodRange", () => {
  const base: PeriodState = { mode: "month", month: "2026-02", year: 2026, quarter: 3, from: "2026-01-05", to: "2026-03-09", currency: "MXN", project: "", kind: "" };
  it("uses real calendar boundaries", () => {
    expect(periodRange(base)).toEqual({ date_from: "2026-02-01", date_to: "2026-02-28" });
    expect(periodRange({ ...base, mode: "quarter" })).toEqual({ date_from: "2026-07-01", date_to: "2026-09-30" });
    expect(periodRange({ ...base, mode: "year" })).toEqual({ date_from: "2026-01-01", date_to: "2026-12-31" });
    expect(periodRange({ ...base, mode: "custom" })).toEqual({ date_from: "2026-01-05", date_to: "2026-03-09" });
  });
});

describe("Negocio y Rentabilidad — navigation and access", () => {
  const routes = [{ path: "/admin", element: <AdminLayout />, children: [{ index: true, element: <p>Inicio</p> }] }];

  it("shows the section only with explicit finance access", async () => {
    renderRoutes(routes, "/admin", { user: makeUser({ role: "DEVELOPER", finance_access: "NONE" }) });
    expect(await screen.findAllByText("Inicio")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Contratos" })).not.toBeInTheDocument();
  });

  it("lists the six subsections for a user with finance access", async () => {
    renderRoutes(routes, "/admin", { user: makeUser({ role: "DEVELOPER", finance_access: "VIEW" }) });
    for (const name of ["Resumen", "Aplicaciones comerciales", "Contratos", "Cobros", "Gastos", "Reportes"]) {
      expect((await screen.findAllByRole("link", { name })).length).toBeGreaterThan(0);
    }
  });

  it("blocks the dashboard without finance access (the API enforces it too)", async () => {
    renderPage(<BusinessOverviewPage />, "/", { user: makeUser({ role: "DEVELOPER", finance_access: "NONE" }) });
    expect(await screen.findByText("Acceso restringido")).toBeInTheDocument();
    expect(api.summary).not.toHaveBeenCalled();
  });
});

describe("BusinessOverviewPage", () => {
  it("shows the KPIs from the API without inventing values", async () => {
    renderPage(<BusinessOverviewPage />, "/", { user: admin });
    await screen.findByText(/12,500\.00/);
    const kpi = async (label: string) => (await screen.findByText(label)).closest("div.rounded-xl") as HTMLElement;
    expect(within(await kpi("Ingresos cobrados")).getByText(/12,500\.00/)).toBeInTheDocument();
    expect(within(await kpi("Pagos vencidos")).getByText(/1,200\.00/)).toBeInTheDocument();
    expect(within(await kpi("Margen de rentabilidad")).getByText("80 %")).toBeInTheDocument();
    expect(within(await kpi("MRR actual")).getByText(/9,000\.00/)).toBeInTheDocument();
    expect(within(await kpi("ARR actual")).getByText(/108,000\.00/)).toBeInTheDocument();
    // Previous MRR = 0: no invalid division, a "new recurring revenue" indicator instead.
    expect(within(await kpi("Crecimiento mensual del MRR")).getByText("Nuevo ingreso recurrente")).toBeInTheDocument();
    expect(screen.getByText(/no es utilidad contable ni fiscal/)).toBeInTheDocument();
  });

  it("says the margin is not available when nothing was collected", async () => {
    api.summary.mockResolvedValue(summary({ collected: "0.00", profit: "-300.00", margin_pct: null, series: [] }));
    api.recurring.mockResolvedValue(recurring({ subscriptions_pct: null, sales_pct: null }));
    renderPage(<BusinessOverviewPage />, "/", { user: admin });
    expect(await screen.findByText("No disponible")).toBeInTheDocument();
    expect(screen.getByText("Sin ingresos cobrados en el periodo")).toBeInTheDocument();
    expect(screen.getAllByText("Sin ingresos").length).toBe(2);
    expect((await screen.findAllByText("Sin datos suficientes")).length).toBeGreaterThan(0);
  });

  it("sends the selected quarter to the API", async () => {
    const user = userEvent.setup();
    renderPage(<BusinessOverviewPage />, "/", { user: admin });
    await screen.findByText("Ingresos cobrados");
    await user.click(screen.getByRole("radio", { name: "Trimestre" }));
    await user.selectOptions(screen.getByLabelText("Trimestre"), "2");
    await waitFor(() =>
      expect(api.summary).toHaveBeenLastCalledWith(
        expect.objectContaining({ date_from: expect.stringMatching(/-04-01$/), date_to: expect.stringMatching(/-06-30$/), currency: "MXN" }),
      ),
    );
  });
});

describe("ContractFormDialog", () => {
  it("requires the billing period of a rental and creates it in draft", async () => {
    api.createContract.mockResolvedValue({ id: "c-1", project_name: "Agenda Pro", organization_name: "Acme" } as never);
    const user = userEvent.setup();
    renderPage(<ContractFormDialog open onClose={() => undefined} />, "/", { user: admin });
    const dialog = await screen.findByRole("dialog", { name: "Registrar renta" });
    await within(dialog).findByRole("option", { name: /Agenda Pro/ });
    await within(dialog).findByRole("option", { name: "Acme" });
    await user.selectOptions(within(dialog).getByLabelText(/Aplicación/), "p-1");
    await user.selectOptions(within(dialog).getByLabelText(/Organización cliente/), "o-1");
    await user.type(within(dialog).getByLabelText(/Importe por periodo/), "1200.505");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    expect(await screen.findByText("Importe no válido (hasta 2 decimales).")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText(/Importe por periodo/));
    await user.type(within(dialog).getByLabelText(/Importe por periodo/), "1200");
    await user.selectOptions(within(dialog).getByLabelText(/Periodicidad/), "QUARTERLY");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() =>
      expect(api.createContract).toHaveBeenCalledWith(
        expect.objectContaining({ project: "p-1", organization: "o-1", kind: "SUBSCRIPTION", amount: "1200", billing_period: "QUARTERLY", end_date: null, grants_access: true, portal_visible: false }),
        expect.anything(),
      ),
    );
  });

  it("a sale has no billing period", async () => {
    api.createContract.mockResolvedValue({ id: "c-2", project_name: "Agenda Pro", organization_name: "Acme" } as never);
    const user = userEvent.setup();
    renderPage(<ContractFormDialog open onClose={() => undefined} />, "/", { user: admin });
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: /Agenda Pro/ });
    await within(dialog).findByRole("option", { name: "Acme" });
    await user.selectOptions(within(dialog).getByLabelText(/Aplicación/), "p-1");
    await user.selectOptions(within(dialog).getByLabelText(/Organización cliente/), "o-1");
    await user.selectOptions(within(dialog).getByLabelText(/Modelo comercial/), "SALE");
    expect(within(dialog).queryByLabelText(/Periodicidad/)).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Importe de la venta/), "45000");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(api.createContract).toHaveBeenCalledWith(expect.objectContaining({ kind: "SALE", billing_period: "" }), expect.anything()));
  });

  it("shows the duplicate-contract rule from the server", async () => {
    api.createContract.mockRejectedValue(
      new ApiError(400, { code: "duplicate", detail: "Ya existe un contrato abierto equivalente.", fields: { organization: ["Ya existe un contrato abierto equivalente."] } }),
    );
    const user = userEvent.setup();
    renderPage(<ContractFormDialog open onClose={() => undefined} />, "/", { user: admin });
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: /Agenda Pro/ });
    await within(dialog).findByRole("option", { name: "Acme" });
    await user.selectOptions(within(dialog).getByLabelText(/Aplicación/), "p-1");
    await user.selectOptions(within(dialog).getByLabelText(/Organización cliente/), "o-1");
    await user.type(within(dialog).getByLabelText(/Importe por periodo/), "1200");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    expect(await screen.findByText("Ya existe un contrato abierto equivalente.")).toBeInTheDocument();
  });
});

describe("PaymentDialog", () => {
  const receivable: Receivable = {
    id: "r-1", contract: "c-1", project: "p-1", project_name: "Agenda Pro", organization_name: "Acme", contract_kind: "SUBSCRIPTION",
    concept: "Renta mensual", period_start: "2026-10-01", period_end: "2026-10-31", due_date: "2026-10-01",
    expected_amount: "1200.00", paid_amount: "500.00", outstanding_amount: "700.00", currency: "MXN", status: "PARTIAL",
    effective_status: "OVERDUE", effective_status_label: "Vencido", notes: "", cancellation_reason: "", created_at: "",
  };

  it("proposes the outstanding balance and reports overpayment from the server", async () => {
    api.recordPayment.mockRejectedValue(
      new ApiError(400, { code: "overpayment", detail: "El pago excede el saldo pendiente (700.00).", fields: { amount: ["El pago excede el saldo pendiente (700.00)."] } }),
    );
    const user = userEvent.setup();
    renderPage(<PaymentDialog receivable={receivable} onClose={() => undefined} />, "/", { user: admin });
    const amount = await screen.findByLabelText(/Importe cobrado/);
    expect(amount).toHaveValue("700.00");
    await user.clear(amount);
    await user.type(amount, "800");
    await user.type(screen.getByLabelText(/Referencia/), "SPEI-1");
    await user.click(screen.getByRole("button", { name: "Registrar pago" }));
    expect(await screen.findByText("El pago excede el saldo pendiente (700.00).")).toBeInTheDocument();
    expect(api.recordPayment).toHaveBeenCalledWith(expect.objectContaining({ receivable: "r-1", amount: "800", method: "TRANSFER", reference: "SPEI-1" }), expect.anything());
  });
});

describe("PortalContractsPage", () => {
  it("shows modality, validity and next due date, never amounts", async () => {
    vi.mocked(portalApi.contracts).mockResolvedValue([
      {
        id: "c-1", project: "p-1", project_name: "Agenda Pro", organization_name: "Acme", kind: "SUBSCRIPTION",
        kind_label: "Renta / suscripción", status: "ACTIVE", status_label: "Activo", start_date: "2026-06-01", end_date: null,
        billing_period: "MONTHLY", billing_period_label: "Mensual", next_due_date: "2026-11-01",
      },
    ]);
    renderPage(<PortalContractsPage />, "/", { user: makeUser({ role: "CLIENT" }) });
    expect(await screen.findByText("Agenda Pro")).toBeInTheDocument();
    expect(screen.getByText("Renta / suscripción · mensual")).toBeInTheDocument();
    expect(screen.getByText(/indefinida/)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("explains when nothing has been shared", async () => {
    vi.mocked(portalApi.contracts).mockResolvedValue([]);
    renderPage(<PortalContractsPage />, "/", { user: makeUser({ role: "CLIENT" }) });
    expect(await screen.findByText("Sin contratos para mostrar")).toBeInTheDocument();
  });
});
