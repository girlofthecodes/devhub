import { Banknote, Pencil, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Feedback";
import { DataTable, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatDay, formatMoney } from "@/utils/format";

import type { Contract, Payment, Receivable } from "../api";
import { CONTRACT_STATUS, KIND_SHORT, RECEIVABLE_STATUS } from "../constants";
import { useCancelReceivable, useFinanceAccess, useReversePayment } from "../hooks";
import { CorrectPaymentDialog, PaymentDialog, ReasonDialog } from "./dialogs";

export function ContractStatusBadge({ status }: { status: Contract["status"] }) {
  return (
    <Badge tone={CONTRACT_STATUS[status].tone} dot>
      {CONTRACT_STATUS[status].label}
    </Badge>
  );
}

export function ReceivableStatusBadge({ status }: { status: Receivable["effective_status"] }) {
  return (
    <Badge tone={RECEIVABLE_STATUS[status].tone} dot>
      {RECEIVABLE_STATUS[status].label}
    </Badge>
  );
}

export function ContractsTable({
  rows,
  loading,
  error,
  onRetry,
  hideProject = false,
  empty,
}: {
  rows: Contract[] | undefined;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  hideProject?: boolean;
  empty?: string;
}) {
  const navigate = useNavigate();
  const columns: Column<Contract>[] = [
    ...(hideProject
      ? []
      : [{ key: "project", header: "Aplicación", cell: (c: Contract) => <span className="font-medium text-fg">{c.project_name}</span> }]),
    { key: "org", header: "Organización", cell: (c) => <span className={hideProject ? "font-medium text-fg" : "text-fg"}>{c.organization_name}</span> },
    {
      key: "kind",
      header: "Modelo",
      cell: (c) => (
        <span className="text-muted">
          {KIND_SHORT[c.kind]}
          {c.billing_period_label && ` · ${c.billing_period_label.toLowerCase()}`}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Importe",
      className: "text-right tabular-nums",
      cell: (c) => (
        <span>
          {formatMoney(c.amount, c.currency)}
          {c.monthly_value && c.billing_period !== "MONTHLY" && (
            <span className="block text-xs text-muted">{formatMoney(c.monthly_value, c.currency)} / mes</span>
          )}
        </span>
      ),
    },
    { key: "status", header: "Estado", cell: (c) => <ContractStatusBadge status={c.status} /> },
    {
      key: "dates",
      header: "Vigencia",
      hideOnMobile: true,
      cell: (c) => (
        <span className="text-xs text-muted">
          {formatDay(c.start_date)} – {c.end_date ? formatDay(c.end_date) : "indefinida"}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(c) => c.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      onRowClick={(c) => navigate(`/admin/business/contracts/${c.id}`)}
      caption="Contratos"
      empty={<EmptyState title="Sin contratos" description={empty ?? "No hay contratos que coincidan."} />}
    />
  );
}

export function ReceivablesTable({
  rows,
  loading,
  error,
  onRetry,
  hideContract = false,
  empty,
}: {
  rows: Receivable[] | undefined;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  hideContract?: boolean;
  empty?: string;
}) {
  const { canManage } = useFinanceAccess();
  const toast = useToast();
  const cancel = useCancelReceivable();
  const [paying, setPaying] = useState<Receivable | null>(null);
  const [cancelling, setCancelling] = useState<Receivable | null>(null);
  const columns: Column<Receivable>[] = [
    {
      key: "concept",
      header: "Cobro",
      cell: (r) => (
        <span className="min-w-0">
          <span className="block font-medium text-fg">{r.concept}</span>
          {!hideContract && (
            <Link to={`/admin/business/contracts/${r.contract}`} className="text-xs text-muted hover:text-fg hover:underline">
              {r.project_name} · {r.organization_name}
            </Link>
          )}
        </span>
      ),
    },
    { key: "due", header: "Vencimiento", cell: (r) => <span className="tabular-nums">{formatDay(r.due_date)}</span> },
    { key: "expected", header: "Esperado", className: "text-right tabular-nums", cell: (r) => formatMoney(r.expected_amount, r.currency) },
    { key: "paid", header: "Cobrado", className: "text-right tabular-nums", hideOnMobile: true, cell: (r) => formatMoney(r.paid_amount, r.currency) },
    {
      key: "outstanding",
      header: "Saldo",
      className: "text-right tabular-nums",
      cell: (r) => (r.status === "CANCELLED" ? "—" : formatMoney(r.outstanding_amount, r.currency)),
    },
    { key: "status", header: "Estado", cell: (r) => <ReceivableStatusBadge status={r.effective_status} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: <span className="sr-only">Acciones</span>,
            className: "text-right",
            cell: (r: Receivable) =>
              r.status === "PENDING" || r.status === "PARTIAL" ? (
                <span className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" icon={<Banknote className="size-3.5" />} onClick={() => setPaying(r)}>
                    Registrar pago
                  </Button>
                  {r.status === "PENDING" && (
                    <Button size="icon" variant="ghost" className="size-8" aria-label={`Cancelar cobro ${r.concept}`} onClick={() => setCancelling(r)}>
                      <XCircle className="size-4" />
                    </Button>
                  )}
                </span>
              ) : null,
          },
        ]
      : []),
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={onRetry}
        caption="Cobros"
        empty={<EmptyState title="Sin cobros" description={empty ?? "No hay cobros que coincidan."} />}
      />
      <PaymentDialog receivable={paying} onClose={() => setPaying(null)} />
      <ReasonDialog
        open={cancelling !== null}
        title="Cancelar cobro"
        message="El cobro deja de contar como ingreso esperado. Solo se pueden cancelar cobros sin pagos."
        confirmLabel="Cancelar cobro"
        loading={cancel.isPending}
        onClose={() => setCancelling(null)}
        onConfirm={(reason, fail) =>
          cancel.mutate(
            { id: cancelling!.id, reason },
            {
              onSuccess: () => {
                toast.success("Cobro cancelado");
                setCancelling(null);
              },
              onError: fail,
            },
          )
        }
      />
    </>
  );
}

export function PaymentsTable({
  rows,
  loading,
  error,
  onRetry,
  hideContract = false,
}: {
  rows: Payment[] | undefined;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  hideContract?: boolean;
}) {
  const { canManage } = useFinanceAccess();
  const toast = useToast();
  const reverse = useReversePayment();
  const [correcting, setCorrecting] = useState<Payment | null>(null);
  const [reversing, setReversing] = useState<Payment | null>(null);
  const columns: Column<Payment>[] = [
    { key: "date", header: "Fecha", cell: (p) => <span className="tabular-nums">{formatDay(p.paid_on)}</span> },
    {
      key: "concept",
      header: "Concepto",
      cell: (p) => (
        <span>
          <span className="block text-fg">{p.receivable_concept}</span>
          {!hideContract && (
            <Link to={`/admin/business/contracts/${p.contract}`} className="text-xs text-muted hover:text-fg hover:underline">
              {p.project_name} · {p.organization_name}
            </Link>
          )}
        </span>
      ),
    },
    { key: "method", header: "Método", hideOnMobile: true, cell: (p) => <span className="text-muted">{p.method_label}{p.reference && ` · ${p.reference}`}</span> },
    {
      key: "amount",
      header: "Importe",
      className: "text-right tabular-nums",
      cell: (p) => <span className={p.is_reversed ? "text-muted line-through" : "font-medium text-fg"}>{formatMoney(p.amount, p.currency)}</span>,
    },
    {
      key: "state",
      header: "Estado",
      cell: (p) =>
        p.is_reversed ? (
          <span title={p.reversal_reason}>
            <Badge tone="neutral">Revertido</Badge>
          </span>
        ) : p.corrects ? (
          <Badge tone="info">Corrección</Badge>
        ) : (
          <Badge tone="success">Confirmado</Badge>
        ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: <span className="sr-only">Acciones</span>,
            className: "text-right",
            cell: (p: Payment) =>
              p.is_reversed ? null : (
                <span className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" className="size-8" aria-label={`Corregir pago del ${formatDay(p.paid_on)}`} onClick={() => setCorrecting(p)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-8" aria-label={`Revertir pago del ${formatDay(p.paid_on)}`} onClick={() => setReversing(p)}>
                    <RotateCcw className="size-4" />
                  </Button>
                </span>
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        loading={loading}
        error={error}
        onRetry={onRetry}
        caption="Pagos"
        empty={<EmptyState title="Sin pagos" description="Todavía no se ha registrado ningún pago." />}
      />
      <CorrectPaymentDialog payment={correcting} onClose={() => setCorrecting(null)} />
      <ReasonDialog
        open={reversing !== null}
        title="Revertir pago"
        message="El pago deja de contar como ingreso cobrado. No se borra: queda en el historial como revertido."
        confirmLabel="Revertir pago"
        loading={reverse.isPending}
        onClose={() => setReversing(null)}
        onConfirm={(reason, fail) =>
          reverse.mutate(
            { id: reversing!.id, reason },
            {
              onSuccess: () => {
                toast.success("Pago revertido");
                setReversing(null);
              },
              onError: fail,
            },
          )
        }
      />
    </>
  );
}
