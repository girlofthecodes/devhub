import type { BadgeTone } from "@/components/ui/Badge";

import type {
  BillingPeriod,
  CommercialStatus,
  ContractKind,
  ContractStatus,
  Currency,
  ExpenseCategory,
  ExpenseKind,
  MovementKey,
  PaymentMethod,
  ReceivableStatus,
} from "./api";

export const COMMERCIAL_STATUS_OPTIONS: { value: CommercialStatus; label: string; tone: BadgeTone }[] = [
  { value: "NOT_COMMERCIAL", label: "No comercializable", tone: "neutral" },
  { value: "PREPARING", label: "En preparación comercial", tone: "info" },
  { value: "FOR_SALE", label: "Disponible para venta", tone: "success" },
  { value: "FOR_RENT", label: "Disponible para renta", tone: "success" },
  { value: "FOR_SALE_AND_RENT", label: "Disponible para venta y renta", tone: "success" },
  { value: "SUSPENDED", label: "Comercialización suspendida", tone: "warning" },
];

export const commercialTone = (s: CommercialStatus): BadgeTone =>
  COMMERCIAL_STATUS_OPTIONS.find((o) => o.value === s)?.tone ?? "neutral";

export const KIND_LABEL: Record<ContractKind, string> = { SALE: "Venta única", SUBSCRIPTION: "Renta / suscripción" };
export const KIND_SHORT: Record<ContractKind, string> = { SALE: "Venta", SUBSCRIPTION: "Renta" };

export const CONTRACT_STATUS: Record<ContractStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Borrador", tone: "neutral" },
  PENDING: { label: "Pendiente", tone: "info" },
  ACTIVE: { label: "Activo", tone: "success" },
  SUSPENDED: { label: "Suspendido", tone: "warning" },
  FINISHED: { label: "Finalizado", tone: "neutral" },
  CANCELLED: { label: "Cancelado", tone: "danger" },
};

/** Allowed transitions (the server enforces the same table). */
export const TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  DRAFT: ["PENDING", "ACTIVE", "CANCELLED"],
  PENDING: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "FINISHED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "FINISHED", "CANCELLED"],
  FINISHED: [],
  CANCELLED: [],
};

export const TRANSITION_LABEL: Record<ContractStatus, string> = {
  DRAFT: "Borrador",
  PENDING: "Marcar pendiente",
  ACTIVE: "Activar",
  SUSPENDED: "Suspender",
  FINISHED: "Finalizar",
  CANCELLED: "Cancelar contrato",
};

export const PERIOD_OPTIONS: { value: BillingPeriod; label: string; months: number }[] = [
  { value: "MONTHLY", label: "Mensual", months: 1 },
  { value: "QUARTERLY", label: "Trimestral", months: 3 },
  { value: "SEMIANNUAL", label: "Semestral", months: 6 },
  { value: "ANNUAL", label: "Anual", months: 12 },
];

export const RECEIVABLE_STATUS: Record<ReceivableStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "Pendiente", tone: "info" },
  PARTIAL: { label: "Parcial", tone: "warning" },
  PAID: { label: "Pagado", tone: "success" },
  OVERDUE: { label: "Vencido", tone: "danger" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
};

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "TRANSFER", label: "Transferencia" },
  { value: "DEPOSIT", label: "Depósito" },
  { value: "CARD", label: "Tarjeta" },
  { value: "CASH", label: "Efectivo" },
  { value: "OTHER", label: "Otro" },
];

export const EXPENSE_CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] = [
  { value: "HOSTING", label: "Hosting" },
  { value: "ELECTRICITY", label: "Electricidad" },
  { value: "INTERNET", label: "Internet" },
  { value: "DOMAINS", label: "Dominios" },
  { value: "SERVERS", label: "Servidores" },
  { value: "MAINTENANCE", label: "Mantenimiento" },
  { value: "EXTERNAL_SERVICES", label: "Servicios externos" },
  { value: "LICENSES", label: "Licencias" },
  { value: "OTHER", label: "Otros gastos" },
];

export const EXPENSE_KIND_LABEL: Record<ExpenseKind, string> = { ONE_TIME: "Único", RECURRING: "Recurrente" };

export const CURRENCY_OPTIONS: { value: Currency; label: string }[] = [
  { value: "MXN", label: "MXN — Peso mexicano" },
  { value: "USD", label: "USD — Dólar" },
];

export const MOVEMENT_LABEL: Record<MovementKey, string> = {
  new: "Nuevas suscripciones",
  reactivation: "Reactivaciones",
  expansion: "Incrementos de precio",
  contraction: "Reducciones de precio",
  suspension: "Suspensiones",
  cancellation: "Cancelaciones",
};

export const ESTIMATE_NOTE =
  "La ganancia es una estimación operativa con los datos registrados (cobrado − gastos); no es utilidad contable ni fiscal.";
