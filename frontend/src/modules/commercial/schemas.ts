import { z } from "zod";

const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Importe no válido (hasta 2 decimales).")
  .refine((v) => Number(v) > 0, "Debe ser mayor a cero.");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.");
const optionalDay = z.union([day, z.literal("")]);
const reason = z.string().trim().min(3, "Indica el motivo.").max(255, "Máximo 255 caracteres.");

export const profileSchema = z.object({
  status: z.enum(["NOT_COMMERCIAL", "PREPARING", "FOR_SALE", "FOR_RENT", "FOR_SALE_AND_RENT", "SUSPENDED"]),
  notes: z.string().max(4000, "Máximo 4000 caracteres."),
  end_users_count: z.union([z.literal(""), z.string().regex(/^\d+$/, "Número entero.")]),
});
export type ProfileValues = z.infer<typeof profileSchema>;

export const contractSchema = z
  .object({
    project: z.string().min(1, "Selecciona la aplicación."),
    organization: z.string().min(1, "Selecciona la organización."),
    kind: z.enum(["SALE", "SUBSCRIPTION"]),
    amount: money,
    currency: z.enum(["MXN", "USD"]),
    start_date: day,
    end_date: optionalDay,
    billing_period: z.enum(["", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"]),
    terms: z.string().max(8000, "Máximo 8000 caracteres."),
    portal_visible: z.boolean(),
    grants_access: z.boolean(),
  })
  .refine((v) => v.kind === "SALE" || v.billing_period !== "", {
    path: ["billing_period"],
    message: "Selecciona la periodicidad.",
  })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, {
    path: ["end_date"],
    message: "Debe ser posterior al inicio.",
  });
export type ContractValues = z.infer<typeof contractSchema>;

export const transitionSchema = z.object({ effective_date: day, reason: z.string().max(255) });
export type TransitionValues = z.infer<typeof transitionSchema>;

export const priceSchema = z.object({ amount: money, effective_from: day, reason: z.string().max(255) });
export type PriceValues = z.infer<typeof priceSchema>;

export const receivableSchema = z.object({
  concept: z.string().trim().min(2, "Indica el concepto.").max(120),
  due_date: day,
  expected_amount: money,
  notes: z.string().max(4000),
});
export type ReceivableValues = z.infer<typeof receivableSchema>;

export const paymentSchema = z.object({
  amount: money,
  paid_on: day,
  method: z.enum(["TRANSFER", "DEPOSIT", "CARD", "CASH", "OTHER"]),
  reference: z.string().trim().max(80, "Máximo 80 caracteres."),
  notes: z.string().max(4000),
});
export type PaymentValues = z.infer<typeof paymentSchema>;

export const correctionSchema = paymentSchema.extend({ reason });
export type CorrectionValues = z.infer<typeof correctionSchema>;

export const reasonSchema = z.object({ reason });
export type ReasonValues = z.infer<typeof reasonSchema>;

export const expenseSchema = z
  .object({
    concept: z.string().trim().min(2, "Indica el concepto.").max(150),
    category: z.enum([
      "HOSTING",
      "ELECTRICITY",
      "INTERNET",
      "DOMAINS",
      "SERVERS",
      "MAINTENANCE",
      "EXTERNAL_SERVICES",
      "LICENSES",
      "OTHER",
    ]),
    amount: money,
    currency: z.enum(["MXN", "USD"]),
    incurred_on: day,
    project: z.string(),
    kind: z.enum(["ONE_TIME", "RECURRING"]),
    recurrence: z.enum(["", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"]),
    notes: z.string().max(4000),
  })
  .refine((v) => v.kind === "ONE_TIME" || v.recurrence !== "", {
    path: ["recurrence"],
    message: "Selecciona la periodicidad.",
  });
export type ExpenseValues = z.infer<typeof expenseSchema>;
