"""Fase 7: cálculos financieros (rentabilidad, MRR, ARR, crecimiento y movimientos)."""

from datetime import date
from decimal import Decimal

import pytest

from apps.commercial import metrics, services
from apps.commercial.models import (
    BillingPeriod,
    CommercialStatus,
    ContractKind,
    ContractStatus,
    ExpenseCategory,
    PaymentMethod,
)

pytestmark = pytest.mark.django_db

D = Decimal


@pytest.fixture
def today(monkeypatch):
    """Controls the business calendar used by services and metrics."""
    state = {"day": date(2026, 6, 15)}
    monkeypatch.setattr(metrics, "business_today", lambda: state["day"])

    def _set(day: date) -> date:
        state["day"] = day
        return day

    _set.get = lambda: state["day"]
    return _set


@pytest.fixture
def app(make_project, admin_user):
    project = make_project("Agenda Pro")
    services.update_profile(
        project, actor=admin_user, data={"status": CommercialStatus.FOR_SALE_AND_RENT}
    )
    return project


@pytest.fixture
def new_contract(admin_user, make_org):
    def _make(
        project,
        *,
        amount,
        kind=ContractKind.SUBSCRIPTION,
        period=BillingPeriod.MONTHLY,
        start=date(2026, 1, 1),
        activate_on=None,
        org=None,
        currency="MXN",
        end=None,
    ):
        contract = services.create_contract(
            project=project,
            organization=org or make_org(),
            kind=kind,
            amount=D(amount),
            start_date=start,
            end_date=end,
            billing_period=period if kind == ContractKind.SUBSCRIPTION else "",
            currency=currency,
            actor=admin_user,
        )
        if activate_on is not None:
            services.transition(
                contract,
                to_status=ContractStatus.ACTIVE,
                effective_date=activate_on,
                actor=admin_user,
            )
        return contract

    return _make


def f(
    project=None,
    *,
    date_from=date(2026, 1, 1),
    date_to=date(2026, 6, 15),
    kind=None,
    currency="MXN",
):
    return metrics.Filters(date_from, date_to, currency, project, kind)


def mrr(project=None):
    return metrics.recurring_summary(f(project))


# --- B.7.7 1–5: normalización por periodicidad ---------------------------------------------


@pytest.mark.parametrize(
    ("period", "amount", "expected"),
    [
        (BillingPeriod.MONTHLY, "1200.00", D("1200.00")),
        (BillingPeriod.QUARTERLY, "3000.00", D("1000.00")),
        (BillingPeriod.SEMIANNUAL, "6000.00", D("1000.00")),
        (BillingPeriod.ANNUAL, "12000.00", D("1000.00")),
    ],
)
def test_mrr_normalizes_each_billing_period(today, app, new_contract, period, amount, expected):
    new_contract(app, amount=amount, period=period, activate_on=date(2026, 1, 1))
    result = mrr(app)
    assert result["mrr"] == expected
    assert result["arr"] == expected * 12
    assert result["active_contracts"] == 1


def test_mrr_example_from_the_specification_is_9000(today, app, new_contract):
    for _ in range(5):
        new_contract(app, amount="1200", activate_on=date(2026, 1, 1))
    for _ in range(2):
        new_contract(
            app, amount="3000", period=BillingPeriod.QUARTERLY, activate_on=date(2026, 1, 1)
        )
    new_contract(app, amount="12000", period=BillingPeriod.ANNUAL, activate_on=date(2026, 1, 1))
    result = mrr(app)
    assert result["mrr"] == D("9000.00")
    assert result["arr"] == D("108000.00")
    assert result["active_contracts"] == 8
    assert result["organizations"] == 8
    assert result["average_per_contract"] == D("1125.00")  # MRR / contratos, no usuarios


def test_mrr_uses_decimal_without_float_errors(today, app, new_contract):
    for _ in range(3):
        new_contract(
            app, amount="1000", period=BillingPeriod.QUARTERLY, activate_on=date(2026, 1, 1)
        )
    assert mrr(app)["mrr"] == D("1000.00")  # 3 × 333.33… = 1000.00 exactly
    assert isinstance(mrr(app)["mrr"], Decimal)


# --- B.7.7 6–9: exclusiones -----------------------------------------------------------------


def test_one_time_sale_is_excluded_from_mrr(today, app, new_contract):
    new_contract(app, amount="50000", kind=ContractKind.SALE, activate_on=date(2026, 2, 1))
    new_contract(app, amount="1200", activate_on=date(2026, 1, 1))
    assert mrr(app)["mrr"] == D("1200.00")


def test_cancelled_contract_is_excluded(today, app, new_contract, admin_user):
    contract = new_contract(app, amount="1200", activate_on=date(2026, 1, 1))
    services.transition(
        contract,
        to_status=ContractStatus.CANCELLED,
        effective_date=date(2026, 4, 20),
        reason="Cliente cerró operaciones",
        actor=admin_user,
    )
    assert mrr(app)["mrr"] == D("0.00")


def test_draft_and_pending_contracts_are_excluded(today, app, new_contract, admin_user):
    new_contract(app, amount="1200")  # draft
    pending = new_contract(app, amount="900")
    services.transition(pending, to_status=ContractStatus.PENDING, actor=admin_user)
    assert mrr(app)["mrr"] == D("0.00")


def test_future_contract_is_excluded_until_it_starts(today, app, new_contract):
    new_contract(app, amount="1200", start=date(2026, 7, 1), activate_on=date(2026, 6, 15))
    assert mrr(app)["mrr"] == D("0.00")
    today(date(2026, 7, 1))
    assert mrr(app)["mrr"] == D("1200.00")


def test_finished_by_end_date_is_excluded(today, app, new_contract):
    new_contract(app, amount="1200", activate_on=date(2026, 1, 1), end=date(2026, 5, 31))
    assert mrr(app)["mrr"] == D("0.00")


def test_suspended_contract_is_excluded_and_reported_separately(
    today, app, new_contract, admin_user
):
    contract = new_contract(app, amount="1200", activate_on=date(2026, 1, 1))
    services.transition(
        contract,
        to_status=ContractStatus.SUSPENDED,
        effective_date=date(2026, 6, 1),
        actor=admin_user,
    )
    result = mrr(app)
    assert result["mrr"] == D("0.00")
    assert result["suspended_contracts"] == 1
    assert result["suspended_mrr"] == D("1200.00")


# --- B.7.7 10–14: precio, histórico, ARR global y crecimiento ------------------------------


def test_price_change_keeps_history_and_is_not_retroactive(today, app, new_contract, admin_user):
    contract = new_contract(app, amount="1000", activate_on=date(2026, 1, 1))
    today(date(2026, 3, 1))
    services.change_price(
        contract, amount=D("1500"), effective_from=date(2026, 3, 1), actor=admin_user
    )
    today(date(2026, 6, 15))
    history = {h["month"]: h for h in mrr(app)["history"]}
    assert history[date(2026, 1, 1)]["mrr"] == D("1000.00")
    assert history[date(2026, 2, 1)]["mrr"] == D("1000.00")
    assert history[date(2026, 3, 1)]["mrr"] == D("1500.00")
    assert history[date(2026, 3, 1)]["movements"]["expansion"] == {
        "count": 1,
        "amount": D("500.00"),
    }
    assert [p.amount for p in contract.prices.order_by("effective_from")] == [D("1000"), D("1500")]

    from common.exceptions import DomainError

    with pytest.raises(DomainError) as exc:
        services.change_price(
            contract, amount=D("900"), effective_from=date(2026, 5, 1), actor=admin_user
        )
    assert exc.value.code == "retroactive_change"


def test_price_decrease_is_a_contraction(today, app, new_contract, admin_user):
    contract = new_contract(app, amount="2000", activate_on=date(2026, 1, 1))
    today(date(2026, 4, 1))
    services.change_price(
        contract, amount=D("1500"), effective_from=date(2026, 4, 1), actor=admin_user
    )
    today(date(2026, 6, 15))
    april = next(h for h in mrr(app)["history"] if h["month"] == date(2026, 4, 1))
    assert april["movements"]["contraction"] == {"count": 1, "amount": D("-500.00")}
    assert april["growth_pct"] == D("-25.00")


def test_historical_mrr_and_movements_add_up(today, app, new_contract, admin_user, make_org):
    a = new_contract(app, amount="1000", activate_on=date(2026, 1, 1))
    b = new_contract(
        app,
        amount="3000",
        period=BillingPeriod.QUARTERLY,
        start=date(2026, 2, 1),
        activate_on=date(2026, 2, 1),
    )
    c = new_contract(app, amount="500", start=date(2026, 3, 1), activate_on=date(2026, 3, 1))
    services.transition(
        a, to_status=ContractStatus.SUSPENDED, effective_date=date(2026, 3, 10), actor=admin_user
    )
    services.transition(
        c,
        to_status=ContractStatus.CANCELLED,
        effective_date=date(2026, 4, 20),
        reason="Baja",
        actor=admin_user,
    )
    services.transition(
        a, to_status=ContractStatus.ACTIVE, effective_date=date(2026, 5, 5), actor=admin_user
    )
    history = {h["month"]: h for h in mrr(app)["history"]}

    assert [history[date(2026, m, 1)]["mrr"] for m in range(1, 7)] == [
        D("1000.00"),
        D("2000.00"),
        D("1500.00"),
        D("1000.00"),
        D("2000.00"),
        D("2000.00"),
    ]
    assert history[date(2026, 1, 1)]["movements"]["new"] == {"count": 1, "amount": D("1000.00")}
    assert history[date(2026, 2, 1)]["movements"]["new"] == {"count": 1, "amount": D("1000.00")}
    march = history[date(2026, 3, 1)]["movements"]
    assert march["new"] == {"count": 1, "amount": D("500.00")}
    assert march["suspension"] == {"count": 1, "amount": D("-1000.00")}
    assert history[date(2026, 4, 1)]["movements"]["cancellation"] == {
        "count": 1,
        "amount": D("-500.00"),
    }
    assert history[date(2026, 5, 1)]["movements"]["reactivation"] == {
        "count": 1,
        "amount": D("1000.00"),
    }
    for row in history.values():
        total = sum(m["amount"] for m in row["movements"].values())
        assert total == row["mrr"] - row["previous_mrr"]
    assert b.pk  # the quarterly contract stays active through the period


def test_global_arr_sums_every_application(today, make_project, admin_user, new_contract):
    apps_ = []
    for name in ("App Uno", "App Dos"):
        p = make_project(name)
        services.update_profile(p, actor=admin_user, data={"status": CommercialStatus.FOR_RENT})
        apps_.append(p)
    new_contract(apps_[0], amount="1200", activate_on=date(2026, 1, 1))
    new_contract(
        apps_[1], amount="6000", period=BillingPeriod.SEMIANNUAL, activate_on=date(2026, 1, 1)
    )
    result = mrr()
    assert result["mrr"] == D("2200.00")
    assert result["arr"] == D("26400.00")
    assert [r["project_name"] for r in result["by_project"]] == ["App Uno", "App Dos"]
    assert result["by_project"][0]["arr"] == D("14400.00")


def test_monthly_growth(today, app, new_contract):
    new_contract(app, amount="1000", activate_on=date(2026, 1, 1))
    new_contract(app, amount="500", start=date(2026, 6, 1), activate_on=date(2026, 6, 1))
    result = mrr(app)
    assert result["previous_month_mrr"] == D("1000.00")
    assert result["mrr"] == D("1500.00")
    assert result["growth_pct"] == D("50.00")
    assert result["is_new_recurring_revenue"] is False


def test_growth_with_zero_previous_mrr_is_not_a_division(today, app, new_contract):
    new_contract(app, amount="1000", start=date(2026, 6, 1), activate_on=date(2026, 6, 1))
    result = mrr(app)
    assert result["previous_month_mrr"] == D("0.00")
    assert result["growth_pct"] is None
    assert result["is_new_recurring_revenue"] is True
    assert metrics.growth(D("0"), D("0")) == {"growth_pct": None, "is_new_recurring_revenue": False}


# --- B.7.7 15: MRR contratado ≠ dinero cobrado --------------------------------------------


def test_collected_recurring_income_differs_from_contracted_mrr(
    today, app, new_contract, admin_user
):
    contract = new_contract(
        app, amount="1200", activate_on=date(2026, 6, 1), start=date(2026, 6, 1)
    )
    receivable = services.generate_next_receivable(contract, actor=admin_user)
    result = mrr(app)
    assert result["mrr"] == D("1200.00")
    assert result["recurring_collected"] == D("0.00")
    assert result["recurring_pending"] == D("1200.00")
    services.record_payment(
        receivable=receivable,
        amount=D("500"),
        paid_on=date(2026, 6, 10),
        method=PaymentMethod.TRANSFER,
        actor=admin_user,
    )
    result = mrr(app)
    assert result["mrr"] == D("1200.00")
    assert result["recurring_collected"] == D("500.00")
    assert result["recurring_pending"] == D("700.00")


# --- rentabilidad (B.15 10–12, gastos compartidos) -----------------------------------------


def _paid_sale(new_contract, project, admin_user, amount, paid_on, **kw):
    contract = new_contract(
        project, amount=amount, kind=ContractKind.SALE, start=paid_on, activate_on=paid_on, **kw
    )
    receivable = services.create_receivable(
        contract=contract,
        concept="Pago único",
        due_date=paid_on,
        expected_amount=D(amount),
        actor=admin_user,
    )
    services.record_payment(
        receivable=receivable,
        amount=D(amount),
        paid_on=paid_on,
        method=PaymentMethod.TRANSFER,
        actor=admin_user,
    )
    return contract


def test_profit_and_margin(today, app, new_contract, admin_user):
    _paid_sale(new_contract, app, admin_user, "10000", date(2026, 3, 10))
    services.create_expense(
        concept="Hosting",
        category=ExpenseCategory.HOSTING,
        amount=D("2500"),
        incurred_on=date(2026, 3, 1),
        project=app,
        actor=admin_user,
    )
    summary = metrics.financial_summary(f())
    assert summary["collected"] == D("10000.00")
    assert summary["expenses"] == D("2500.00")
    assert summary["profit"] == D("7500.00")
    assert summary["margin_pct"] == D("75.00")
    assert summary["is_estimate"] is True
    assert summary["revenue_mix"]["sales_pct"] == D("100.00")
    assert summary["revenue_mix"]["subscriptions_pct"] == D("0.00")


def test_period_without_income_has_no_margin(today, app, admin_user):
    services.create_expense(
        concept="Dominio",
        category=ExpenseCategory.DOMAINS,
        amount=D("300"),
        incurred_on=date(2026, 2, 1),
        project=app,
        actor=admin_user,
    )
    summary = metrics.financial_summary(f())
    assert summary["collected"] == D("0.00")
    assert summary["profit"] == D("-300.00")
    assert summary["margin_pct"] is None
    assert summary["revenue_mix"]["sales_pct"] is None


def test_empty_period_returns_zeros_not_fake_data(today):
    summary = metrics.financial_summary(f())
    assert summary["collected"] == D("0.00")
    assert summary["expenses"] == D("0.00")
    assert summary["profit"] == D("0.00")
    assert summary["margin_pct"] is None
    assert summary["projects"] == []
    assert all(m["collected"] == D("0.00") for m in summary["series"])


def test_shared_expenses_are_allocated_without_duplication(today, make_project, admin_user):
    a, b = make_project("Alfa"), make_project("Beta")
    general = services.create_expense(
        concept="Internet del Home Lab",
        category=ExpenseCategory.INTERNET,
        amount=D("1000"),
        incurred_on=date(2026, 5, 1),
        actor=admin_user,
    )
    services.set_allocations(general, allocations=[(a, D("30")), (b, D("20"))], actor=admin_user)
    services.create_expense(
        concept="Licencia",
        category=ExpenseCategory.LICENSES,
        amount=D("200"),
        incurred_on=date(2026, 5, 2),
        project=a,
        actor=admin_user,
    )
    portfolio = metrics.financial_summary(f())
    assert portfolio["expenses"] == D("1200.00")  # each expense once
    assert portfolio["expenses_breakdown"]["general_allocated"] == D("500.00")
    assert portfolio["expenses_breakdown"]["general_unallocated"] == D("500.00")
    assert metrics.financial_summary(f(a))["expenses"] == D("500.00")  # 200 + 30% of 1000
    assert metrics.financial_summary(f(b))["expenses"] == D("200.00")
    by_project = {r["project_name"]: r["expenses"] for r in portfolio["projects"]}
    assert by_project == {"Alfa": D("500.00"), "Beta": D("200.00")}


def test_voided_expense_is_not_counted(today, app, admin_user):
    expense = services.create_expense(
        concept="Duplicado",
        category=ExpenseCategory.OTHER,
        amount=D("999"),
        incurred_on=date(2026, 5, 1),
        project=app,
        actor=admin_user,
    )
    services.void_expense(expense, reason="Registrado dos veces", actor=admin_user)
    assert metrics.financial_summary(f())["expenses"] == D("0.00")


def test_quarter_and_year_come_from_real_movements(today, app, new_contract, admin_user):
    _paid_sale(new_contract, app, admin_user, "1000", date(2026, 1, 15))
    contract = new_contract(app, amount="500", start=date(2026, 4, 1), activate_on=date(2026, 4, 1))
    receivable = services.generate_next_receivable(contract, actor=admin_user)
    services.record_payment(
        receivable=receivable,
        amount=D("500"),
        paid_on=date(2026, 4, 3),
        method=PaymentMethod.CASH,
        actor=admin_user,
    )
    q1 = metrics.financial_summary(f(date_from=date(2026, 1, 1), date_to=date(2026, 3, 31)))
    q2 = metrics.financial_summary(f(date_from=date(2026, 4, 1), date_to=date(2026, 6, 15)))
    year = metrics.financial_summary(f(date_from=date(2026, 1, 1), date_to=date(2026, 6, 15)))
    assert q1["collected"] == D("1000.00")
    assert q2["collected"] == D("500.00")  # not 3 × a month
    assert year["collected"] == D("1500.00")
    april = next(m for m in year["series"] if m["month"] == date(2026, 4, 1))
    assert april["collected_subscriptions"] == D("500.00")


def test_kind_filter_restricts_income_and_does_not_invent_expenses(
    today, app, new_contract, admin_user
):
    _paid_sale(new_contract, app, admin_user, "1000", date(2026, 2, 1))
    services.create_expense(
        concept="Hosting",
        category=ExpenseCategory.HOSTING,
        amount=D("100"),
        incurred_on=date(2026, 2, 1),
        project=app,
        actor=admin_user,
    )
    summary = metrics.financial_summary(f(kind=ContractKind.SUBSCRIPTION))
    assert summary["collected"] == D("0.00")
    assert summary["expenses"] is None
    assert summary["profit"] is None


def test_currencies_are_never_added_together(today, app, new_contract, admin_user):
    _paid_sale(new_contract, app, admin_user, "1000", date(2026, 2, 1))
    _paid_sale(new_contract, app, admin_user, "50", date(2026, 2, 2), currency="USD")
    mxn = metrics.financial_summary(f())
    usd = metrics.financial_summary(f(currency="USD"))
    assert mxn["collected"] == D("1000.00")
    assert usd["collected"] == D("50.00")
    assert mxn["other_currencies"] == ["USD"]


def test_project_summary_combines_profitability_and_recurring(today, app, new_contract, admin_user):
    new_contract(app, amount="1200", activate_on=date(2026, 1, 1))
    _paid_sale(new_contract, app, admin_user, "3000", date(2026, 3, 1))
    summary = metrics.project_summary(app, f())
    assert summary["commercial_status"] == CommercialStatus.FOR_SALE_AND_RENT
    assert summary["modalities"] == ["SALE", "SUBSCRIPTION"]
    assert summary["mrr"] == D("1200.00")
    assert summary["arr"] == D("14400.00")
    assert summary["recurring_contracts"] == 1
    assert summary["average_per_contract"] == D("1200.00")
    assert summary["sales_collected"] == D("3000.00")
    assert summary["active_contracts"] == 2
    assert summary["organizations_with_active_contracts"] == 2
