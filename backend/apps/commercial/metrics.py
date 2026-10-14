"""Financial calculations. Single source of truth: views and serializers never compute money.

Policies (documented in docs/phase-7.md):
- Collected income: confirmed (not reversed) payments whose payment date is in the period.
- Expected income: non-cancelled receivables whose due date is in the period.
- Overdue: outstanding amount (expected - collected) of pending/partial receivables whose due
  date is before today, regardless of the selected period.
- Expenses: non-voided expenses whose date is in the period. A project's expenses are its
  direct expenses plus its explicit share of general expenses; the portfolio total counts each
  expense exactly once.
- Estimated operating profit = collected - expenses. Margin = profit / collected * 100, not
  available when nothing was collected. It is an operating estimate, not accounting profit.
- MRR at a date: for every subscription in force and ACTIVE at that date, the price valid at
  that date divided by the months of its billing period. Suspended contracts are excluded
  (reported separately). Sales never count. Historical months are snapshots at month end.
- Money is never added across currencies: every figure is for one currency.
"""

from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import DecimalField, F, OuterRef, Prefetch, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from apps.projects.models import Project

from .models import (
    ALLOWED_KINDS,
    PERIOD_MONTHS,
    CommercialStatus,
    Contract,
    ContractKind,
    ContractPrice,
    ContractStatus,
    ContractStatusChange,
    Expense,
    ExpenseAllocation,
    Payment,
    Receivable,
    ReceivableStatus,
)

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
HUNDRED = Decimal("100")
MAX_MONTHS = 60
MONEY_FIELD = DecimalField(max_digits=18, decimal_places=4)


def q(value) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def business_today() -> date:
    return timezone.localdate(timezone=ZoneInfo(settings.BUSINESS_TIME_ZONE))


def pct(part: Decimal, whole: Decimal) -> Decimal | None:
    """part / whole * 100, or None when whole is zero (never divide by zero)."""
    if not whole:
        return None
    return q(Decimal(part) / Decimal(whole) * HUNDRED)


# --- calendar helpers ----------------------------------------------------------------------


def month_start(day: date) -> date:
    return day.replace(day=1)


def month_end(day: date) -> date:
    return day.replace(day=monthrange(day.year, day.month)[1])


def add_months(day: date, months: int) -> date:
    index = day.year * 12 + (day.month - 1) + months
    year, month = divmod(index, 12)
    return date(year, month + 1, min(day.day, monthrange(year, month + 1)[1]))


def months_between(start: date, end: date) -> list[date]:
    """First day of every month from start's month to end's month (inclusive)."""
    months, cursor = [], month_start(start)
    while cursor <= end and len(months) < MAX_MONTHS:
        months.append(cursor)
        cursor = add_months(cursor, 1)
    return months


@dataclass(frozen=True)
class Filters:
    date_from: date
    date_to: date
    currency: str
    project: Project | None = None
    kind: str | None = None

    def contract_q(self, prefix: str = "") -> Q:
        cond = Q()
        if self.project is not None:
            cond &= Q(**{f"{prefix}project": self.project})
        if self.kind:
            cond &= Q(**{f"{prefix}kind": self.kind})
        return cond


# --- income -------------------------------------------------------------------------------


def confirmed_payments() -> "Payment.objects":
    return Payment.objects.filter(reversed_at__isnull=True)


def payments_in(f: Filters):
    return confirmed_payments().filter(
        f.contract_q("receivable__contract__"),
        receivable__currency=f.currency,
        paid_on__gte=f.date_from,
        paid_on__lte=f.date_to,
    )


def _sum(qs, field: str) -> Decimal:
    return q(
        qs.aggregate(total=Coalesce(Sum(field), Value(ZERO), output_field=MONEY_FIELD))["total"]
    )


def with_paid(qs):
    """Annotate receivables with the amount collected so far (confirmed payments only)."""
    paid = (
        Payment.objects.filter(receivable=OuterRef("pk"), reversed_at__isnull=True)
        .values("receivable")
        .annotate(total=Sum("amount"))
        .values("total")
    )
    return qs.annotate(
        paid_amount=Coalesce(Subquery(paid, output_field=MONEY_FIELD), Value(ZERO)),
    ).annotate(outstanding_amount=F("expected_amount") - F("paid_amount"))


def receivables_due_in(f: Filters):
    return Receivable.objects.exclude(status=ReceivableStatus.CANCELLED).filter(
        f.contract_q("contract__"),
        currency=f.currency,
        due_date__gte=f.date_from,
        due_date__lte=f.date_to,
    )


def overdue_receivables(f: Filters, today: date | None = None):
    today = today or business_today()
    return with_paid(
        Receivable.objects.filter(
            f.contract_q("contract__"),
            currency=f.currency,
            status__in=(ReceivableStatus.PENDING, ReceivableStatus.PARTIAL),
            due_date__lt=today,
        )
    )


def receivable_effective_status(receivable: Receivable, today: date | None = None) -> str:
    today = today or business_today()
    if (
        receivable.status in (ReceivableStatus.PENDING, ReceivableStatus.PARTIAL)
        and receivable.due_date < today
    ):
        return ReceivableStatus.OVERDUE
    return receivable.status


# --- expenses -----------------------------------------------------------------------------


def expenses_in(f: Filters):
    return Expense.objects.filter(
        voided_at__isnull=True,
        currency=f.currency,
        incurred_on__gte=f.date_from,
        incurred_on__lte=f.date_to,
    )


def expense_totals(f: Filters) -> dict:
    """Expenses attributable to the filter scope (portfolio or one project)."""
    base = expenses_in(f)
    if f.project is None:
        total = _sum(base, "amount")
        general = base.filter(project__isnull=True)
        general_total = _sum(general, "amount")
        allocated = _allocated_sum(
            ExpenseAllocation.objects.filter(expense__in=general.values("pk"))
        )
        return {
            "total": total,
            "direct": q(total - general_total),
            "general": general_total,
            "general_allocated": allocated,
            "general_unallocated": q(general_total - allocated),
        }
    direct = _sum(base.filter(project=f.project), "amount")
    allocated = _allocated_sum(
        ExpenseAllocation.objects.filter(
            project=f.project, expense__in=base.filter(project__isnull=True).values("pk")
        )
    )
    return {"total": q(direct + allocated), "direct": direct, "allocated": allocated}


def _allocated_sum(allocations) -> Decimal:
    return q(
        allocations.aggregate(
            total=Coalesce(
                Sum(F("expense__amount") * F("percentage") / HUNDRED, output_field=MONEY_FIELD),
                Value(ZERO),
                output_field=MONEY_FIELD,
            )
        )["total"]
    )


# --- profitability ------------------------------------------------------------------------


def profit_block(collected: Decimal, expenses: Decimal | None) -> dict:
    if expenses is None:
        return {"profit": None, "margin_pct": None}
    profit = q(collected - expenses)
    return {"profit": profit, "margin_pct": pct(profit, collected)}


def monthly_series(f: Filters) -> list[dict]:
    """Collected income (by commercial model), expenses and profit per calendar month."""
    by_kind = defaultdict(lambda: defaultdict(lambda: ZERO))
    rows = (
        payments_in(f)
        .annotate(month=TruncMonth("paid_on"))
        .values("month", "receivable__contract__kind")
        .annotate(total=Sum("amount"))
    )
    for row in rows:
        by_kind[row["month"]][row["receivable__contract__kind"]] += row["total"]

    expenses = defaultdict(lambda: ZERO)
    base = expenses_in(f)
    if f.project is None:
        for row in (
            base.annotate(month=TruncMonth("incurred_on"))
            .values("month")
            .annotate(total=Sum("amount"))
        ):
            expenses[row["month"]] += row["total"]
    else:
        for row in (
            base.filter(project=f.project)
            .annotate(month=TruncMonth("incurred_on"))
            .values("month")
            .annotate(total=Sum("amount"))
        ):
            expenses[row["month"]] += row["total"]
        for row in (
            ExpenseAllocation.objects.filter(
                project=f.project, expense__in=base.filter(project__isnull=True).values("pk")
            )
            .annotate(month=TruncMonth("expense__incurred_on"))
            .values("month")
            .annotate(
                total=Sum(
                    F("expense__amount") * F("percentage") / HUNDRED, output_field=MONEY_FIELD
                )
            )
        ):
            expenses[row["month"]] += row["total"]

    series = []
    for month in months_between(f.date_from, f.date_to):
        sales = q(by_kind[month][ContractKind.SALE])
        subscriptions = q(by_kind[month][ContractKind.SUBSCRIPTION])
        collected = q(sales + subscriptions)
        month_expenses = None if f.kind else q(expenses[month])
        series.append(
            {
                "month": month,
                "collected": collected,
                "collected_sales": sales,
                "collected_subscriptions": subscriptions,
                "expenses": month_expenses,
                **profit_block(collected, month_expenses),
            }
        )
    return series


def project_breakdown(f: Filters) -> list[dict]:
    """Collected, attributable expenses, profit and margin per project in the period."""
    collected = {
        row["receivable__contract__project"]: row["total"]
        for row in payments_in(f)
        .values("receivable__contract__project")
        .annotate(total=Sum("amount"))
    }
    base = expenses_in(f)
    direct = {
        row["project"]: row["total"]
        for row in base.filter(project__isnull=False)
        .values("project")
        .annotate(total=Sum("amount"))
    }
    allocated = {
        row["project"]: row["total"]
        for row in ExpenseAllocation.objects.filter(
            expense__in=base.filter(project__isnull=True).values("pk")
        )
        .values("project")
        .annotate(
            total=Sum(F("expense__amount") * F("percentage") / HUNDRED, output_field=MONEY_FIELD)
        )
    }
    ids = set(collected) | set(direct) | set(allocated)
    if f.project is not None:
        ids &= {f.project.pk}
    projects = {p.pk: p for p in Project.objects.filter(pk__in=ids)}
    rows = []
    for pk in ids:
        income = q(collected.get(pk, ZERO))
        expenses = None if f.kind else q(direct.get(pk, ZERO) + allocated.get(pk, ZERO))
        rows.append(
            {
                "project": pk,
                "project_name": projects[pk].name,
                "collected": income,
                "expenses": expenses,
                **profit_block(income, expenses),
            }
        )
    rows.sort(key=lambda r: (r["profit"] is None, -(r["profit"] or r["collected"])))
    return rows


def contract_counts(f: Filters) -> dict:
    contracts = Contract.objects.filter(f.contract_q())
    active = contracts.filter(status=ContractStatus.ACTIVE)
    return {
        "active_contracts": active.count(),
        "projects_with_active_contracts": active.values("project").distinct().count(),
        "organizations_with_active_contracts": active.values("organization").distinct().count(),
        "active_subscriptions": active.filter(kind=ContractKind.SUBSCRIPTION).count(),
        "sales_in_period": contracts.filter(
            kind=ContractKind.SALE,
            status__in=(ContractStatus.ACTIVE, ContractStatus.FINISHED),
            start_date__gte=f.date_from,
            start_date__lte=f.date_to,
        ).count(),
    }


def catalog_counts() -> dict:
    projects = Project.objects.active()
    commercial = projects.filter(commercial_profile__status__in=list(ALLOWED_KINDS))
    return {"total_projects": projects.count(), "commercial_projects": commercial.count()}


def financial_summary(f: Filters, today: date | None = None) -> dict:
    today = today or business_today()
    collected = _sum(payments_in(f), "amount")
    expected = _sum(receivables_due_in(f), "expected_amount")
    overdue = overdue_receivables(f, today)
    expenses = None if f.kind else expense_totals(f)
    by_kind = {
        row["receivable__contract__kind"]: q(row["total"])
        for row in payments_in(f).values("receivable__contract__kind").annotate(total=Sum("amount"))
    }
    sales = by_kind.get(ContractKind.SALE, ZERO)
    subscriptions = by_kind.get(ContractKind.SUBSCRIPTION, ZERO)
    return {
        "currency": f.currency,
        "date_from": f.date_from,
        "date_to": f.date_to,
        **catalog_counts(),
        **contract_counts(f),
        "collected": collected,
        "expected": expected,
        "overdue_amount": _sum(overdue, "outstanding_amount"),
        "overdue_count": overdue.count(),
        "expenses": expenses["total"] if expenses else None,
        "expenses_breakdown": expenses,
        **profit_block(collected, expenses["total"] if expenses else None),
        "revenue_mix": {
            "sales": sales,
            "subscriptions": subscriptions,
            "sales_pct": pct(sales, collected),
            "subscriptions_pct": pct(subscriptions, collected),
        },
        "series": monthly_series(f),
        "projects": project_breakdown(f),
        "other_currencies": other_currencies(f),
        "is_estimate": True,
    }


def other_currencies(f: Filters) -> list[str]:
    """Currencies with movements in the period other than the selected one (never summed)."""
    found = set(
        confirmed_payments()
        .filter(paid_on__gte=f.date_from, paid_on__lte=f.date_to)
        .values_list("receivable__currency", flat=True)
    ) | set(
        Expense.objects.filter(
            voided_at__isnull=True, incurred_on__gte=f.date_from, incurred_on__lte=f.date_to
        ).values_list("currency", flat=True)
    )
    return sorted(found - {f.currency})


# --- recurring revenue (MRR / ARR) --------------------------------------------------------


def subscriptions_for(f: Filters):
    return (
        Contract.objects.filter(f.contract_q(), kind=ContractKind.SUBSCRIPTION, currency=f.currency)
        .select_related("project", "organization")
        .prefetch_related(
            Prefetch("prices", queryset=ContractPrice.objects.order_by("effective_from")),
            Prefetch(
                "status_changes",
                queryset=ContractStatusChange.objects.order_by("effective_date", "created_at"),
            ),
        )
    )


def status_at(contract: Contract, day: date) -> str | None:
    current = None
    for change in contract.status_changes.all():
        if change.effective_date > day:
            break
        current = change.to_status
    return current


def price_at(contract: Contract, day: date) -> Decimal | None:
    current = None
    for price in contract.prices.all():
        if price.effective_from > day:
            break
        current = price.amount
    return current


def in_force(contract: Contract, day: date) -> bool:
    return contract.start_date <= day and (contract.end_date is None or day <= contract.end_date)


def normalized_amount(contract: Contract, day: date) -> Decimal:
    """Monthly value of the contract's price valid at `day` (no rounding)."""
    price = price_at(contract, day)
    if price is None or contract.billing_period not in PERIOD_MONTHS:
        return Decimal(0)
    return Decimal(price) / PERIOD_MONTHS[contract.billing_period]


def contract_mrr_at(contract: Contract, day: date) -> Decimal:
    if contract.kind != ContractKind.SUBSCRIPTION or not in_force(contract, day):
        return Decimal(0)
    if status_at(contract, day) != ContractStatus.ACTIVE:
        return Decimal(0)
    return normalized_amount(contract, day)


def was_active_before(contract: Contract, day: date) -> bool:
    return any(
        c.to_status == ContractStatus.ACTIVE and c.effective_date <= day
        for c in contract.status_changes.all()
    )


def snapshot(contracts, day: date) -> dict:
    total = Decimal(0)
    by_project: dict = {}
    organizations = set()
    active = suspended = 0
    suspended_value = Decimal(0)
    for contract in contracts:
        value = contract_mrr_at(contract, day)
        if value:
            active += 1
            total += value
            organizations.add(contract.organization_id)
            row = by_project.setdefault(
                contract.project_id,
                {
                    "project": contract.project_id,
                    "project_name": contract.project.name,
                    "mrr": Decimal(0),
                    "contracts": 0,
                },
            )
            row["mrr"] += value
            row["contracts"] += 1
        elif in_force(contract, day) and status_at(contract, day) == ContractStatus.SUSPENDED:
            suspended += 1
            suspended_value += normalized_amount(contract, day)
    projects = sorted(
        (
            {
                **r,
                "mrr": q(r["mrr"]),
                "arr": q(r["mrr"] * 12),
                "average_per_contract": q(r["mrr"] / r["contracts"]),
            }
            for r in by_project.values()
        ),
        key=lambda r: -r["mrr"],
    )
    return {
        "mrr": q(total),
        "arr": q(total * 12),
        "active_contracts": active,
        "organizations": len(organizations),
        "average_per_contract": q(total / active) if active else None,
        "suspended_contracts": suspended,
        "suspended_mrr": q(suspended_value),
        "by_project": projects,
    }


MOVEMENTS = ("new", "reactivation", "expansion", "contraction", "suspension", "cancellation")


def movements(contracts, prev_day: date, day: date) -> dict:
    """Classify the MRR change of every contract between two snapshots.

    The amounts add up exactly to MRR(day) - MRR(prev_day).
    """
    result = {key: {"count": 0, "amount": Decimal(0)} for key in MOVEMENTS}
    for contract in contracts:
        before = contract_mrr_at(contract, prev_day)
        after = contract_mrr_at(contract, day)
        if before == after:
            continue
        if not before:
            key = "reactivation" if was_active_before(contract, prev_day) else "new"
        elif not after:
            key = (
                "suspension"
                if status_at(contract, day) == ContractStatus.SUSPENDED and in_force(contract, day)
                else "cancellation"
            )
        else:
            key = "expansion" if after > before else "contraction"
        result[key]["count"] += 1
        result[key]["amount"] += after - before
    return {k: {"count": v["count"], "amount": q(v["amount"])} for k, v in result.items()}


def growth(current: Decimal, previous: Decimal) -> dict:
    """MRR growth %. With no previous MRR the percentage is not defined (N/A)."""
    if not previous:
        return {"growth_pct": None, "is_new_recurring_revenue": bool(current)}
    return {
        "growth_pct": q((Decimal(current) - Decimal(previous)) / Decimal(previous) * HUNDRED),
        "is_new_recurring_revenue": False,
    }


def snapshot_day(month: date, today: date) -> date:
    """Month-end snapshot; the current month uses today."""
    return min(month_end(month), today)


def mrr_history(contracts, months: list[date], today: date) -> list[dict]:
    history = []
    for month in months:
        if month > today:
            break
        day = snapshot_day(month, today)
        prev_day = month - timedelta(days=1)
        current = snapshot(contracts, day)
        previous_mrr = snapshot(contracts, prev_day)["mrr"]
        history.append(
            {
                "month": month,
                "as_of": day,
                "mrr": current["mrr"],
                "arr": current["arr"],
                "active_contracts": current["active_contracts"],
                "previous_mrr": previous_mrr,
                **growth(current["mrr"], previous_mrr),
                "movements": movements(contracts, prev_day, day),
            }
        )
    return history


def recurring_summary(f: Filters, today: date | None = None) -> dict:
    today = today or business_today()
    contracts = list(subscriptions_for(f))
    current = snapshot(contracts, today)
    prev_day = month_start(today) - timedelta(days=1)
    previous_mrr = snapshot(contracts, prev_day)["mrr"]

    sub = replace(f, kind=ContractKind.SUBSCRIPTION)
    collected_total = _sum(payments_in(replace(f, kind=None)), "amount")
    collected_sales = _sum(payments_in(replace(f, kind=ContractKind.SALE)), "amount")
    recurring_collected = _sum(payments_in(sub), "amount")
    pending = with_paid(
        receivables_due_in(sub).filter(
            status__in=(ReceivableStatus.PENDING, ReceivableStatus.PARTIAL)
        )
    )
    return {
        "currency": f.currency,
        "as_of": today,
        **current,
        "previous_month_mrr": previous_mrr,
        "previous_month_as_of": prev_day,
        **growth(current["mrr"], previous_mrr),
        "recurring_collected": recurring_collected,
        "recurring_pending": _sum(pending, "outstanding_amount"),
        "sales_collected": collected_sales,
        "subscriptions_pct": pct(recurring_collected, collected_total),
        "sales_pct": pct(collected_sales, collected_total),
        "history": mrr_history(contracts, months_between(f.date_from, f.date_to), today),
    }


# --- per project --------------------------------------------------------------------------


def modalities(status: str) -> list[str]:
    return sorted(ALLOWED_KINDS.get(status, set()))


def project_summary(project: Project, f: Filters, today: date | None = None) -> dict:
    today = today or business_today()
    scoped = replace(f, project=project)
    finance = financial_summary(scoped, today)
    recurring = recurring_summary(replace(scoped, kind=None), today)
    profile = getattr(project, "commercial_profile", None)
    status = profile.status if profile else CommercialStatus.NOT_COMMERCIAL
    sales_scope = replace(scoped, kind=ContractKind.SALE)
    return {
        "project": project.pk,
        "project_name": project.name,
        "commercial_status": status,
        "commercial_status_label": CommercialStatus(status).label,
        "modalities": modalities(status),
        "end_users_count": profile.end_users_count if profile else None,
        "currency": f.currency,
        "date_from": f.date_from,
        "date_to": f.date_to,
        "active_contracts": finance["active_contracts"],
        "organizations_with_active_contracts": finance["organizations_with_active_contracts"],
        "collected": finance["collected"],
        "sales_collected": _sum(payments_in(sales_scope), "amount"),
        "expected": finance["expected"],
        "overdue_amount": finance["overdue_amount"],
        "overdue_count": finance["overdue_count"],
        "expenses": finance["expenses"],
        "expenses_breakdown": finance["expenses_breakdown"],
        "profit": finance["profit"],
        "margin_pct": finance["margin_pct"],
        "mrr": recurring["mrr"],
        "arr": recurring["arr"],
        "recurring_contracts": recurring["active_contracts"],
        "average_per_contract": recurring["average_per_contract"],
        "growth_pct": recurring["growth_pct"],
        "is_new_recurring_revenue": recurring["is_new_recurring_revenue"],
        "suspended_contracts": recurring["suspended_contracts"],
        "series": finance["series"],
        "mrr_history": recurring["history"],
        "is_estimate": True,
    }
