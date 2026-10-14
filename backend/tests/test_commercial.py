"""Fase 7: contratos, cobros, pagos, gastos, integridad, permisos y portal (vía API)."""

from datetime import date
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditAction, AuditLog
from apps.commercial import metrics, services
from apps.commercial.models import (
    CommercialStatus,
    Contract,
    Payment,
    Receivable,
    ReceivableStatus,
)
from apps.projects.models import ProjectAccess
from apps.users import services as user_services
from apps.users.roles import Role

from .conftest import PASSWORD

pytestmark = pytest.mark.django_db

API = "/api/v1/commercial/"
D = Decimal
TODAY = date(2026, 6, 15)


@pytest.fixture(autouse=True)
def _today(monkeypatch):
    monkeypatch.setattr(metrics, "business_today", lambda: TODAY)


@pytest.fixture
def admin(as_user, admin_user):
    return as_user(admin_user)


@pytest.fixture
def app(make_project, admin_user):
    project = make_project("Inventarios")
    services.update_profile(
        project, actor=admin_user, data={"status": CommercialStatus.FOR_SALE_AND_RENT}
    )
    return project


@pytest.fixture
def acme(make_org, client_user):
    return make_org("Acme", members=(client_user,))


def create(client, app, org, **extra):
    payload = {
        "project": str(app.pk),
        "organization": str(org.pk),
        "kind": "SUBSCRIPTION",
        "billing_period": "MONTHLY",
        "amount": "1200.00",
        "start_date": "2026-06-01",
        **extra,
    }
    return client.post(f"{API}contracts/", payload)


def activate(client, contract_id, effective_date=None):
    body = {"to_status": "ACTIVE"}
    if effective_date:
        body["effective_date"] = effective_date
    return client.post(f"{API}contracts/{contract_id}/transition/", body)


# --- B.15 1–6: ventas, rentas y combinaciones ---------------------------------------------


def test_one_time_sale(admin, app, acme):
    res = create(
        admin,
        app,
        acme,
        kind="SALE",
        billing_period="",
        amount="45000.00",
        terms="Licencia de uso; el código fuente no se transfiere.",
    )
    assert res.status_code == 201, res.data
    assert res.data["kind"] == "SALE"
    assert res.data["status"] == "DRAFT"
    assert res.data["amount"] == "45000.00"
    assert res.data["monthly_value"] is None
    assert res.data["billing_period"] == ""
    assert AuditLog.objects.filter(action=AuditAction.CONTRACT_CREATED).exists()


def test_sale_with_period_is_rejected(admin, app, acme):
    res = create(admin, app, acme, kind="SALE", billing_period="MONTHLY")
    assert res.status_code == 400
    assert res.data["code"] == "invalid_period"


def test_subscription_requires_period(admin, app, acme):
    res = create(admin, app, acme, billing_period="")
    assert res.status_code == 400
    assert "billing_period" in res.data["fields"]


@pytest.mark.parametrize(("period", "monthly"), [("MONTHLY", "1200.00"), ("ANNUAL", "100.00")])
def test_monthly_and_annual_rentals(admin, app, acme, period, monthly):
    res = create(admin, app, acme, billing_period=period)
    assert activate(admin, res.data["id"]).status_code == 200
    detail = admin.get(f"{API}contracts/{res.data['id']}/").data
    assert detail["status"] == "ACTIVE"
    assert detail["monthly_value"] == monthly
    assert detail["next_billing_date"] == "2026-06-01"


def test_several_clients_rent_one_application(admin, app, make_org):
    for i in range(3):
        res = create(admin, app, make_org(f"Cliente {i}"))
        activate(admin, res.data["id"])
    rows = admin.get(f"{API}applications/", {"commercial": "true"}).data["results"]
    row = next(r for r in rows if r["id"] == str(app.pk))
    assert row["active_subscriptions"] == 3
    assert row["organizations"] == 3
    assert row["mrr"] == "3600.00"


def test_one_client_rents_several_applications(admin, make_project, admin_user, acme):
    for name in ("Uno", "Dos"):
        project = make_project(name)
        services.update_profile(
            project, actor=admin_user, data={"status": CommercialStatus.FOR_RENT}
        )
        activate(admin, create(admin, project, acme).data["id"])
    res = admin.get(f"{API}contracts/", {"organization": str(acme.pk), "status": "ACTIVE"})
    assert res.data["count"] == 2
    summary = admin.get(f"{API}summary/").data
    assert summary["organizations_with_active_contracts"] == 1
    assert summary["projects_with_active_contracts"] == 2


def test_active_and_cancelled_contracts(admin, app, acme, make_org):
    active = create(admin, app, acme).data
    activate(admin, active["id"])
    other = create(admin, app, make_org("Beta")).data
    activate(admin, other["id"])
    res = admin.post(f"{API}contracts/{other['id']}/transition/", {"to_status": "CANCELLED"})
    assert res.status_code == 400  # reason required
    res = admin.post(
        f"{API}contracts/{other['id']}/transition/",
        {"to_status": "CANCELLED", "reason": "Cambio de proveedor"},
    )
    assert res.status_code == 200
    assert res.data["status"] == "CANCELLED"
    assert [c["to_status"] for c in res.data["status_changes"]] == ["DRAFT", "ACTIVE", "CANCELLED"]
    assert admin.get(f"{API}summary/").data["active_subscriptions"] == 1
    assert AuditLog.objects.filter(action=AuditAction.CONTRACT_CANCELLED).count() == 1
    # Cancelled is terminal.
    res = admin.post(f"{API}contracts/{other['id']}/transition/", {"to_status": "ACTIVE"})
    assert res.data["code"] == "invalid_transition"


def test_contract_requires_commercial_availability(admin, make_project, acme):
    project = make_project("Interna")
    res = create(admin, project, acme)
    assert res.status_code == 400
    assert res.data["code"] == "commercial_unavailable"


def test_duplicate_open_contract_is_rejected(admin, app, acme):
    first = create(admin, app, acme).data
    res = create(admin, app, acme)
    assert res.status_code == 400
    assert res.data["code"] == "duplicate"
    # A sale of the same app to the same client is a different model: allowed.
    assert create(admin, app, acme, kind="SALE", billing_period="").status_code == 201
    admin.post(
        f"{API}contracts/{first['id']}/transition/",
        {"to_status": "CANCELLED", "reason": "Error de captura"},
    )
    assert create(admin, app, acme).status_code == 201


def test_contracts_are_never_deleted(admin, app, acme):
    contract = create(admin, app, acme).data
    assert admin.delete(f"{API}contracts/{contract['id']}/").status_code == 405


# --- B.15 7–8, 16: cobros, pagos parciales, vencidos y duplicados -------------------------


def _active_receivable(admin, app, org, **extra):
    contract = create(admin, app, org, **extra).data
    activate(admin, contract["id"])
    res = admin.post(f"{API}contracts/{contract['id']}/generate-receivable/")
    assert res.status_code == 201, res.data
    return contract, res.data


def test_partial_payments_without_double_counting(admin, app, acme):
    _, receivable = _active_receivable(
        admin, app, acme, start_date="2026-06-20", end_date="2027-06-19"
    )
    url = f"{API}payments/"
    res = admin.post(
        url,
        {
            "receivable": receivable["id"],
            "amount": "500.00",
            "paid_on": "2026-06-14",
            "method": "TRANSFER",
            "reference": "SPEI-001",
        },
    )
    assert res.status_code == 201, res.data
    row = admin.get(f"{API}receivables/{receivable['id']}/").data
    assert (row["status"], row["paid_amount"], row["outstanding_amount"]) == (
        "PARTIAL",
        "500.00",
        "700.00",
    )
    res = admin.post(
        url,
        {
            "receivable": receivable["id"],
            "amount": "800.00",
            "paid_on": "2026-06-14",
            "method": "TRANSFER",
        },
    )
    assert res.data["code"] == "overpayment"
    admin.post(
        url,
        {
            "receivable": receivable["id"],
            "amount": "700.00",
            "paid_on": "2026-06-15",
            "method": "CASH",
        },
    )
    row = admin.get(f"{API}receivables/{receivable['id']}/").data
    assert row["status"] == "PAID"
    summary = admin.get(f"{API}summary/").data
    assert summary["collected"] == "1200.00"


def test_future_payment_date_is_rejected(admin, app, acme):
    _, receivable = _active_receivable(admin, app, acme)
    res = admin.post(
        f"{API}payments/",
        {
            "receivable": receivable["id"],
            "amount": "1.00",
            "paid_on": "2026-06-16",
            "method": "CASH",
        },
    )
    assert res.data["code"] == "invalid_date"


def test_overdue_receivables(admin, app, acme):
    _, receivable = _active_receivable(admin, app, acme, start_date="2026-05-01")
    assert receivable["due_date"] == "2026-05-01"
    assert receivable["status"] == "PENDING"
    assert receivable["effective_status"] == "OVERDUE"
    listed = admin.get(f"{API}receivables/", {"status": "OVERDUE"}).data
    assert [r["id"] for r in listed["results"]] == [receivable["id"]]
    assert admin.get(f"{API}receivables/", {"status": "PENDING"}).data["count"] == 0
    summary = admin.get(f"{API}summary/", {"date_from": "2026-01-01"}).data
    assert summary["overdue_count"] == 1
    assert summary["overdue_amount"] == "1200.00"
    assert summary["collected"] == "0.00"  # a pending amount is never income
    upcoming = admin.get(f"{API}upcoming/").data
    assert [r["id"] for r in upcoming["overdue"]] == [receivable["id"]]


def test_duplicate_payment_reference_is_rejected(admin, app, acme, make_org):
    _, first = _active_receivable(admin, app, acme)
    _, second = _active_receivable(admin, app, make_org("Beta"))
    body = {
        "amount": "100.00",
        "paid_on": "2026-06-10",
        "method": "TRANSFER",
        "reference": "SPEI-777",
    }
    assert admin.post(f"{API}payments/", {**body, "receivable": first["id"]}).status_code == 201
    res = admin.post(f"{API}payments/", {**body, "receivable": second["id"]})
    assert res.status_code == 400
    assert res.data["code"] == "duplicate_payment"
    assert Payment.objects.count() == 1


def test_billing_period_cannot_be_generated_twice(admin, app, acme, admin_user):
    contract, receivable = _active_receivable(admin, app, acme)
    nxt = admin.post(f"{API}contracts/{contract['id']}/generate-receivable/").data
    assert nxt["period_start"] == "2026-07-01"
    obj = Contract.objects.get(pk=contract["id"])
    obj.next_billing_date = date(2026, 6, 1)
    obj.save()
    res = admin.post(f"{API}contracts/{contract['id']}/generate-receivable/")
    assert res.status_code == 400
    assert res.data["code"] == "duplicate"


def test_payment_correction_keeps_traceability(admin, app, acme):
    _, receivable = _active_receivable(admin, app, acme)
    payment = admin.post(
        f"{API}payments/",
        {
            "receivable": receivable["id"],
            "amount": "1000.00",
            "paid_on": "2026-06-10",
            "method": "CASH",
        },
    ).data
    res = admin.post(
        f"{API}payments/{payment['id']}/correct/",
        {
            "reason": "Importe mal capturado",
            "amount": "1200.00",
            "paid_on": "2026-06-10",
            "method": "CASH",
        },
    )
    assert res.status_code == 201, res.data
    assert str(res.data["corrects"]) == str(payment["id"])
    original = Payment.objects.get(pk=payment["id"])
    assert original.is_reversed and original.reversal_reason == "Importe mal capturado"
    assert admin.get(f"{API}summary/").data["collected"] == "1200.00"
    assert admin.get(f"{API}payments/").data["count"] == 1
    assert admin.get(f"{API}payments/", {"include_reversed": "true"}).data["count"] == 2
    assert admin.delete(f"{API}payments/{payment['id']}/").status_code == 405
    assert AuditLog.objects.filter(action=AuditAction.PAYMENT_CORRECTED).exists()


def test_sale_installments_cannot_exceed_the_sale(admin, app, acme):
    contract = create(admin, app, acme, kind="SALE", billing_period="", amount="10000.00").data
    url = f"{API}receivables/"
    body = {
        "contract": contract["id"],
        "concept": "Anticipo",
        "due_date": "2026-06-01",
        "expected_amount": "6000.00",
    }
    assert admin.post(url, body).data["code"] == "not_billable"  # draft
    activate(admin, contract["id"])
    assert admin.post(url, body).status_code == 201
    res = admin.post(url, {**body, "concept": "Finiquito", "expected_amount": "5000.00"})
    assert res.data["code"] == "exceeds_contract"
    assert (
        admin.post(url, {**body, "concept": "Finiquito", "expected_amount": "4000.00"}).status_code
        == 201
    )


def test_receivable_with_payments_cannot_be_cancelled(admin, app, acme):
    _, receivable = _active_receivable(admin, app, acme)
    admin.post(
        f"{API}payments/",
        {
            "receivable": receivable["id"],
            "amount": "10.00",
            "paid_on": "2026-06-10",
            "method": "CASH",
        },
    )
    res = admin.post(f"{API}receivables/{receivable['id']}/cancel/", {"reason": "x"})
    assert res.data["code"] == "has_payments"


# --- B.15 15: integridad al modificar contratos --------------------------------------------


def test_active_contract_amount_is_changed_only_by_price_history(admin, app, acme):
    contract = create(admin, app, acme).data
    assert (
        admin.patch(f"{API}contracts/{contract['id']}/", {"amount": "1300.00"}).status_code == 200
    )
    activate(admin, contract["id"])
    res = admin.patch(f"{API}contracts/{contract['id']}/", {"amount": "1500.00"})
    assert res.status_code == 400
    assert res.data["code"] == "not_editable"
    res = admin.post(
        f"{API}contracts/{contract['id']}/change-price/",
        {"amount": "1500.00", "effective_from": "2026-05-01"},
    )
    assert res.data["code"] == "retroactive_change"
    res = admin.post(
        f"{API}contracts/{contract['id']}/change-price/",
        {"amount": "1500.00", "effective_from": "2026-07-01", "reason": "Ajuste anual"},
    )
    assert res.status_code == 200
    assert [(p["amount"], p["effective_from"]) for p in res.data["prices"]] == [
        ("1300.00", "2026-06-01"),
        ("1500.00", "2026-07-01"),
    ]
    assert res.data["amount"] == "1300.00"  # still the price valid today
    assert (
        admin.patch(f"{API}contracts/{contract['id']}/", {"terms": "Soporte 8x5"}).status_code
        == 200
    )


def test_receivables_use_the_price_of_their_period(admin, app, acme):
    contract = create(admin, app, acme).data
    activate(admin, contract["id"])
    admin.post(
        f"{API}contracts/{contract['id']}/change-price/",
        {"amount": "1500.00", "effective_from": "2026-07-01"},
    )
    june = admin.post(f"{API}contracts/{contract['id']}/generate-receivable/").data
    july = admin.post(f"{API}contracts/{contract['id']}/generate-receivable/").data
    assert (june["expected_amount"], july["expected_amount"]) == ("1200.00", "1500.00")


def test_backdated_status_change_cannot_rewrite_history(admin, app, acme):
    contract = create(admin, app, acme).data
    activate(admin, contract["id"], "2026-06-10")
    res = admin.post(
        f"{API}contracts/{contract['id']}/transition/",
        {"to_status": "SUSPENDED", "effective_date": "2026-06-05"},
    )
    assert res.data["code"] == "invalid_date"
    res = admin.post(
        f"{API}contracts/{contract['id']}/transition/",
        {"to_status": "SUSPENDED", "effective_date": "2026-06-20"},
    )
    assert res.data["code"] == "invalid_date"  # future


def test_closing_a_contract_cancels_future_unpaid_receivables(admin, app, acme):
    contract = create(admin, app, acme, start_date="2026-06-15").data
    activate(admin, contract["id"], "2026-06-15")
    admin.post(f"{API}contracts/{contract['id']}/generate-receivable/")  # due today
    admin.post(f"{API}contracts/{contract['id']}/generate-receivable/")  # due 2026-07-15
    admin.post(
        f"{API}contracts/{contract['id']}/transition/", {"to_status": "CANCELLED", "reason": "Baja"}
    )
    states = sorted(
        (r["due_date"], r["status"])
        for r in admin.get(f"{API}receivables/", {"contract": contract["id"]}).data["results"]
    )
    assert states == [("2026-06-15", "PENDING"), ("2026-07-15", "CANCELLED")]


# --- gastos ---------------------------------------------------------------------------------


def test_expense_lifecycle_and_allocations(admin, app, make_project):
    other = make_project("Otro")
    general = admin.post(
        f"{API}expenses/",
        {
            "concept": "Electricidad Home Lab",
            "category": "ELECTRICITY",
            "amount": "900.00",
            "incurred_on": "2026-06-01",
            "kind": "RECURRING",
            "recurrence": "MONTHLY",
        },
    )
    assert general.status_code == 201, general.data
    eid = general.data["id"]
    res = admin.put(
        f"{API}expenses/{eid}/allocations/",
        {
            "allocations": [
                {"project": str(app.pk), "percentage": "60"},
                {"project": str(other.pk), "percentage": "50"},
            ]
        },
        format="json",
    )
    assert res.data["code"] == "over_allocated"
    res = admin.put(
        f"{API}expenses/{eid}/allocations/",
        {
            "allocations": [
                {"project": str(app.pk), "percentage": "60"},
                {"project": str(other.pk), "percentage": "40"},
            ]
        },
        format="json",
    )
    assert res.status_code == 200
    assert {a["project_name"]: a["amount"] for a in res.data["allocations"]} == {
        "Inventarios": "540.00",
        "Otro": "360.00",
    }
    assert admin.patch(f"{API}expenses/{eid}/", {"amount": "1000.00"}).status_code == 200
    assert admin.delete(f"{API}expenses/{eid}/").status_code == 405
    res = admin.post(f"{API}expenses/{eid}/void/", {"reason": "Factura duplicada"})
    assert res.data["is_voided"] is True
    assert admin.get(f"{API}expenses/").data["count"] == 0
    assert admin.patch(f"{API}expenses/{eid}/", {"amount": "1.00"}).data["code"] == "voided"
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {
        AuditAction.EXPENSE_CREATED,
        AuditAction.EXPENSE_UPDATED,
        AuditAction.EXPENSE_VOIDED,
        AuditAction.EXPENSE_ALLOCATED,
    } <= actions


def test_recurring_expense_requires_period(admin):
    res = admin.post(
        f"{API}expenses/",
        {
            "concept": "Hosting",
            "category": "HOSTING",
            "amount": "10.00",
            "incurred_on": "2026-06-01",
            "kind": "RECURRING",
        },
    )
    assert res.data["code"] == "required"


def test_money_is_never_a_float(admin, app, acme):
    contract = create(admin, app, acme).data
    assert isinstance(contract["amount"], str)
    summary = admin.get(f"{API}summary/").data
    assert isinstance(summary["collected"], str)
    res = create(admin, app, acme, kind="SALE", billing_period="", amount="10.005")
    assert res.status_code == 400  # more than 2 decimals


# --- portal access policy (B.10) -----------------------------------------------------------


def test_draft_contract_does_not_grant_portal_access(admin, app, acme):
    create(admin, app, acme)
    assert not ProjectAccess.objects.filter(project=app, organization=acme).exists()


def test_activation_grants_and_cancellation_revokes_portal_access(admin, app, acme, client_user):
    contract = create(admin, app, acme, end_date="2027-05-31").data
    activate(admin, contract["id"])
    grant = ProjectAccess.objects.current().get(project=app, organization=acme)
    assert grant.expires_at is not None
    assert admin.get(f"{API}contracts/{contract['id']}/").data["has_portal_access"] is True
    portal = APIClient()
    portal.post("/api/v1/auth/client/login/", {"email": client_user.email, "password": PASSWORD})
    assert portal.get(f"/api/v1/portal/projects/{app.pk}/").status_code == 200
    admin.post(
        f"{API}contracts/{contract['id']}/transition/",
        {"to_status": "CANCELLED", "reason": "Fin de relación"},
    )
    assert not ProjectAccess.objects.current().filter(project=app, organization=acme).exists()
    assert portal.get(f"/api/v1/portal/projects/{app.pk}/").status_code == 404
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {AuditAction.COMMERCIAL_ACCESS_GRANTED, AuditAction.COMMERCIAL_ACCESS_REVOKED} <= actions


def test_manual_access_is_never_revoked_by_a_contract(admin, app, acme, admin_user):
    from apps.projects import services as project_services

    manual = project_services.grant_access(project=app, organization=acme, actor=admin_user)
    contract = create(admin, app, acme).data
    activate(admin, contract["id"])
    admin.post(
        f"{API}contracts/{contract['id']}/transition/", {"to_status": "CANCELLED", "reason": "Baja"}
    )
    manual.refresh_from_db()
    assert manual.revoked_at is None


def test_suspension_does_not_revoke_access(admin, app, acme):
    contract = create(admin, app, acme).data
    activate(admin, contract["id"])
    admin.post(f"{API}contracts/{contract['id']}/transition/", {"to_status": "SUSPENDED"})
    assert ProjectAccess.objects.current().filter(project=app, organization=acme).exists()


# --- B.15 13–14 / B.7.7 16: aislamiento y permisos -----------------------------------------

FINANCE_GETS = [
    "summary/",
    "recurring/",
    "upcoming/",
    "applications/",
    "contracts/",
    "receivables/",
    "payments/",
    "expenses/",
]


@pytest.mark.parametrize("path", FINANCE_GETS)
@pytest.mark.parametrize("role", [Role.DEVELOPER, Role.CLIENT, Role.VISITOR])
def test_finance_is_closed_without_explicit_permission(as_user, make_user, role, path):
    assert as_user(make_user(role)).get(f"{API}{path}").status_code == 403


@pytest.mark.parametrize("path", FINANCE_GETS)
def test_anonymous_cannot_read_finance(api_client, path):
    assert api_client.get(f"{API}{path}").status_code == 403


def test_developer_with_view_permission_reads_but_cannot_write(
    as_user, developer, admin_user, app, acme
):
    user_services.update_user(developer, data={"finance_access": "VIEW"}, actor=admin_user)
    client = as_user(developer)
    assert client.get(f"{API}summary/").status_code == 200
    assert client.get(f"{API}applications/{app.pk}/profitability/").status_code == 200
    assert create(client, app, acme).status_code == 403
    assert (
        client.patch(f"{API}applications/{app.pk}/profile/", {"status": "SUSPENDED"}).status_code
        == 403
    )


def test_developer_with_manage_permission_can_write(as_user, developer, admin_user, app, acme):
    user_services.update_user(developer, data={"finance_access": "MANAGE"}, actor=admin_user)
    assert create(as_user(developer), app, acme).status_code == 201


def test_finance_permission_is_removed_when_role_changes(developer, admin_user):
    user_services.update_user(developer, data={"finance_access": "MANAGE"}, actor=admin_user)
    user_services.update_user(developer, data={"role": Role.CLIENT}, actor=admin_user)
    developer.refresh_from_db()
    assert not developer.user_permissions.exists()


def test_finance_access_cannot_be_given_to_clients(as_user, admin_user, client_user):
    res = as_user(admin_user).patch(f"/api/v1/users/{client_user.pk}/", {"finance_access": "VIEW"})
    assert res.data["code"] == "invalid_finance_access"


def test_dual_user_client_session_has_no_finance_access(make_user, make_org, app):
    user = make_user(Role.ADMIN, email="dual@example.com")
    user_services._apply_client_access(user, True)
    make_org("Dual Org", members=(user,))
    client = APIClient()
    client.post("/api/v1/auth/client/login/", {"email": user.email, "password": PASSWORD})
    assert client.get(f"{API}summary/").status_code == 403
    admin = APIClient()
    admin.post("/api/v1/auth/admin/login/", {"email": user.email, "password": PASSWORD})
    assert admin.get(f"{API}summary/").status_code == 200


def test_portal_shows_only_own_visible_contracts_without_amounts(
    admin, app, acme, client_user, make_org
):
    visible = create(admin, app, acme, portal_visible=True).data
    activate(admin, visible["id"])
    create(admin, app, acme, kind="SALE", billing_period="", portal_visible=False)
    foreign = create(admin, app, make_org("Ajena"), portal_visible=True).data
    activate(admin, foreign["id"])
    admin.post(f"{API}contracts/{visible['id']}/generate-receivable/")

    portal = APIClient()
    portal.post("/api/v1/auth/client/login/", {"email": client_user.email, "password": PASSWORD})
    res = portal.get("/api/v1/portal/contracts/")
    assert res.status_code == 200
    assert [c["id"] for c in res.data] == [visible["id"]]
    row = res.data[0]
    assert row["next_due_date"] == "2026-06-01"
    forbidden = {
        "amount",
        "monthly_value",
        "terms",
        "margin_pct",
        "profit",
        "expected_amount",
        "currency",
        "grants_access",
        "cancellation_reason",
    }
    assert not forbidden & set(row)
    # The rest of the portal never carries financial data either.
    detail = portal.get(f"/api/v1/portal/projects/{app.pk}/").data
    assert not {"mrr", "contracts", "profit", "expenses"} & set(detail)
    assert portal.get(f"{API}contracts/").status_code == 403


def test_portal_hides_draft_contracts(admin, app, acme, client_user):
    create(admin, app, acme, portal_visible=True)
    portal = APIClient()
    portal.post("/api/v1/auth/client/login/", {"email": client_user.email, "password": PASSWORD})
    assert portal.get("/api/v1/portal/contracts/").data == []


def test_filters_validate_input(admin):
    assert (
        admin.get(
            f"{API}summary/", {"date_from": "2026-07-01", "date_to": "2026-06-01"}
        ).status_code
        == 400
    )
    assert admin.get(f"{API}summary/", {"currency": "EUR"}).status_code == 400
    assert admin.get(f"{API}summary/", {"project": "no-es-uuid"}).status_code == 400
    assert admin.get(f"{API}summary/", {"date_from": "2020-01-01"}).status_code == 400  # > 5 years
    assert admin.get(f"{API}summary/", {"kind": "OTRO"}).status_code == 400


def test_receivable_status_is_never_stored_as_overdue():
    stored = [value for value, _ in Receivable._meta.get_field("status").choices]
    assert ReceivableStatus.OVERDUE not in stored
