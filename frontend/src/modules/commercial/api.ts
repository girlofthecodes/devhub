import { http } from "@/services/http";
import type { ListParams, Paginated } from "@/types/api";

/** Money is always a decimal string from the API (never a float). */
export type Money = string;
export type Currency = "MXN" | "USD";
export type CommercialStatus =
  | "NOT_COMMERCIAL"
  | "PREPARING"
  | "FOR_SALE"
  | "FOR_RENT"
  | "FOR_SALE_AND_RENT"
  | "SUSPENDED";
export type ContractKind = "SALE" | "SUBSCRIPTION";
export type ContractStatus = "DRAFT" | "PENDING" | "ACTIVE" | "SUSPENDED" | "FINISHED" | "CANCELLED";
export type BillingPeriod = "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";
export type ReceivableStatus = "PENDING" | "PARTIAL" | "PAID" | "OVERDUE" | "CANCELLED";
export type PaymentMethod = "TRANSFER" | "DEPOSIT" | "CARD" | "CASH" | "OTHER";
export type ExpenseCategory =
  | "HOSTING"
  | "ELECTRICITY"
  | "INTERNET"
  | "DOMAINS"
  | "SERVERS"
  | "MAINTENANCE"
  | "EXTERNAL_SERVICES"
  | "LICENSES"
  | "OTHER";
export type ExpenseKind = "ONE_TIME" | "RECURRING";

export interface CommercialApplication {
  id: string;
  name: string;
  slug: string;
  project_status: string;
  project_status_label: string;
  commercial_status: CommercialStatus;
  commercial_status_label: string;
  modalities: ContractKind[];
  notes: string;
  end_users_count: number | null;
  active_contracts: number;
  active_sales: number;
  active_subscriptions: number;
  organizations: number;
  mrr: Money;
}

export interface ProfilePayload {
  status?: CommercialStatus;
  notes?: string;
  end_users_count?: number | null;
}

export interface ContractPrice {
  id: string;
  amount: Money;
  effective_from: string;
  reason: string;
  created_at: string;
  created_by_email: string | null;
}

export interface ContractStatusChange {
  id: string;
  from_status: ContractStatus | "";
  from_status_label: string;
  to_status: ContractStatus;
  to_status_label: string;
  effective_date: string;
  reason: string;
  created_at: string;
  actor_email: string | null;
}

export interface Contract {
  id: string;
  project: string;
  project_name: string;
  organization: string;
  organization_name: string;
  kind: ContractKind;
  kind_label: string;
  status: ContractStatus;
  status_label: string;
  currency: Currency;
  amount: Money | null;
  monthly_value: Money | null;
  start_date: string;
  end_date: string | null;
  billing_period: BillingPeriod | "";
  billing_period_label: string;
  next_billing_date: string | null;
  terms: string;
  portal_visible: boolean;
  grants_access: boolean;
  has_portal_access: boolean;
  cancellation_reason: string;
  created_at: string;
  updated_at: string;
}

export interface ContractDetail extends Contract {
  prices: ContractPrice[];
  status_changes: ContractStatusChange[];
  totals: { expected: Money; collected: Money; outstanding: Money };
}

export interface ContractPayload {
  project: string;
  organization: string;
  kind: ContractKind;
  amount: Money;
  currency: Currency;
  start_date: string;
  end_date: string | null;
  billing_period: BillingPeriod | "";
  terms: string;
  portal_visible: boolean;
  grants_access: boolean;
}

export type ContractUpdatePayload = Partial<
  Pick<ContractPayload, "amount" | "currency" | "start_date" | "end_date" | "terms" | "portal_visible" | "grants_access">
> & { billing_period?: BillingPeriod; next_billing_date?: string | null };

export interface Receivable {
  id: string;
  contract: string;
  project: string;
  project_name: string;
  organization_name: string;
  contract_kind: ContractKind;
  concept: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string;
  expected_amount: Money;
  paid_amount: Money;
  outstanding_amount: Money;
  currency: Currency;
  status: Exclude<ReceivableStatus, "OVERDUE">;
  effective_status: ReceivableStatus;
  effective_status_label: string;
  notes: string;
  cancellation_reason: string;
  created_at: string;
}

export interface Payment {
  id: string;
  receivable: string;
  receivable_concept: string;
  contract: string;
  project_name: string;
  organization_name: string;
  amount: Money;
  currency: Currency;
  paid_on: string;
  method: PaymentMethod;
  method_label: string;
  reference: string;
  notes: string;
  created_at: string;
  created_by_email: string | null;
  is_reversed: boolean;
  reversed_at: string | null;
  reversal_reason: string;
  corrects: string | null;
}

export interface PaymentPayload {
  amount: Money;
  paid_on: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
}

export interface Expense {
  id: string;
  concept: string;
  category: ExpenseCategory;
  category_label: string;
  amount: Money;
  currency: Currency;
  incurred_on: string;
  project: string | null;
  project_name: string | null;
  kind: ExpenseKind;
  kind_label: string;
  recurrence: BillingPeriod | "";
  recurrence_label: string;
  notes: string;
  allocations: { project: string; project_name: string; percentage: string; amount: Money }[];
  allocated_pct: string;
  is_voided: boolean;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
}

export interface ExpensePayload {
  concept: string;
  category: ExpenseCategory;
  amount: Money;
  currency: Currency;
  incurred_on: string;
  project: string | null;
  kind: ExpenseKind;
  recurrence: BillingPeriod | "";
  notes: string;
}

export interface PeriodFilters {
  date_from: string;
  date_to: string;
  currency: Currency;
  project?: string;
  kind?: ContractKind;
}

export interface SeriesPoint {
  month: string;
  collected: Money;
  collected_sales: Money;
  collected_subscriptions: Money;
  expenses: Money | null;
  profit: Money | null;
  margin_pct: string | null;
}

export interface ProjectProfit {
  project: string;
  project_name: string;
  collected: Money;
  expenses: Money | null;
  profit: Money | null;
  margin_pct: string | null;
}

export interface FinanceSummary {
  currency: Currency;
  date_from: string;
  date_to: string;
  total_projects: number;
  commercial_projects: number;
  active_contracts: number;
  projects_with_active_contracts: number;
  organizations_with_active_contracts: number;
  active_subscriptions: number;
  sales_in_period: number;
  collected: Money;
  expected: Money;
  overdue_amount: Money;
  overdue_count: number;
  expenses: Money | null;
  expenses_breakdown: Record<string, Money> | null;
  profit: Money | null;
  margin_pct: string | null;
  revenue_mix: { sales: Money; subscriptions: Money; sales_pct: string | null; subscriptions_pct: string | null };
  series: SeriesPoint[];
  projects: ProjectProfit[];
  other_currencies: Currency[];
  is_estimate: boolean;
}

export type MovementKey = "new" | "reactivation" | "expansion" | "contraction" | "suspension" | "cancellation";

export interface MrrPoint {
  month: string;
  as_of: string;
  mrr: Money;
  arr: Money;
  active_contracts: number;
  previous_mrr: Money;
  growth_pct: string | null;
  is_new_recurring_revenue: boolean;
  movements: Record<MovementKey, { count: number; amount: Money }>;
}

export interface MrrByProject {
  project: string;
  project_name: string;
  mrr: Money;
  arr: Money;
  contracts: number;
  average_per_contract: Money;
}

export interface RecurringSummary {
  currency: Currency;
  as_of: string;
  mrr: Money;
  arr: Money;
  active_contracts: number;
  organizations: number;
  average_per_contract: Money | null;
  suspended_contracts: number;
  suspended_mrr: Money;
  by_project: MrrByProject[];
  previous_month_mrr: Money;
  previous_month_as_of: string;
  growth_pct: string | null;
  is_new_recurring_revenue: boolean;
  recurring_collected: Money;
  recurring_pending: Money;
  sales_collected: Money;
  subscriptions_pct: string | null;
  sales_pct: string | null;
  history: MrrPoint[];
}

export interface ProjectCommercialSummary {
  project: string;
  project_name: string;
  commercial_status: CommercialStatus;
  commercial_status_label: string;
  modalities: ContractKind[];
  end_users_count: number | null;
  currency: Currency;
  date_from: string;
  date_to: string;
  active_contracts: number;
  organizations_with_active_contracts: number;
  collected: Money;
  sales_collected: Money;
  expected: Money;
  overdue_amount: Money;
  overdue_count: number;
  expenses: Money | null;
  expenses_breakdown: Record<string, Money> | null;
  profit: Money | null;
  margin_pct: string | null;
  mrr: Money;
  arr: Money;
  recurring_contracts: number;
  average_per_contract: Money | null;
  growth_pct: string | null;
  is_new_recurring_revenue: boolean;
  suspended_contracts: number;
  series: SeriesPoint[];
  mrr_history: MrrPoint[];
  is_estimate: boolean;
}

export interface Upcoming {
  as_of: string;
  upcoming: Receivable[];
  overdue: Receivable[];
  expiring_contracts: Contract[];
}

type Params = ListParams & Record<string, string | number | boolean | undefined>;

const base = "/commercial";

function clean(params: object): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== null),
  ) as Record<string, string | number | boolean>;
}

export const commercialApi = {
  async applications(params: Params): Promise<Paginated<CommercialApplication>> {
    return (await http.get(`${base}/applications/`, { params: clean(params) })).data;
  },
  async application(id: string): Promise<CommercialApplication> {
    return (await http.get(`${base}/applications/${id}/`)).data;
  },
  async updateProfile(id: string, payload: ProfilePayload): Promise<CommercialApplication> {
    return (await http.patch(`${base}/applications/${id}/profile/`, payload)).data;
  },
  async profitability(id: string, filters: Omit<PeriodFilters, "project">): Promise<ProjectCommercialSummary> {
    return (await http.get(`${base}/applications/${id}/profitability/`, { params: clean(filters) })).data;
  },
  async summary(filters: PeriodFilters): Promise<FinanceSummary> {
    return (await http.get(`${base}/summary/`, { params: clean(filters) })).data;
  },
  async recurring(filters: PeriodFilters): Promise<RecurringSummary> {
    return (await http.get(`${base}/recurring/`, { params: clean(filters) })).data;
  },
  async upcoming(params: { project?: string; days?: number } = {}): Promise<Upcoming> {
    return (await http.get(`${base}/upcoming/`, { params: clean(params) })).data;
  },

  async contracts(params: Params): Promise<Paginated<Contract>> {
    return (await http.get(`${base}/contracts/`, { params: clean(params) })).data;
  },
  async contract(id: string): Promise<ContractDetail> {
    return (await http.get(`${base}/contracts/${id}/`)).data;
  },
  async createContract(payload: ContractPayload): Promise<ContractDetail> {
    return (await http.post(`${base}/contracts/`, payload)).data;
  },
  async updateContract(id: string, payload: ContractUpdatePayload): Promise<ContractDetail> {
    return (await http.patch(`${base}/contracts/${id}/`, payload)).data;
  },
  async transition(
    id: string,
    payload: { to_status: ContractStatus; effective_date?: string | null; reason?: string },
  ): Promise<ContractDetail> {
    return (await http.post(`${base}/contracts/${id}/transition/`, payload)).data;
  },
  async changePrice(id: string, payload: { amount: Money; effective_from: string; reason: string }): Promise<ContractDetail> {
    return (await http.post(`${base}/contracts/${id}/change-price/`, payload)).data;
  },
  async generateReceivable(id: string): Promise<Receivable> {
    return (await http.post(`${base}/contracts/${id}/generate-receivable/`)).data;
  },

  async receivables(params: Params): Promise<Paginated<Receivable>> {
    return (await http.get(`${base}/receivables/`, { params: clean(params) })).data;
  },
  async createReceivable(payload: {
    contract: string;
    concept: string;
    due_date: string;
    expected_amount: Money;
    notes: string;
  }): Promise<Receivable> {
    return (await http.post(`${base}/receivables/`, payload)).data;
  },
  async updateReceivable(
    id: string,
    payload: Partial<{ concept: string; due_date: string; expected_amount: Money; notes: string }>,
  ): Promise<Receivable> {
    return (await http.patch(`${base}/receivables/${id}/`, payload)).data;
  },
  async cancelReceivable(id: string, reason: string): Promise<Receivable> {
    return (await http.post(`${base}/receivables/${id}/cancel/`, { reason })).data;
  },

  async payments(params: Params): Promise<Paginated<Payment>> {
    return (await http.get(`${base}/payments/`, { params: clean(params) })).data;
  },
  async recordPayment(payload: PaymentPayload & { receivable: string }): Promise<Payment> {
    return (await http.post(`${base}/payments/`, payload)).data;
  },
  async reversePayment(id: string, reason: string): Promise<Payment> {
    return (await http.post(`${base}/payments/${id}/reverse/`, { reason })).data;
  },
  async correctPayment(id: string, payload: PaymentPayload & { reason: string }): Promise<Payment> {
    return (await http.post(`${base}/payments/${id}/correct/`, payload)).data;
  },

  async expenses(params: Params): Promise<Paginated<Expense>> {
    return (await http.get(`${base}/expenses/`, { params: clean(params) })).data;
  },
  async createExpense(payload: ExpensePayload): Promise<Expense> {
    return (await http.post(`${base}/expenses/`, payload)).data;
  },
  async updateExpense(id: string, payload: Partial<ExpensePayload>): Promise<Expense> {
    return (await http.patch(`${base}/expenses/${id}/`, payload)).data;
  },
  async voidExpense(id: string, reason: string): Promise<Expense> {
    return (await http.post(`${base}/expenses/${id}/void/`, { reason })).data;
  },
  async setAllocations(id: string, allocations: { project: string; percentage: string }[]): Promise<Expense> {
    return (await http.put(`${base}/expenses/${id}/allocations/`, { allocations })).data;
  },
};
