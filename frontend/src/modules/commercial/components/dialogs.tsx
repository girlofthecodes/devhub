import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useOrganizations } from "@/modules/organizations/hooks";
import { applyApiErrors, errorMessage } from "@/utils/forms";
import { formatMoney, toIsoDay } from "@/utils/format";

import type {
  CommercialApplication,
  Contract,
  ContractDetail,
  ContractStatus,
  Expense,
  Payment,
  Receivable,
} from "../api";
import {
  COMMERCIAL_STATUS_OPTIONS,
  CONTRACT_STATUS,
  CURRENCY_OPTIONS,
  EXPENSE_CATEGORY_OPTIONS,
  KIND_LABEL,
  PAYMENT_METHOD_OPTIONS,
  PERIOD_OPTIONS,
  TRANSITION_LABEL,
} from "../constants";
import {
  useApplicationOptions,
  useChangePrice,
  useCorrectPayment,
  useCreateContract,
  useCreateExpense,
  useCreateReceivable,
  useRecordPayment,
  useSetAllocations,
  useTransition,
  useUpdateContract,
  useUpdateExpense,
  useUpdateProfile,
} from "../hooks";
import {
  contractSchema,
  correctionSchema,
  expenseSchema,
  paymentSchema,
  priceSchema,
  profileSchema,
  reasonSchema,
  receivableSchema,
  transitionSchema,
  type ContractValues,
  type CorrectionValues,
  type ExpenseValues,
  type PaymentValues,
  type PriceValues,
  type ProfileValues,
  type ReasonValues,
  type ReceivableValues,
  type TransitionValues,
} from "../schemas";

const today = () => toIsoDay(new Date());

function FormFooter({ formId, onClose, busy, label, disabled }: { formId: string; onClose: () => void; busy: boolean; label: string; disabled?: boolean }) {
  return (
    <>
      <Button variant="outline" onClick={onClose} disabled={busy}>
        Cancelar
      </Button>
      <Button type="submit" form={formId} loading={busy} disabled={disabled}>
        {label}
      </Button>
    </>
  );
}

function Check({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-fg">
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" {...props} />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

// --- commercial profile ------------------------------------------------------------------

export function ProfileDialog({ app, onClose }: { app: CommercialApplication | null; onClose: () => void }) {
  return app ? <ProfileForm key={app.id} app={app} onClose={onClose} /> : null;
}

function ProfileForm({ app, onClose }: { app: CommercialApplication; onClose: () => void }) {
  const update = useUpdateProfile();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isDirty } } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      status: app.commercial_status,
      notes: app.notes,
      end_users_count: app.end_users_count === null ? "" : String(app.end_users_count),
    },
  });
  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    update.mutate(
      { id: app.id, payload: { status: v.status, notes: v.notes, end_users_count: v.end_users_count === "" ? null : Number(v.end_users_count) } },
      {
        onSuccess: () => {
          toast.success("Estado comercial actualizado", app.name);
          onClose();
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, ["status", "notes", "end_users_count"])),
      },
    );
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Configuración comercial"
      description={`${app.name} · estado técnico: ${app.project_status_label}`}
      busy={update.isPending}
      footer={<FormFooter formId="profile-form" onClose={onClose} busy={update.isPending} label="Guardar" disabled={!isDirty} />}
    >
      <form id="profile-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Estado comercial" required error={errors.status?.message} hint="Independiente del estado técnico del proyecto.">
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} data-autofocus {...register("status")}>
              {COMMERCIAL_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Usuarios finales (informativo)"
          error={errors.end_users_count?.message}
          hint="Dato manual de referencia; no se usa en ningún cálculo y no equivale a organizaciones ni contratos."
        >
          {({ id, invalid, describedBy }) => (
            <Input id={id} inputMode="numeric" invalid={invalid} aria-describedby={describedBy} {...register("end_users_count")} />
          )}
        </Field>
        <Field label="Notas comerciales" error={errors.notes?.message}>
          {({ id, invalid }) => <Textarea id={id} rows={3} invalid={invalid} {...register("notes")} />}
        </Field>
      </form>
    </Modal>
  );
}

// --- contracts -----------------------------------------------------------------------------

const CONTRACT_FIELDS = [
  "project",
  "organization",
  "kind",
  "amount",
  "currency",
  "start_date",
  "end_date",
  "billing_period",
  "terms",
  "portal_visible",
  "grants_access",
] as const;

interface ContractDialogProps {
  open: boolean;
  onClose: () => void;
  /** Edit an existing contract (only the fields its status allows). */
  contract?: ContractDetail;
  /** Pre-selected project (from the project page). */
  project?: { id: string; name: string };
  onCreated?: (c: ContractDetail) => void;
}

export function ContractFormDialog(props: ContractDialogProps) {
  if (!props.open) return null;
  return <ContractForm key={props.contract?.id ?? props.project?.id ?? "new"} {...props} />;
}

function ContractForm({ onClose, contract, project, onCreated }: ContractDialogProps) {
  const editing = Boolean(contract);
  const create = useCreateContract();
  const update = useUpdateContract();
  const busy = create.isPending || update.isPending;
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const apps = useApplicationOptions();
  const orgs = useOrganizations({ is_active: true, page_size: 100 });
  const draft = !contract || contract.status === "DRAFT" || contract.status === "PENDING";
  const closed = contract?.status === "FINISHED" || contract?.status === "CANCELLED";

  const { register, control, handleSubmit, setError, formState: { errors, isDirty, dirtyFields } } = useForm<ContractValues>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      project: contract?.project ?? project?.id ?? "",
      organization: contract?.organization ?? "",
      kind: contract?.kind ?? "SUBSCRIPTION",
      amount: contract?.amount ?? "",
      currency: contract?.currency ?? "MXN",
      start_date: contract?.start_date ?? today(),
      end_date: contract?.end_date ?? "",
      billing_period: contract?.billing_period ?? "MONTHLY",
      terms: contract?.terms ?? "",
      portal_visible: contract?.portal_visible ?? false,
      grants_access: contract?.grants_access ?? true,
    },
  });
  const kind = useWatch({ control, name: "kind" });
  const selectedProject = useWatch({ control, name: "project" });
  const selectedApp = apps.data?.results.find((a) => a.id === selectedProject);

  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    const onError = (e: unknown) => setFormError(applyApiErrors(e, setError, CONTRACT_FIELDS));
    const payload = {
      ...v,
      billing_period: v.kind === "SALE" ? ("" as const) : v.billing_period,
      end_date: v.end_date || null,
    };
    if (contract) {
      // Send only what changed (the server rejects fields the status does not allow).
      const changed = Object.fromEntries(
        Object.entries(payload).filter(([k]) => dirtyFields[k as keyof ContractValues]),
      );
      update.mutate(
        { id: contract.id, payload: changed },
        { onSuccess: () => { toast.success("Contrato actualizado"); onClose(); }, onError },
      );
    } else {
      create.mutate(payload, {
        onSuccess: (c) => {
          toast.success("Contrato registrado en borrador", `${c.project_name} · ${c.organization_name}`);
          onCreated?.(c);
          onClose();
        },
        onError,
      });
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={editing ? "Editar contrato" : kind === "SALE" ? "Registrar venta" : "Registrar renta"}
      description={
        editing
          ? `${contract!.project_name} · ${contract!.organization_name} · ${CONTRACT_STATUS[contract!.status].label}`
          : "Se crea en borrador: no concede acceso al portal hasta activarse."
      }
      busy={busy}
      footer={<FormFooter formId="contract-form" onClose={onClose} busy={busy} label={editing ? "Guardar cambios" : "Registrar"} disabled={editing && !isDirty} />}
    >
      <form id="contract-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        {editing && !draft && (
          <Alert tone="info">
            El contrato ya está {CONTRACT_STATUS[contract!.status].label.toLowerCase()}: el importe se cambia con «Cambiar
            precio» (conserva el historial) y el estado con las acciones del contrato.
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Aplicación" required error={errors.project?.message}>
            {({ id, invalid }) =>
              editing || project ? (
                <Input id={id} value={contract?.project_name ?? project?.name ?? ""} disabled readOnly />
              ) : (
                <Select id={id} invalid={invalid} data-autofocus {...register("project")}>
                  <option value="">Selecciona…</option>
                  {apps.data?.results.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.modalities.length === 0}>
                      {a.name} {a.modalities.length === 0 ? `(${a.commercial_status_label})` : ""}
                    </option>
                  ))}
                </Select>
              )
            }
          </Field>
          <Field label="Organización cliente" required error={errors.organization?.message}>
            {({ id, invalid }) =>
              editing ? (
                <Input id={id} value={contract!.organization_name} disabled readOnly />
              ) : (
                <Select id={id} invalid={invalid} {...register("organization")}>
                  <option value="">Selecciona…</option>
                  {orgs.data?.results.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              )
            }
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Modelo comercial" required error={errors.kind?.message}>
            {({ id }) => (
              <Select id={id} disabled={editing} {...register("kind")}>
                {(["SUBSCRIPTION", "SALE"] as const).map((k) => (
                  <option key={k} value={k} disabled={selectedApp ? !selectedApp.modalities.includes(k) : false}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={kind === "SALE" ? "Importe de la venta" : "Importe por periodo"} required error={errors.amount?.message}>
            {({ id, invalid }) => <Input id={id} inputMode="decimal" placeholder="0.00" invalid={invalid} disabled={!draft} {...register("amount")} />}
          </Field>
          <Field label="Moneda" required error={errors.currency?.message}>
            {({ id }) => (
              <Select id={id} disabled={!draft} {...register("currency")}>
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={kind === "SALE" ? "Fecha de venta" : "Inicio"} required error={errors.start_date?.message}>
            {({ id, invalid }) => <Input id={id} type="date" invalid={invalid} disabled={!draft} {...register("start_date")} />}
          </Field>
          <Field label="Finalización" error={errors.end_date?.message} hint="Opcional.">
            {({ id, invalid, describedBy }) => <Input id={id} type="date" invalid={invalid} aria-describedby={describedBy} disabled={closed} {...register("end_date")} />}
          </Field>
          {kind === "SUBSCRIPTION" && (
            <Field label="Periodicidad" required error={errors.billing_period?.message}>
              {({ id, invalid }) => (
                <Select id={id} invalid={invalid} disabled={!draft} {...register("billing_period")}>
                  {PERIOD_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <Field label="Condiciones comerciales" error={errors.terms?.message} hint="Alcance, soporte, propiedad intelectual (una venta no implica transferir el código).">
          {({ id, invalid, describedBy }) => <Textarea id={id} rows={3} invalid={invalid} aria-describedby={describedBy} {...register("terms")} />}
        </Field>
        <div className="space-y-3 rounded-lg border border-border bg-surface-2/50 p-4">
          <Check
            label="Habilita acceso al portal"
            hint="Al activarse concede acceso a la aplicación a la organización; se revoca al cancelarse o finalizar. Suspender no lo revoca."
            disabled={closed}
            {...register("grants_access")}
          />
          <Check
            label="Visible en el portal del cliente"
            hint="La organización verá modalidad, vigencia y próximo vencimiento (nunca importes ni costos)."
            {...register("portal_visible")}
          />
        </div>
      </form>
    </Modal>
  );
}

export function TransitionDialog({
  contract,
  to,
  onClose,
}: {
  contract: Contract | null;
  to: ContractStatus | null;
  onClose: () => void;
}) {
  return contract && to ? <TransitionForm key={`${contract.id}-${to}`} contract={contract} to={to} onClose={onClose} /> : null;
}

const TRANSITION_HELP: Partial<Record<ContractStatus, string>> = {
  ACTIVE: "Desde esta fecha cuenta como contrato activo (y en MRR si es renta). Si habilita acceso, se concede el acceso al portal.",
  SUSPENDED: "Deja de contar en el MRR mientras esté suspendido. No revoca el acceso al portal.",
  FINISHED: "Cierra el contrato: revoca el acceso que concedió y cancela los cobros futuros sin pagos.",
  CANCELLED: "Cierra el contrato definitivamente: revoca el acceso que concedió y cancela los cobros futuros sin pagos.",
  PENDING: "Pendiente de firma o de pago inicial. Aún no cuenta como activo.",
};

function TransitionForm({ contract, to, onClose }: { contract: Contract; to: ContractStatus; onClose: () => void }) {
  const transition = useTransition();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<TransitionValues>({
    resolver: zodResolver(transitionSchema),
    defaultValues: { effective_date: today(), reason: "" },
  });
  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    transition.mutate(
      { id: contract.id, payload: { to_status: to, effective_date: v.effective_date, reason: v.reason } },
      {
        onSuccess: (c) => {
          toast.success(`Contrato ${c.status_label.toLowerCase()}`);
          onClose();
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, ["effective_date", "reason"])),
      },
    );
  });
  const danger = to === "CANCELLED" || to === "FINISHED";
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={TRANSITION_LABEL[to]}
      description={`${contract.project_name} · ${contract.organization_name}`}
      busy={transition.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={transition.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="transition-form" variant={danger ? "danger" : "primary"} loading={transition.isPending}>
            {TRANSITION_LABEL[to]}
          </Button>
        </>
      }
    >
      <form id="transition-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        {TRANSITION_HELP[to] && <p className="text-sm text-muted">{TRANSITION_HELP[to]}</p>}
        <Field label="Fecha efectiva" required error={errors.effective_date?.message} hint="No puede ser futura ni anterior al último cambio de estado.">
          {({ id, invalid, describedBy }) => <Input id={id} type="date" max={today()} invalid={invalid} aria-describedby={describedBy} {...register("effective_date")} />}
        </Field>
        <Field label="Motivo" required={to === "CANCELLED"} error={errors.reason?.message}>
          {({ id, invalid }) => <Input id={id} invalid={invalid} data-autofocus {...register("reason")} />}
        </Field>
      </form>
    </Modal>
  );
}

export function PriceChangeDialog({ contract, onClose }: { contract: Contract | null; onClose: () => void }) {
  return contract ? <PriceForm key={contract.id} contract={contract} onClose={onClose} /> : null;
}

function PriceForm({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const change = useChangePrice();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<PriceValues>({
    resolver: zodResolver(priceSchema),
    defaultValues: { amount: "", effective_from: today(), reason: "" },
  });
  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    change.mutate(
      { id: contract.id, payload: v },
      {
        onSuccess: () => {
          toast.success("Nuevo precio registrado");
          onClose();
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, ["amount", "effective_from", "reason"])),
      },
    );
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Cambiar precio"
      description={`Precio vigente: ${formatMoney(contract.amount, contract.currency)} ${contract.billing_period_label.toLowerCase()}`}
      busy={change.isPending}
      footer={<FormFooter formId="price-form" onClose={onClose} busy={change.isPending} label="Registrar precio" />}
    >
      <form id="price-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <p className="text-sm text-muted">
          El precio anterior se conserva en el historial: los meses pasados no cambian. Solo puede aplicar desde hoy o
          una fecha futura.
        </p>
        <Field label="Nuevo importe por periodo" required error={errors.amount?.message}>
          {({ id, invalid }) => <Input id={id} inputMode="decimal" invalid={invalid} data-autofocus {...register("amount")} />}
        </Field>
        <Field label="Vigente desde" required error={errors.effective_from?.message}>
          {({ id, invalid }) => <Input id={id} type="date" min={today()} invalid={invalid} {...register("effective_from")} />}
        </Field>
        <Field label="Motivo" error={errors.reason?.message}>
          {({ id, invalid }) => <Input id={id} invalid={invalid} {...register("reason")} />}
        </Field>
      </form>
    </Modal>
  );
}

// --- receivables & payments ----------------------------------------------------------------

export function InstallmentDialog({ contract, onClose }: { contract: ContractDetail | null; onClose: () => void }) {
  return contract ? <InstallmentForm key={contract.id} contract={contract} onClose={onClose} /> : null;
}

function InstallmentForm({ contract, onClose }: { contract: ContractDetail; onClose: () => void }) {
  const create = useCreateReceivable();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const remaining = Number(contract.amount ?? 0) - Number(contract.totals.expected);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<ReceivableValues>({
    resolver: zodResolver(receivableSchema),
    defaultValues: {
      concept: Number(contract.totals.expected) === 0 ? "Pago único" : "",
      due_date: today(),
      expected_amount: remaining > 0 ? remaining.toFixed(2) : "",
      notes: "",
    },
  });
  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    create.mutate(
      { contract: contract.id, ...v },
      {
        onSuccess: () => {
          toast.success("Cobro programado");
          onClose();
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, ["concept", "due_date", "expected_amount", "notes"])),
      },
    );
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Programar cobro de la venta"
      description={`Por programar: ${formatMoney(remaining, contract.currency)} de ${formatMoney(contract.amount, contract.currency)}`}
      busy={create.isPending}
      footer={<FormFooter formId="installment-form" onClose={onClose} busy={create.isPending} label="Programar" />}
    >
      <form id="installment-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Concepto" required error={errors.concept?.message}>
          {({ id, invalid }) => <Input id={id} invalid={invalid} data-autofocus placeholder="Anticipo, finiquito…" {...register("concept")} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Importe esperado" required error={errors.expected_amount?.message}>
            {({ id, invalid }) => <Input id={id} inputMode="decimal" invalid={invalid} {...register("expected_amount")} />}
          </Field>
          <Field label="Vencimiento" required error={errors.due_date?.message}>
            {({ id, invalid }) => <Input id={id} type="date" invalid={invalid} {...register("due_date")} />}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

const PAYMENT_FIELDS = ["amount", "paid_on", "method", "reference", "notes"] as const;

function PaymentFields({ register, errors }: { register: ReturnType<typeof useForm<PaymentValues>>["register"]; errors: Partial<Record<keyof PaymentValues, { message?: string }>> }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Importe cobrado" required error={errors.amount?.message}>
          {({ id, invalid }) => <Input id={id} inputMode="decimal" invalid={invalid} data-autofocus {...register("amount")} />}
        </Field>
        <Field label="Fecha de pago" required error={errors.paid_on?.message}>
          {({ id, invalid }) => <Input id={id} type="date" max={today()} invalid={invalid} {...register("paid_on")} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Método" required error={errors.method?.message}>
          {({ id }) => (
            <Select id={id} {...register("method")}>
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Referencia" error={errors.reference?.message} hint="Folio o clave de rastreo; evita registrar dos veces el mismo pago.">
          {({ id, invalid, describedBy }) => <Input id={id} invalid={invalid} aria-describedby={describedBy} {...register("reference")} />}
        </Field>
      </div>
      <Field label="Observaciones" error={errors.notes?.message}>
        {({ id }) => <Textarea id={id} rows={2} {...register("notes")} />}
      </Field>
    </>
  );
}

export function PaymentDialog({ receivable, onClose }: { receivable: Receivable | null; onClose: () => void }) {
  return receivable ? <PaymentForm key={receivable.id} receivable={receivable} onClose={onClose} /> : null;
}

function PaymentForm({ receivable, onClose }: { receivable: Receivable; onClose: () => void }) {
  const record = useRecordPayment();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: receivable.outstanding_amount, paid_on: today(), method: "TRANSFER", reference: "", notes: "" },
  });
  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    record.mutate(
      { receivable: receivable.id, ...v },
      {
        onSuccess: (p) => {
          toast.success("Pago registrado", formatMoney(p.amount, p.currency));
          onClose();
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, PAYMENT_FIELDS)),
      },
    );
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar pago"
      description={`${receivable.concept} · saldo ${formatMoney(receivable.outstanding_amount, receivable.currency)} de ${formatMoney(receivable.expected_amount, receivable.currency)}`}
      busy={record.isPending}
      footer={<FormFooter formId="payment-form" onClose={onClose} busy={record.isPending} label="Registrar pago" />}
    >
      <form id="payment-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <PaymentFields register={register} errors={errors} />
      </form>
    </Modal>
  );
}

export function CorrectPaymentDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  return payment ? <CorrectForm key={payment.id} payment={payment} onClose={onClose} /> : null;
}

function CorrectForm({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const correct = useCorrectPayment();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<CorrectionValues>({
    resolver: zodResolver(correctionSchema),
    defaultValues: {
      amount: payment.amount,
      paid_on: payment.paid_on,
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      reason: "",
    },
  });
  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    correct.mutate(
      { id: payment.id, payload: v },
      {
        onSuccess: () => {
          toast.success("Pago corregido", "El original queda revertido en el historial.");
          onClose();
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, [...PAYMENT_FIELDS, "reason"])),
      },
    );
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Corregir pago"
      description="El pago original se revierte (no se borra) y se registra el pago corregido, vinculado a él."
      busy={correct.isPending}
      footer={<FormFooter formId="correct-form" onClose={onClose} busy={correct.isPending} label="Corregir" />}
    >
      <form id="correct-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Motivo de la corrección" required error={errors.reason?.message}>
          {({ id, invalid }) => <Input id={id} invalid={invalid} {...register("reason")} />}
        </Field>
        <PaymentFields
          register={register as unknown as ReturnType<typeof useForm<PaymentValues>>["register"]}
          errors={errors}
        />
      </form>
    </Modal>
  );
}

/** Asks for a mandatory reason (reversals, cancellations and voids are always justified). */
export function ReasonDialog({
  open,
  title,
  message,
  confirmLabel,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  loading: boolean;
  onConfirm: (reason: string, fail: (e: unknown) => void) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return <ReasonForm title={title} message={message} confirmLabel={confirmLabel} loading={loading} onConfirm={onConfirm} onClose={onClose} />;
}

function ReasonForm({
  title,
  message,
  confirmLabel,
  loading,
  onConfirm,
  onClose,
}: Omit<Parameters<typeof ReasonDialog>[0], "open">) {
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<ReasonValues>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: "" },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={title}
      busy={loading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" form="reason-form" variant="danger" loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id="reason-form"
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((v) => {
          setFormError(null);
          onConfirm(v.reason, (e) => setFormError(applyApiErrors(e, setError, ["reason"]) ?? errorMessage(e)));
        })}
      >
        {formError && <Alert>{formError}</Alert>}
        <p className="text-sm text-muted">{message}</p>
        <Field label="Motivo" required error={errors.reason?.message}>
          {({ id, invalid }) => <Input id={id} invalid={invalid} data-autofocus {...register("reason")} />}
        </Field>
      </form>
    </Modal>
  );
}

// --- expenses ------------------------------------------------------------------------------

const EXPENSE_FIELDS = ["concept", "category", "amount", "currency", "incurred_on", "project", "kind", "recurrence", "notes"] as const;

export function ExpenseFormDialog({ open, expense, project, onClose }: { open: boolean; expense?: Expense; project?: { id: string; name: string }; onClose: () => void }) {
  if (!open) return null;
  return <ExpenseForm key={expense?.id ?? "new"} expense={expense} project={project} onClose={onClose} />;
}

function ExpenseForm({ expense, project, onClose }: { expense?: Expense; project?: { id: string; name: string }; onClose: () => void }) {
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const busy = create.isPending || update.isPending;
  const toast = useToast();
  const apps = useApplicationOptions(!project);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, formState: { errors, isDirty, dirtyFields } } = useForm<ExpenseValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      concept: expense?.concept ?? "",
      category: expense?.category ?? "HOSTING",
      amount: expense?.amount ?? "",
      currency: expense?.currency ?? "MXN",
      incurred_on: expense?.incurred_on ?? today(),
      project: expense?.project ?? project?.id ?? "",
      kind: expense?.kind ?? "ONE_TIME",
      recurrence: expense?.recurrence ?? "",
      notes: expense?.notes ?? "",
    },
  });
  const kind = useWatch({ control, name: "kind" });
  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    const payload = { ...v, project: v.project || null, recurrence: v.kind === "ONE_TIME" ? ("" as const) : v.recurrence };
    const onError = (e: unknown) => setFormError(applyApiErrors(e, setError, EXPENSE_FIELDS));
    if (expense) {
      const changed = Object.fromEntries(Object.entries(payload).filter(([k]) => dirtyFields[k as keyof ExpenseValues] || (k === "recurrence" && dirtyFields.kind)));
      update.mutate({ id: expense.id, payload: changed }, { onSuccess: () => { toast.success("Gasto actualizado"); onClose(); }, onError });
    } else {
      create.mutate(payload, { onSuccess: () => { toast.success("Gasto registrado"); onClose(); }, onError });
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={expense ? "Editar gasto" : "Registrar gasto"}
      description="Se reconoce en la fecha indicada. Los gastos recurrentes se registran en cada ocurrencia."
      busy={busy}
      footer={<FormFooter formId="expense-form" onClose={onClose} busy={busy} label={expense ? "Guardar cambios" : "Registrar"} disabled={Boolean(expense) && !isDirty} />}
    >
      <form id="expense-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Concepto" required error={errors.concept?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} data-autofocus {...register("concept")} />}
          </Field>
          <Field label="Categoría" required error={errors.category?.message}>
            {({ id }) => (
              <Select id={id} {...register("category")}>
                {EXPENSE_CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Importe" required error={errors.amount?.message}>
            {({ id, invalid }) => <Input id={id} inputMode="decimal" invalid={invalid} {...register("amount")} />}
          </Field>
          <Field label="Moneda" required>
            {({ id }) => (
              <Select id={id} {...register("currency")}>
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Fecha" required error={errors.incurred_on?.message}>
            {({ id, invalid }) => <Input id={id} type="date" invalid={invalid} {...register("incurred_on")} />}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Aplicación" error={errors.project?.message} hint="Vacío = gasto general (infraestructura compartida).">
            {({ id, describedBy }) =>
              project ? (
                <Input id={id} value={project.name} disabled readOnly />
              ) : (
                <Select id={id} aria-describedby={describedBy} {...register("project")}>
                  <option value="">Gasto general</option>
                  {apps.data?.results.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )
            }
          </Field>
          <Field label="Tipo" required>
            {({ id }) => (
              <Select id={id} {...register("kind")}>
                <option value="ONE_TIME">Único</option>
                <option value="RECURRING">Recurrente</option>
              </Select>
            )}
          </Field>
          {kind === "RECURRING" && (
            <Field label="Periodicidad" required error={errors.recurrence?.message}>
              {({ id, invalid }) => (
                <Select id={id} invalid={invalid} {...register("recurrence")}>
                  <option value="">Selecciona…</option>
                  {PERIOD_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <Field label="Observaciones" error={errors.notes?.message}>
          {({ id }) => <Textarea id={id} rows={2} {...register("notes")} />}
        </Field>
      </form>
    </Modal>
  );
}

export function AllocationsDialog({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  return expense ? <AllocationsForm key={expense.id} expense={expense} onClose={onClose} /> : null;
}

function AllocationsForm({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const save = useSetAllocations();
  const apps = useApplicationOptions();
  const toast = useToast();
  const [rows, setRows] = useState(expense.allocations.map((a) => ({ project: a.project, percentage: a.percentage })));
  const [formError, setFormError] = useState<string | null>(null);
  const total = rows.reduce((s, r) => s + (Number(r.percentage) || 0), 0);
  const invalid = rows.some((r) => !r.project || !(Number(r.percentage) > 0)) || total > 100;
  const used = new Set(rows.map((r) => r.project));
  return (
    <Modal
      open
      onClose={onClose}
      title="Distribuir gasto general"
      description={`${expense.concept} · ${formatMoney(expense.amount, expense.currency)}`}
      busy={save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button
            loading={save.isPending}
            disabled={invalid}
            onClick={() => {
              setFormError(null);
              save.mutate(
                { id: expense.id, allocations: rows },
                {
                  onSuccess: () => {
                    toast.success("Distribución guardada");
                    onClose();
                  },
                  onError: (e) => setFormError(errorMessage(e)),
                },
              );
            }}
          >
            Guardar distribución
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <p className="text-sm text-muted">
          Asigna a cada aplicación un porcentaje para su rentabilidad. El total del portafolio cuenta el gasto una sola
          vez; lo no asignado queda como gasto general.
        </p>
        {rows.length === 0 && <p className="text-sm italic text-muted">Sin distribución: el gasto solo cuenta a nivel portafolio.</p>}
        {rows.map((row, i) => (
          <div key={i} className="flex items-end gap-2">
            <label className="flex-1 text-xs font-medium text-muted">
              Aplicación
              <Select
                className="mt-1"
                value={row.project}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, project: e.target.value } : r)))}
              >
                <option value="">Selecciona…</option>
                {apps.data?.results.map((a) => (
                  <option key={a.id} value={a.id} disabled={used.has(a.id) && a.id !== row.project}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="w-28 text-xs font-medium text-muted">
              %
              <Input
                className="mt-1"
                inputMode="decimal"
                value={row.percentage}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, percentage: e.target.value } : r)))}
              />
            </label>
            <span className="w-28 pb-2 text-right text-sm tabular-nums text-muted">
              {formatMoney((Number(expense.amount) * (Number(row.percentage) || 0)) / 100, expense.currency)}
            </span>
            <Button variant="ghost" size="icon" aria-label="Quitar" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" icon={<Plus className="size-4" />} onClick={() => setRows([...rows, { project: "", percentage: "" }])}>
            Agregar aplicación
          </Button>
          <span className={total > 100 ? "text-sm font-medium text-red-600" : "text-sm text-muted"}>
            Asignado: {total.toLocaleString("es-MX", { maximumFractionDigits: 2 })} % · sin asignar{" "}
            {Math.max(0, 100 - total).toLocaleString("es-MX", { maximumFractionDigits: 2 })} %
          </span>
        </div>
      </div>
    </Modal>
  );
}
