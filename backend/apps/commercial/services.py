"""Commercial write operations. Every one is transactional, validated and audited.

Financial movements are never physically deleted: receivables are cancelled, payments are
reversed (optionally replaced by a correction) and expenses are voided. Financial details are
recorded only in the audit log (restricted to administrators), never in trace events, which
every team member of a project can read.
"""

from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditAction
from apps.organizations.models import Organization
from apps.projects import services as project_services
from apps.projects.models import Project, ProjectAccess
from apps.users.models import User
from common.exceptions import DomainError

from . import metrics
from .models import (
    ALLOWED_KINDS,
    CLOSED_CONTRACT_STATUSES,
    OPEN_CONTRACT_STATUSES,
    BillingPeriod,
    CommercialProfile,
    CommercialStatus,
    Contract,
    ContractKind,
    ContractPrice,
    ContractStatus,
    ContractStatusChange,
    Expense,
    ExpenseAllocation,
    ExpenseKind,
    Payment,
    Receivable,
    ReceivableStatus,
)

ZERO = Decimal("0.00")

TRANSITIONS = {
    ContractStatus.DRAFT: {ContractStatus.PENDING, ContractStatus.ACTIVE, ContractStatus.CANCELLED},
    ContractStatus.PENDING: {ContractStatus.ACTIVE, ContractStatus.CANCELLED},
    ContractStatus.ACTIVE: {
        ContractStatus.SUSPENDED,
        ContractStatus.FINISHED,
        ContractStatus.CANCELLED,
    },
    ContractStatus.SUSPENDED: {
        ContractStatus.ACTIVE,
        ContractStatus.FINISHED,
        ContractStatus.CANCELLED,
    },
}

# Editable contract fields by status (anything else needs a dedicated action).
EDITABLE_ALWAYS = {"terms", "portal_visible"}
EDITABLE_OPEN = {"end_date", "next_billing_date", "grants_access"}
EDITABLE_BEFORE_ACTIVATION = {"start_date", "amount", "currency", "billing_period"}


def _today():
    return metrics.business_today()


def _paid(receivable: Receivable) -> Decimal:
    total = receivable.payments.filter(reversed_at__isnull=True).aggregate(t=Sum("amount"))["t"]
    return metrics.q(total or ZERO)


# --- commercial profile ------------------------------------------------------------------


def get_profile(project: Project) -> CommercialProfile:
    """Existing profile or an unsaved default one (not commercial)."""
    try:
        return project.commercial_profile
    except CommercialProfile.DoesNotExist:
        return CommercialProfile(project=project)


@transaction.atomic
def update_profile(project: Project, *, actor: User, data: dict, request=None) -> CommercialProfile:
    profile, _ = CommercialProfile.objects.select_for_update().get_or_create(project=project)
    if project.is_archived and data.get("status", profile.status) not in {
        CommercialStatus.NOT_COMMERCIAL,
        CommercialStatus.SUSPENDED,
    }:
        raise DomainError(
            "Un proyecto archivado no puede ofrecerse comercialmente.",
            code="archived",
            field="status",
        )
    changes = audit.diff(profile, data)
    if not changes:
        return profile
    for field, value in data.items():
        setattr(profile, field, value)
    if "end_users_count" in changes:
        profile.end_users_updated_at = timezone.now()
    profile.updated_by = actor
    profile.save()
    audit.record(
        AuditAction.COMMERCIAL_PROFILE_UPDATED,
        actor=actor,
        target=project,
        changes=changes,
        request=request,
    )
    return profile


# --- contracts -----------------------------------------------------------------------------


def _validate_period(kind: str, billing_period: str) -> None:
    if kind == ContractKind.SUBSCRIPTION and billing_period not in BillingPeriod.values:
        raise DomainError(
            "Indica la periodicidad de la renta.", code="invalid_period", field="billing_period"
        )
    if kind == ContractKind.SALE and billing_period:
        raise DomainError(
            "Una venta única no tiene periodicidad.", code="invalid_period", field="billing_period"
        )


def _validate_dates(start_date, end_date) -> None:
    if end_date is not None and end_date < start_date:
        raise DomainError(
            "La fecha de finalización no puede ser anterior al inicio.",
            code="invalid_date",
            field="end_date",
        )


def _ensure_no_open_duplicate(project, organization, kind, *, exclude_pk=None) -> None:
    qs = Contract.objects.filter(
        project=project, organization=organization, kind=kind, status__in=OPEN_CONTRACT_STATUSES
    )
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    if qs.exists():
        raise DomainError(
            "Ya existe un contrato abierto equivalente (mismo proyecto, organización y "
            "modelo comercial).",
            code="duplicate",
            field="organization",
        )


@transaction.atomic
def create_contract(
    *,
    project: Project,
    organization: Organization,
    kind: str,
    amount: Decimal,
    start_date,
    actor: User,
    currency: str = "MXN",
    end_date=None,
    billing_period: str = "",
    terms: str = "",
    portal_visible: bool = False,
    grants_access: bool = True,
    request=None,
) -> Contract:
    if project.is_archived:
        raise DomainError("El proyecto está archivado.", code="archived", field="project")
    if not organization.is_active:
        raise DomainError(
            "La organización está inactiva.", code="inactive_organization", field="organization"
        )
    status = get_profile(project).status
    if kind not in ALLOWED_KINDS.get(status, set()):
        raise DomainError(
            f"La aplicación no está disponible para {ContractKind(kind).label.lower()} "
            f"(estado comercial: {CommercialStatus(status).label}).",
            code="commercial_unavailable",
            field="kind",
        )
    _validate_period(kind, billing_period)
    _validate_dates(start_date, end_date)
    _ensure_no_open_duplicate(project, organization, kind)
    try:
        with transaction.atomic():
            contract = Contract.objects.create(
                project=project,
                organization=organization,
                kind=kind,
                currency=currency,
                start_date=start_date,
                end_date=end_date,
                billing_period=billing_period,
                next_billing_date=start_date if kind == ContractKind.SUBSCRIPTION else None,
                terms=terms,
                portal_visible=portal_visible,
                grants_access=grants_access,
                created_by=actor,
            )
    except IntegrityError as exc:  # concurrent duplicate caught by the partial unique index
        raise DomainError(
            "Ya existe un contrato abierto equivalente.", code="duplicate", field="organization"
        ) from exc
    ContractPrice.objects.create(
        contract=contract, amount=amount, effective_from=start_date, created_by=actor
    )
    ContractStatusChange.objects.create(
        contract=contract,
        to_status=ContractStatus.DRAFT,
        effective_date=min(start_date, _today()),
        actor=actor,
    )
    audit.record(
        AuditAction.CONTRACT_CREATED,
        actor=actor,
        target=contract,
        changes={
            "project": project.name,
            "organization": organization.name,
            "kind": kind,
            "amount": amount,
            "currency": currency,
            "start_date": start_date,
            "end_date": end_date,
            "billing_period": billing_period,
        },
        request=request,
    )
    return contract


def current_price(contract: Contract) -> ContractPrice | None:
    return contract.prices.order_by("-effective_from").first()


@transaction.atomic
def update_contract(contract: Contract, *, actor: User, data: dict, request=None) -> Contract:
    contract = Contract.objects.select_for_update().get(pk=contract.pk)
    allowed = set(EDITABLE_ALWAYS)
    if contract.status in OPEN_CONTRACT_STATUSES:
        allowed |= EDITABLE_OPEN
    before_activation = contract.status in (ContractStatus.DRAFT, ContractStatus.PENDING)
    if before_activation and not contract.receivables.exists():
        allowed |= EDITABLE_BEFORE_ACTIVATION
    blocked = sorted(set(data) - allowed)
    if blocked:
        raise DomainError(
            "Estos campos no se pueden modificar en el estado actual del contrato: "
            + ", ".join(blocked)
            + ". Usa las acciones de cambio de precio o de estado.",
            code="not_editable",
            field=blocked[0],
        )

    price = current_price(contract)
    amount = data.pop("amount", None)
    changes = audit.diff(contract, data)
    if amount is not None and price and amount != price.amount:
        changes["amount"] = {"from": price.amount, "to": amount}

    start_date = data.get("start_date", contract.start_date)
    end_date = data.get("end_date", contract.end_date)
    _validate_dates(start_date, end_date)
    if "billing_period" in data:
        _validate_period(contract.kind, data["billing_period"])
    if (
        "end_date" in changes
        and end_date is not None
        and contract.status in (ContractStatus.ACTIVE, ContractStatus.SUSPENDED)
        and end_date < _today()
    ):
        raise DomainError(
            "Para un contrato vigente la fecha de finalización no puede ser pasada; "
            "finalízalo o cancélalo con la fecha correspondiente.",
            code="invalid_date",
            field="end_date",
        )
    if not changes:
        return contract

    for field, value in data.items():
        setattr(contract, field, value)
    if "start_date" in changes and contract.kind == ContractKind.SUBSCRIPTION:
        contract.next_billing_date = start_date
    contract.save()
    if price is not None and ("amount" in changes or "start_date" in changes):
        # Before activation there is no history to preserve: adjust the initial price.
        price.amount = amount if amount is not None else price.amount
        price.effective_from = start_date
        price.save(update_fields=["amount", "effective_from"])
    if "end_date" in changes and contract.access_grant_id:
        grant = contract.access_grant
        if grant.revoked_at is None:
            project_services.update_access(
                grant, actor=actor, request=request, expires_at=_access_expiry(contract)
            )
    audit.record(
        AuditAction.CONTRACT_UPDATED, actor=actor, target=contract, changes=changes, request=request
    )
    return contract


@transaction.atomic
def change_price(
    contract: Contract,
    *,
    amount: Decimal,
    effective_from,
    actor: User,
    reason: str = "",
    request=None,
) -> ContractPrice:
    """Append a new price. Past prices are kept so historical MRR never changes."""
    contract = Contract.objects.select_for_update().get(pk=contract.pk)
    if contract.kind != ContractKind.SUBSCRIPTION:
        raise DomainError(
            "El importe de una venta solo se modifica antes de activarla.", code="not_editable"
        )
    if contract.status in CLOSED_CONTRACT_STATUSES:
        raise DomainError("El contrato está cerrado.", code="closed_contract")
    latest = current_price(contract)
    if effective_from < _today():
        raise DomainError(
            "Un cambio de precio no puede ser retroactivo.",
            code="retroactive_change",
            field="effective_from",
        )
    if latest and effective_from <= latest.effective_from:
        raise DomainError(
            f"Debe aplicar después del precio vigente desde {latest.effective_from:%d/%m/%Y}.",
            code="invalid_date",
            field="effective_from",
        )
    if latest and amount == latest.amount:
        raise DomainError("El importe es igual al vigente.", code="no_change", field="amount")
    price = ContractPrice.objects.create(
        contract=contract,
        amount=amount,
        effective_from=effective_from,
        reason=reason,
        created_by=actor,
    )
    audit.record(
        AuditAction.CONTRACT_PRICE_CHANGED,
        actor=actor,
        target=contract,
        changes={
            "amount": {"from": latest.amount if latest else None, "to": amount},
            "effective_from": effective_from,
            "reason": reason,
        },
        request=request,
    )
    return price


def _access_expiry(contract: Contract):
    """Portal access lasts until the end of the contract's last day (business calendar)."""
    if contract.end_date is None:
        return None
    tz = ZoneInfo(settings.BUSINESS_TIME_ZONE)
    return datetime.combine(contract.end_date + timedelta(days=1), time.min, tzinfo=tz)


def _grant_contract_access(contract: Contract, *, actor: User, request=None) -> None:
    """Policy: an ACTIVE contract that `grants_access` opens the project in the portal.

    An access that already exists (granted manually or by another contract) is left as is.
    """
    if not contract.grants_access:
        return
    expires_at = _access_expiry(contract)
    if expires_at is not None and expires_at <= timezone.now():
        return  # a contract registered after its end date opens nothing
    if (
        ProjectAccess.objects.current()
        .filter(project=contract.project, organization=contract.organization)
        .exists()
    ):
        return
    grant = project_services.grant_access(
        project=contract.project,
        organization=contract.organization,
        actor=actor,
        expires_at=expires_at,
        notes=f"Contrato {contract.get_kind_display().lower()} {str(contract.pk)[:8]}",
        request=request,
    )
    contract.access_grant = grant
    contract.save(update_fields=["access_grant", "updated_at"])
    audit.record(
        AuditAction.COMMERCIAL_ACCESS_GRANTED,
        actor=actor,
        target=contract,
        changes={"organization": contract.organization.name, "expires_at": grant.expires_at},
        request=request,
    )


def _revoke_contract_access(contract: Contract, *, actor: User, request=None) -> None:
    """Revoke only the access this contract created. If another active contract of the same
    organization and project grants access, it takes over the access instead."""
    grant = contract.access_grant
    if grant is None or grant.revoked_at is not None:
        return
    successor = (
        Contract.objects.filter(
            project=contract.project,
            organization=contract.organization,
            status=ContractStatus.ACTIVE,
            grants_access=True,
        )
        .exclude(pk=contract.pk)
        .first()
    )
    if successor is not None:
        successor.access_grant = grant
        successor.save(update_fields=["access_grant", "updated_at"])
        return
    project_services.revoke_access(grant, actor=actor, request=request)
    audit.record(
        AuditAction.COMMERCIAL_ACCESS_REVOKED,
        actor=actor,
        target=contract,
        changes={"organization": contract.organization.name, "status": contract.status},
        request=request,
    )


@transaction.atomic
def transition(
    contract: Contract,
    *,
    to_status: str,
    actor: User,
    effective_date=None,
    reason: str = "",
    request=None,
) -> Contract:
    contract = Contract.objects.select_for_update().get(pk=contract.pk)
    if to_status not in TRANSITIONS.get(contract.status, set()):
        raise DomainError(
            f"No se puede pasar de «{contract.get_status_display()}» a "
            f"«{ContractStatus(to_status).label}».",
            code="invalid_transition",
            field="to_status",
        )
    today = _today()
    effective_date = effective_date or today
    if effective_date > today:
        raise DomainError(
            "La fecha efectiva no puede ser futura.", code="invalid_date", field="effective_date"
        )
    last = contract.status_changes.order_by("-effective_date", "-created_at").first()
    if last and effective_date < last.effective_date:
        raise DomainError(
            f"La fecha efectiva no puede ser anterior al último cambio "
            f"({last.effective_date:%d/%m/%Y}).",
            code="invalid_date",
            field="effective_date",
        )
    if to_status == ContractStatus.CANCELLED and not reason.strip():
        raise DomainError("Indica el motivo de la cancelación.", code="required", field="reason")
    if to_status == ContractStatus.ACTIVE:
        if contract.end_date and contract.end_date < effective_date:
            raise DomainError(
                "El contrato ya terminó su vigencia.", code="expired", field="effective_date"
            )
        if contract.project.is_archived or not contract.organization.is_active:
            raise DomainError(
                "El proyecto está archivado o la organización inactiva.", code="inactive"
            )
        _ensure_no_open_duplicate(
            contract.project, contract.organization, contract.kind, exclude_pk=contract.pk
        )

    previous = contract.status
    contract.status = to_status
    if to_status == ContractStatus.CANCELLED:
        contract.cancellation_reason = reason.strip()[:255]
    contract.save()
    ContractStatusChange.objects.create(
        contract=contract,
        from_status=previous,
        to_status=to_status,
        effective_date=effective_date,
        reason=reason.strip()[:255],
        actor=actor,
    )

    cancelled_receivables = 0
    if to_status == ContractStatus.ACTIVE:
        _grant_contract_access(contract, actor=actor, request=request)
    elif to_status in CLOSED_CONTRACT_STATUSES:
        _revoke_contract_access(contract, actor=actor, request=request)
        cancelled_receivables = _cancel_future_unpaid(contract, after=effective_date, actor=actor)

    audit.record(
        AuditAction.CONTRACT_CANCELLED
        if to_status == ContractStatus.CANCELLED
        else AuditAction.CONTRACT_STATUS_CHANGED,
        actor=actor,
        target=contract,
        changes={"status": {"from": previous, "to": to_status}},
        metadata={
            "effective_date": effective_date,
            "reason": reason.strip(),
            "cancelled_receivables": cancelled_receivables,
        },
        request=request,
    )
    return contract


def _cancel_future_unpaid(contract: Contract, *, after, actor: User) -> int:
    """Closing a contract cancels the receivables due after the closing date that have no
    payments; everything already due (or partially paid) is kept as it is still owed."""
    count = 0
    for receivable in contract.receivables.select_for_update().filter(
        status=ReceivableStatus.PENDING, due_date__gt=after
    ):
        if _paid(receivable) > 0:
            continue
        receivable.status = ReceivableStatus.CANCELLED
        receivable.cancelled_at = timezone.now()
        receivable.cancellation_reason = "Contrato cerrado"
        receivable.save(
            update_fields=["status", "cancelled_at", "cancellation_reason", "updated_at"]
        )
        count += 1
    return count


# --- receivables -------------------------------------------------------------------------


def _ensure_billable(contract: Contract) -> None:
    if contract.status in (ContractStatus.DRAFT, ContractStatus.CANCELLED):
        raise DomainError(
            "No se pueden registrar cobros de un contrato en borrador o cancelado.",
            code="not_billable",
        )


@transaction.atomic
def generate_next_receivable(contract: Contract, *, actor: User, request=None) -> Receivable:
    """Create the receivable of the next billing period of a subscription."""
    contract = Contract.objects.select_for_update().get(pk=contract.pk)
    if contract.kind != ContractKind.SUBSCRIPTION:
        raise DomainError("Solo las rentas tienen periodos de cobro.", code="not_subscription")
    if contract.status != ContractStatus.ACTIVE:
        raise DomainError("Solo se generan cobros de contratos activos.", code="not_billable")
    start = contract.next_billing_date
    if start is None or (contract.end_date and start > contract.end_date):
        raise DomainError("El contrato no tiene más periodos por cobrar.", code="no_more_periods")
    end = metrics.add_months(start, contract.period_months) - timedelta(days=1)
    if contract.end_date and end > contract.end_date:
        end = contract.end_date
    price = metrics.price_at(contract, start)
    if price is None:
        raise DomainError("No hay un precio vigente para el periodo.", code="no_price")
    if (
        contract.receivables.filter(period_start=start)
        .exclude(status=ReceivableStatus.CANCELLED)
        .exists()
    ):
        raise DomainError("Ese periodo ya tiene un cobro registrado.", code="duplicate")
    receivable = Receivable.objects.create(
        contract=contract,
        concept=f"Renta {contract.get_billing_period_display().lower()} "
        f"{start:%d/%m/%Y}–{end:%d/%m/%Y}",
        period_start=start,
        period_end=end,
        due_date=start,
        expected_amount=price,
        currency=contract.currency,
        created_by=actor,
    )
    contract.next_billing_date = metrics.add_months(start, contract.period_months)
    contract.save(update_fields=["next_billing_date", "updated_at"])
    audit.record(
        AuditAction.RECEIVABLE_CREATED,
        actor=actor,
        target=contract,
        changes={
            "receivable": str(receivable.pk),
            "concept": receivable.concept,
            "expected_amount": price,
            "due_date": start,
        },
        request=request,
    )
    return receivable


@transaction.atomic
def create_receivable(
    *,
    contract: Contract,
    concept: str,
    due_date,
    expected_amount: Decimal,
    actor: User,
    notes: str = "",
    request=None,
) -> Receivable:
    """Installment of a sale. Subscriptions use generate_next_receivable."""
    contract = Contract.objects.select_for_update().get(pk=contract.pk)
    if contract.kind != ContractKind.SALE:
        raise DomainError(
            "Los cobros de una renta se generan por periodo.", code="use_periods", field="contract"
        )
    _ensure_billable(contract)
    total = current_price(contract).amount
    scheduled = (
        contract.receivables.exclude(status=ReceivableStatus.CANCELLED).aggregate(
            t=Sum("expected_amount")
        )["t"]
        or ZERO
    )
    if scheduled + expected_amount > total:
        raise DomainError(
            f"Los cobros programados ({metrics.q(scheduled + expected_amount)}) superarían el "
            f"importe de la venta ({total}).",
            code="exceeds_contract",
            field="expected_amount",
        )
    receivable = Receivable.objects.create(
        contract=contract,
        concept=concept,
        due_date=due_date,
        expected_amount=expected_amount,
        currency=contract.currency,
        notes=notes,
        created_by=actor,
    )
    audit.record(
        AuditAction.RECEIVABLE_CREATED,
        actor=actor,
        target=contract,
        changes={
            "receivable": str(receivable.pk),
            "concept": concept,
            "expected_amount": expected_amount,
            "due_date": due_date,
        },
        request=request,
    )
    return receivable


def _refresh_receivable_status(receivable: Receivable) -> None:
    if receivable.status == ReceivableStatus.CANCELLED:
        return
    paid = _paid(receivable)
    if paid <= 0:
        status = ReceivableStatus.PENDING
    elif paid < receivable.expected_amount:
        status = ReceivableStatus.PARTIAL
    else:
        status = ReceivableStatus.PAID
    if status != receivable.status:
        receivable.status = status
        receivable.save(update_fields=["status", "updated_at"])


@transaction.atomic
def update_receivable(receivable: Receivable, *, actor: User, data: dict, request=None):
    receivable = Receivable.objects.select_for_update().get(pk=receivable.pk)
    if receivable.status in (ReceivableStatus.CANCELLED, ReceivableStatus.PAID):
        raise DomainError("El cobro ya está cerrado.", code="closed_receivable")
    if "expected_amount" in data:
        paid = _paid(receivable)
        if data["expected_amount"] < paid:
            raise DomainError(
                f"El importe esperado no puede ser menor a lo ya cobrado ({paid}).",
                code="below_paid",
                field="expected_amount",
            )
        contract = receivable.contract
        if contract.kind == ContractKind.SALE:
            others = (
                contract.receivables.exclude(pk=receivable.pk)
                .exclude(status=ReceivableStatus.CANCELLED)
                .aggregate(t=Sum("expected_amount"))["t"]
                or ZERO
            )
            if others + data["expected_amount"] > current_price(contract).amount:
                raise DomainError(
                    "Los cobros programados superarían el importe de la venta.",
                    code="exceeds_contract",
                    field="expected_amount",
                )
    changes = audit.diff(receivable, data)
    if not changes:
        return receivable
    for field, value in data.items():
        setattr(receivable, field, value)
    receivable.save()
    _refresh_receivable_status(receivable)
    audit.record(
        AuditAction.RECEIVABLE_UPDATED,
        actor=actor,
        target=receivable.contract,
        changes={"receivable": str(receivable.pk), **changes},
        request=request,
    )
    return receivable


@transaction.atomic
def cancel_receivable(receivable: Receivable, *, actor: User, reason: str, request=None):
    receivable = Receivable.objects.select_for_update().get(pk=receivable.pk)
    if receivable.status == ReceivableStatus.CANCELLED:
        return receivable
    if _paid(receivable) > 0:
        raise DomainError(
            "El cobro tiene pagos registrados; revierte los pagos antes de cancelarlo.",
            code="has_payments",
        )
    if not reason.strip():
        raise DomainError("Indica el motivo.", code="required", field="reason")
    receivable.status = ReceivableStatus.CANCELLED
    receivable.cancelled_at = timezone.now()
    receivable.cancellation_reason = reason.strip()[:255]
    receivable.save()
    audit.record(
        AuditAction.RECEIVABLE_CANCELLED,
        actor=actor,
        target=receivable.contract,
        changes={"receivable": str(receivable.pk), "reason": reason.strip()},
        request=request,
    )
    return receivable


# --- payments ------------------------------------------------------------------------------


def _ensure_unique_reference(method: str, reference: str) -> None:
    if (
        reference
        and Payment.objects.filter(
            method=method, reference=reference, reversed_at__isnull=True
        ).exists()
    ):
        raise DomainError(
            "Ya existe un pago con esa referencia; no se registró de nuevo.",
            code="duplicate_payment",
            field="reference",
        )


def _create_payment(receivable, *, amount, paid_on, method, reference, notes, actor, corrects=None):
    if receivable.status == ReceivableStatus.CANCELLED:
        raise DomainError("El cobro está cancelado.", code="closed_receivable", field="receivable")
    if paid_on > _today():
        raise DomainError(
            "La fecha de pago no puede ser futura.", code="invalid_date", field="paid_on"
        )
    paid = _paid(receivable)
    outstanding = receivable.expected_amount - paid
    if amount > outstanding:
        raise DomainError(
            f"El pago excede el saldo pendiente ({metrics.q(outstanding)}).",
            code="overpayment",
            field="amount",
        )
    reference = reference.strip()
    _ensure_unique_reference(method, reference)
    try:
        with transaction.atomic():
            payment = Payment.objects.create(
                receivable=receivable,
                amount=amount,
                paid_on=paid_on,
                method=method,
                reference=reference,
                notes=notes,
                created_by=actor,
                corrects=corrects,
            )
    except IntegrityError as exc:
        raise DomainError(
            "Ya existe un pago con esa referencia.", code="duplicate_payment", field="reference"
        ) from exc
    _refresh_receivable_status(receivable)
    return payment


@transaction.atomic
def record_payment(
    *,
    receivable: Receivable,
    amount: Decimal,
    paid_on,
    method: str,
    actor: User,
    reference: str = "",
    notes: str = "",
    request=None,
) -> Payment:
    # Row lock: two concurrent payments can never exceed the outstanding balance.
    receivable = Receivable.objects.select_for_update().get(pk=receivable.pk)
    payment = _create_payment(
        receivable,
        amount=amount,
        paid_on=paid_on,
        method=method,
        reference=reference,
        notes=notes,
        actor=actor,
    )
    audit.record(
        AuditAction.PAYMENT_RECORDED,
        actor=actor,
        target=receivable.contract,
        changes={
            "payment": str(payment.pk),
            "receivable": str(receivable.pk),
            "amount": amount,
            "paid_on": paid_on,
            "method": method,
            "reference": payment.reference,
        },
        request=request,
    )
    return payment


def _reverse(payment: Payment, *, actor: User, reason: str) -> None:
    if payment.reversed_at is not None:
        raise DomainError("El pago ya fue revertido.", code="already_reversed")
    if not reason.strip():
        raise DomainError("Indica el motivo.", code="required", field="reason")
    payment.reversed_at = timezone.now()
    payment.reversed_by = actor
    payment.reversal_reason = reason.strip()[:255]
    payment.save(update_fields=["reversed_at", "reversed_by", "reversal_reason"])


@transaction.atomic
def reverse_payment(payment: Payment, *, actor: User, reason: str, request=None) -> Payment:
    receivable = Receivable.objects.select_for_update().get(pk=payment.receivable_id)
    payment = Payment.objects.select_for_update().get(pk=payment.pk)
    _reverse(payment, actor=actor, reason=reason)
    _refresh_receivable_status(receivable)
    audit.record(
        AuditAction.PAYMENT_REVERSED,
        actor=actor,
        target=receivable.contract,
        changes={"payment": str(payment.pk), "amount": payment.amount, "reason": reason.strip()},
        request=request,
    )
    return payment


@transaction.atomic
def correct_payment(
    payment: Payment,
    *,
    actor: User,
    reason: str,
    amount: Decimal,
    paid_on,
    method: str,
    reference: str = "",
    notes: str = "",
    request=None,
) -> Payment:
    """Reverse a payment and record the corrected one, linked to it, in a single step."""
    receivable = Receivable.objects.select_for_update().get(pk=payment.receivable_id)
    original = Payment.objects.select_for_update().get(pk=payment.pk)
    _reverse(original, actor=actor, reason=reason)
    corrected = _create_payment(
        receivable,
        amount=amount,
        paid_on=paid_on,
        method=method,
        reference=reference,
        notes=notes,
        actor=actor,
        corrects=original,
    )
    audit.record(
        AuditAction.PAYMENT_CORRECTED,
        actor=actor,
        target=receivable.contract,
        changes={
            "reversed_payment": str(original.pk),
            "payment": str(corrected.pk),
            "amount": {"from": original.amount, "to": amount},
            "paid_on": {"from": original.paid_on, "to": paid_on},
            "reason": reason.strip(),
        },
        request=request,
    )
    return corrected


# --- expenses ------------------------------------------------------------------------------


def _validate_expense_kind(kind: str, recurrence: str) -> None:
    if kind == ExpenseKind.RECURRING and recurrence not in BillingPeriod.values:
        raise DomainError(
            "Indica la periodicidad del gasto recurrente.", code="required", field="recurrence"
        )
    if kind == ExpenseKind.ONE_TIME and recurrence:
        raise DomainError(
            "Un gasto único no tiene periodicidad.", code="invalid_period", field="recurrence"
        )


@transaction.atomic
def create_expense(*, actor: User, request=None, **data) -> Expense:
    data.setdefault("recurrence", "")
    _validate_expense_kind(data.get("kind", ExpenseKind.ONE_TIME), data["recurrence"])
    expense = Expense.objects.create(created_by=actor, **data)
    audit.record(
        AuditAction.EXPENSE_CREATED,
        actor=actor,
        target=expense,
        changes={
            "concept": expense.concept,
            "category": expense.category,
            "amount": expense.amount,
            "currency": expense.currency,
            "incurred_on": expense.incurred_on,
            "project": expense.project.name if expense.project else None,
        },
        request=request,
    )
    return expense


@transaction.atomic
def update_expense(expense: Expense, *, actor: User, data: dict, request=None) -> Expense:
    expense = Expense.objects.select_for_update().get(pk=expense.pk)
    if expense.is_voided:
        raise DomainError("El gasto está anulado.", code="voided")
    _validate_expense_kind(
        data.get("kind", expense.kind), data.get("recurrence", expense.recurrence)
    )
    if data.get("project") is not None and expense.allocations.exists():
        raise DomainError(
            "Quita la distribución del gasto general antes de asignarlo a un proyecto.",
            code="has_allocations",
            field="project",
        )
    changes = audit.diff(expense, data)
    if not changes:
        return expense
    for field, value in data.items():
        setattr(expense, field, value)
    expense.save()
    audit.record(
        AuditAction.EXPENSE_UPDATED, actor=actor, target=expense, changes=changes, request=request
    )
    return expense


@transaction.atomic
def void_expense(expense: Expense, *, actor: User, reason: str, request=None) -> Expense:
    expense = Expense.objects.select_for_update().get(pk=expense.pk)
    if expense.is_voided:
        return expense
    if not reason.strip():
        raise DomainError("Indica el motivo.", code="required", field="reason")
    expense.voided_at = timezone.now()
    expense.voided_by = actor
    expense.void_reason = reason.strip()[:255]
    expense.save()
    audit.record(
        AuditAction.EXPENSE_VOIDED,
        actor=actor,
        target=expense,
        changes={"amount": expense.amount, "reason": expense.void_reason},
        request=request,
    )
    return expense


@transaction.atomic
def set_allocations(
    expense: Expense, *, allocations: list[tuple[Project, Decimal]], actor: User, request=None
) -> Expense:
    """Distribute a general expense among projects (percentages up to 100% in total)."""
    expense = Expense.objects.select_for_update().get(pk=expense.pk)
    if expense.project_id is not None:
        raise DomainError(
            "Solo los gastos generales se distribuyen entre proyectos.", code="not_general"
        )
    if expense.is_voided:
        raise DomainError("El gasto está anulado.", code="voided")
    projects = [p.pk for p, _ in allocations]
    if len(projects) != len(set(projects)):
        raise DomainError("Un proyecto aparece más de una vez.", code="duplicate")
    total = sum((pct for _, pct in allocations), ZERO)
    if total > 100:
        raise DomainError(
            f"La suma de porcentajes ({total}%) supera el 100%.",
            code="over_allocated",
            field="allocations",
        )
    before = {a.project.name: a.percentage for a in expense.allocations.select_related("project")}
    expense.allocations.all().delete()
    ExpenseAllocation.objects.bulk_create(
        ExpenseAllocation(expense=expense, project=p, percentage=pct) for p, pct in allocations
    )
    audit.record(
        AuditAction.EXPENSE_ALLOCATED,
        actor=actor,
        target=expense,
        changes={
            "allocations": {"from": before, "to": {p.name: pct for p, pct in allocations}},
        },
        request=request,
    )
    return expense
