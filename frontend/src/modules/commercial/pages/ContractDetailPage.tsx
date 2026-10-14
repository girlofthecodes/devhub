import { ArrowLeft, CalendarPlus, KeyRound, Pencil, Plus, Tag } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/services/http";
import { errorMessage } from "@/utils/forms";
import { formatDateTime, formatDay, formatMoney } from "@/utils/format";

import type { ContractStatus } from "../api";
import { TRANSITION_LABEL, TRANSITIONS } from "../constants";
import { ContractFormDialog, InstallmentDialog, PriceChangeDialog, TransitionDialog } from "../components/dialogs";
import { FinanceGate } from "../components/filters";
import { ContractStatusBadge, PaymentsTable, ReceivablesTable } from "../components/tables";
import { useContract, useFinanceAccess, useGenerateReceivable, usePayments, useReceivables } from "../hooks";

export function ContractDetailPage() {
  return (
    <FinanceGate>
      <ContractDetail />
    </FinanceGate>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 text-fg">{children}</dd>
    </div>
  );
}

function ContractDetail() {
  const { id = "" } = useParams();
  const contract = useContract(id);
  const receivables = useReceivables({ contract: id, page_size: 100, ordering: "-due_date" }, Boolean(id));
  const payments = usePayments({ contract: id, page_size: 100, include_reversed: true }, Boolean(id));
  const { canManage } = useFinanceAccess();
  const generate = useGenerateReceivable();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [installment, setInstallment] = useState(false);
  const [transition, setTransition] = useState<ContractStatus | null>(null);

  if (contract.isPending) return <Skeleton className="h-96 w-full" />;
  if (contract.isError) {
    const notFound = contract.error instanceof ApiError && contract.error.status === 404;
    return (
      <Card>
        <ErrorState
          title={notFound ? "Contrato no encontrado" : "No se pudo cargar el contrato"}
          message={notFound ? "No existe." : contract.error.message}
          onRetry={notFound ? undefined : () => void contract.refetch()}
        />
      </Card>
    );
  }
  const c = contract.data;
  const isSub = c.kind === "SUBSCRIPTION";
  const billable = c.status !== "DRAFT" && c.status !== "CANCELLED";

  return (
    <>
      <Link to="/admin/business/contracts" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Contratos
      </Link>
      <PageHeader
        title={
          <span>
            {c.kind_label} · {c.organization_name}
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm font-normal">
              <ContractStatusBadge status={c.status} />
              <Link to={`/admin/projects/${c.project}?tab=comercial`} className="text-muted hover:text-fg hover:underline">
                {c.project_name}
              </Link>
              {c.has_portal_access && (
                <Badge tone="info">
                  <KeyRound className="size-3" /> Acceso al portal
                </Badge>
              )}
            </span>
          </span>
        }
        actions={
          canManage && (
            <>
              {TRANSITIONS[c.status].map((to) => (
                <Button key={to} variant={to === "CANCELLED" ? "danger" : to === "ACTIVE" ? "primary" : "outline"} onClick={() => setTransition(to)}>
                  {TRANSITION_LABEL[to]}
                </Button>
              ))}
              {c.status !== "CANCELLED" && c.status !== "FINISHED" && (
                <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                  Editar
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title="Cobros"
              description={isSub ? "Un cobro por periodo, con el precio vigente al inicio de cada periodo." : "Pagos programados de la venta (no pueden superar su importe)."}
              actions={
                canManage &&
                billable &&
                (isSub ? (
                  c.status === "ACTIVE" && (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<CalendarPlus className="size-3.5" />}
                      loading={generate.isPending}
                      onClick={() =>
                        generate.mutate(c.id, {
                          onSuccess: (r) => toast.success("Cobro generado", r.concept),
                          onError: (e) => toast.error("No se pudo generar el cobro", errorMessage(e)),
                        })
                      }
                    >
                      Generar siguiente periodo
                    </Button>
                  )
                ) : (
                  <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setInstallment(true)}>
                    Programar cobro
                  </Button>
                ))
              }
            />
            <ReceivablesTable
              rows={receivables.data?.results}
              loading={receivables.isPending}
              error={receivables.error}
              hideContract
              empty={billable ? "Aún no hay cobros para este contrato." : "Activa el contrato para registrar cobros."}
            />
          </Card>
          <Card>
            <CardHeader title="Pagos recibidos" description="Incluye los revertidos, que no cuentan como ingreso." />
            <PaymentsTable rows={payments.data?.results} loading={payments.isPending} error={payments.error} hideContract />
          </Card>
          <Card>
            <CardHeader title="Historial de estado" />
            <CardBody>
              <ol className="space-y-3 text-sm">
                {[...c.status_changes].reverse().map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-fg">{s.to_status_label}</span>
                    <span className="text-muted">desde {formatDay(s.effective_date)}</span>
                    {s.reason && <span className="text-muted">· {s.reason}</span>}
                    <span className="ml-auto text-xs text-muted">
                      {s.actor_email ?? "sistema"} · {formatDateTime(s.created_at)}
                    </span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Condiciones" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <Row label={isSub ? "Importe por periodo" : "Importe de la venta"}>{formatMoney(c.amount, c.currency)}</Row>
                {isSub && <Row label="Valor mensual (MRR)">{formatMoney(c.monthly_value, c.currency)}</Row>}
                {isSub && <Row label="Periodicidad">{c.billing_period_label}</Row>}
                {isSub && <Row label="Próximo periodo">{formatDay(c.next_billing_date)}</Row>}
                <Row label={isSub ? "Inicio" : "Fecha de venta"}>{formatDay(c.start_date)}</Row>
                <Row label="Finalización">{c.end_date ? formatDay(c.end_date) : "Indefinida"}</Row>
                <Row label="Portal">{c.portal_visible ? "Visible para el cliente" : "No visible"}</Row>
                <Row label="Acceso">{c.grants_access ? "Lo concede al activarse" : "No concede acceso"}</Row>
              </dl>
              {c.terms && <p className="mt-4 whitespace-pre-line border-t border-border pt-4 text-sm text-fg">{c.terms}</p>}
              {c.cancellation_reason && <p className="mt-4 border-t border-border pt-4 text-sm text-muted">Motivo de cancelación: {c.cancellation_reason}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Totales" />
            <CardBody>
              <dl className="space-y-2 text-sm">
                {[
                  ["Esperado (cobros vigentes)", c.totals.expected],
                  ["Cobrado", c.totals.collected],
                  ["Saldo pendiente", c.totals.outstanding],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <dt className="text-muted">{label}</dt>
                    <dd className="tabular-nums text-fg">{formatMoney(value, c.currency)}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Historial de precios"
              actions={
                canManage &&
                isSub &&
                c.status !== "CANCELLED" &&
                c.status !== "FINISHED" && (
                  <Button size="sm" variant="outline" icon={<Tag className="size-3.5" />} onClick={() => setPricing(true)}>
                    Cambiar precio
                  </Button>
                )
              }
            />
            <CardBody>
              <ul className="space-y-2 text-sm">
                {[...c.prices].reverse().map((p) => (
                  <li key={p.id} className="flex justify-between gap-3">
                    <span className="text-muted">
                      Desde {formatDay(p.effective_from)}
                      {p.reason && <span className="block text-xs">{p.reason}</span>}
                    </span>
                    <span className="tabular-nums text-fg">{formatMoney(p.amount, c.currency)}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>

      <ContractFormDialog open={editing} contract={c} onClose={() => setEditing(false)} />
      <PriceChangeDialog contract={pricing ? c : null} onClose={() => setPricing(false)} />
      <InstallmentDialog contract={installment ? c : null} onClose={() => setInstallment(false)} />
      <TransitionDialog contract={transition ? c : null} to={transition} onClose={() => setTransition(null)} />
    </>
  );
}
