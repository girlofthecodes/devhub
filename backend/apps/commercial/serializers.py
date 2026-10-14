"""Representations of commercial data. Amounts are strings with 2 decimals (never floats).

These serializers only shape data; every amount they show comes from the models or from
`metrics` (no financial logic here).
"""

from decimal import Decimal

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.organizations.models import Organization
from apps.projects.models import Project

from . import metrics
from .models import (
    BillingPeriod,
    CommercialStatus,
    Contract,
    ContractKind,
    ContractPrice,
    ContractStatus,
    ContractStatusChange,
    Currency,
    Expense,
    ExpenseCategory,
    ExpenseKind,
    Payment,
    PaymentMethod,
    Receivable,
    ReceivableStatus,
)

MONEY = {"max_digits": 14, "decimal_places": 2, "min_value": Decimal("0.01")}


class MoneyField(serializers.DecimalField):
    def __init__(self, **kwargs):
        super().__init__(max_digits=14, decimal_places=2, **kwargs)


# --- applications / profile ----------------------------------------------------------------


class CommercialApplicationSerializer(serializers.ModelSerializer):
    """A project of the existing catalog seen from the commercial side."""

    project_status = serializers.CharField(source="status", read_only=True)
    project_status_label = serializers.CharField(source="get_status_display", read_only=True)
    commercial_status = serializers.SerializerMethodField()
    commercial_status_label = serializers.SerializerMethodField()
    modalities = serializers.SerializerMethodField()
    notes = serializers.SerializerMethodField()
    end_users_count = serializers.SerializerMethodField()
    active_contracts = serializers.IntegerField(read_only=True)
    active_sales = serializers.IntegerField(read_only=True)
    active_subscriptions = serializers.IntegerField(read_only=True)
    organizations = serializers.IntegerField(read_only=True)
    mrr = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "slug",
            "project_status",
            "project_status_label",
            "commercial_status",
            "commercial_status_label",
            "modalities",
            "notes",
            "end_users_count",
            "active_contracts",
            "active_sales",
            "active_subscriptions",
            "organizations",
            "mrr",
        ]
        read_only_fields = fields

    def _profile(self, obj):
        return getattr(obj, "commercial_profile", None)

    def get_commercial_status(self, obj) -> str:
        profile = self._profile(obj)
        return profile.status if profile else CommercialStatus.NOT_COMMERCIAL

    def get_commercial_status_label(self, obj) -> str:
        return CommercialStatus(self.get_commercial_status(obj)).label

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_modalities(self, obj) -> list[str]:
        return metrics.modalities(self.get_commercial_status(obj))

    def get_notes(self, obj) -> str:
        profile = self._profile(obj)
        return profile.notes if profile else ""

    @extend_schema_field(serializers.IntegerField(allow_null=True))
    def get_end_users_count(self, obj):
        profile = self._profile(obj)
        return profile.end_users_count if profile else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_mrr(self, obj) -> str | None:
        value = self.context.get("mrr_by_project", {}).get(obj.pk)
        return str(value) if value is not None else "0.00"


class CommercialProfileWriteSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=CommercialStatus.choices, required=False)
    notes = serializers.CharField(allow_blank=True, required=False, max_length=4000)
    end_users_count = serializers.IntegerField(min_value=0, allow_null=True, required=False)


# --- contracts -----------------------------------------------------------------------------


class ContractPriceSerializer(serializers.ModelSerializer):
    created_by_email = serializers.EmailField(source="created_by.email", default=None)

    class Meta:
        model = ContractPrice
        fields = ["id", "amount", "effective_from", "reason", "created_at", "created_by_email"]
        read_only_fields = fields


class ContractStatusChangeSerializer(serializers.ModelSerializer):
    from_status_label = serializers.SerializerMethodField()
    to_status_label = serializers.CharField(source="get_to_status_display")
    actor_email = serializers.EmailField(source="actor.email", default=None)

    class Meta:
        model = ContractStatusChange
        fields = [
            "id",
            "from_status",
            "from_status_label",
            "to_status",
            "to_status_label",
            "effective_date",
            "reason",
            "created_at",
            "actor_email",
        ]
        read_only_fields = fields

    def get_from_status_label(self, obj) -> str:
        return obj.get_from_status_display() if obj.from_status else ""


class ContractSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    billing_period_label = serializers.CharField(
        source="get_billing_period_display", read_only=True
    )
    amount = serializers.SerializerMethodField()
    monthly_value = serializers.SerializerMethodField()
    has_portal_access = serializers.SerializerMethodField()

    class Meta:
        model = Contract
        fields = [
            "id",
            "project",
            "project_name",
            "organization",
            "organization_name",
            "kind",
            "kind_label",
            "status",
            "status_label",
            "currency",
            "amount",
            "monthly_value",
            "start_date",
            "end_date",
            "billing_period",
            "billing_period_label",
            "next_billing_date",
            "terms",
            "portal_visible",
            "grants_access",
            "has_portal_access",
            "cancellation_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def _latest_price(self, obj):
        prices = list(obj.prices.all())
        return max(prices, key=lambda p: p.effective_from) if prices else None

    @extend_schema_field(serializers.CharField())
    def get_amount(self, obj) -> str | None:
        """Current price (per period for subscriptions, total for sales)."""
        today = metrics.business_today()
        price = metrics.price_at(obj, today) or (
            self._latest_price(obj).amount if self._latest_price(obj) else None
        )
        return str(price) if price is not None else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_monthly_value(self, obj) -> str | None:
        """Normalized monthly value at today (the contract's MRR contribution)."""
        if obj.kind != ContractKind.SUBSCRIPTION:
            return None
        return str(metrics.q(metrics.contract_mrr_at(obj, metrics.business_today())))

    def get_has_portal_access(self, obj) -> bool:
        grant = obj.access_grant
        return bool(grant and grant.state == "ACTIVE")


class ContractDetailSerializer(ContractSerializer):
    prices = ContractPriceSerializer(many=True, read_only=True)
    status_changes = ContractStatusChangeSerializer(many=True, read_only=True)
    totals = serializers.SerializerMethodField()

    class Meta(ContractSerializer.Meta):
        fields = [*ContractSerializer.Meta.fields, "prices", "status_changes", "totals"]
        read_only_fields = fields

    @extend_schema_field(serializers.DictField(child=serializers.CharField()))
    def get_totals(self, obj) -> dict:
        receivables = metrics.with_paid(obj.receivables.exclude(status=ReceivableStatus.CANCELLED))
        expected = sum((r.expected_amount for r in receivables), Decimal(0))
        paid = sum((r.paid_amount for r in receivables), Decimal(0))
        return {
            "expected": str(metrics.q(expected)),
            "collected": str(metrics.q(paid)),
            "outstanding": str(metrics.q(expected - paid)),
        }


class ContractCreateSerializer(serializers.Serializer):
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all())
    organization = serializers.PrimaryKeyRelatedField(queryset=Organization.objects.all())
    kind = serializers.ChoiceField(choices=ContractKind.choices)
    amount = serializers.DecimalField(**MONEY)
    currency = serializers.ChoiceField(choices=Currency.choices, default=Currency.MXN)
    start_date = serializers.DateField()
    end_date = serializers.DateField(required=False, allow_null=True)
    billing_period = serializers.ChoiceField(
        choices=BillingPeriod.choices, required=False, allow_blank=True, default=""
    )
    terms = serializers.CharField(required=False, allow_blank=True, default="", max_length=8000)
    portal_visible = serializers.BooleanField(required=False, default=False)
    grants_access = serializers.BooleanField(required=False, default=True)


class ContractUpdateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(**MONEY, required=False)
    currency = serializers.ChoiceField(choices=Currency.choices, required=False)
    start_date = serializers.DateField(required=False)
    end_date = serializers.DateField(required=False, allow_null=True)
    billing_period = serializers.ChoiceField(choices=BillingPeriod.choices, required=False)
    next_billing_date = serializers.DateField(required=False, allow_null=True)
    terms = serializers.CharField(required=False, allow_blank=True, max_length=8000)
    portal_visible = serializers.BooleanField(required=False)
    grants_access = serializers.BooleanField(required=False)


class ContractTransitionSerializer(serializers.Serializer):
    to_status = serializers.ChoiceField(choices=ContractStatus.choices)
    effective_date = serializers.DateField(required=False, allow_null=True)
    reason = serializers.CharField(required=False, allow_blank=True, default="", max_length=255)


class PriceChangeSerializer(serializers.Serializer):
    amount = serializers.DecimalField(**MONEY)
    effective_from = serializers.DateField()
    reason = serializers.CharField(required=False, allow_blank=True, default="", max_length=255)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


# --- receivables & payments ----------------------------------------------------------------


class ReceivableSerializer(serializers.ModelSerializer):
    project = serializers.UUIDField(source="contract.project_id", read_only=True)
    project_name = serializers.CharField(source="contract.project.name", read_only=True)
    organization_name = serializers.CharField(source="contract.organization.name", read_only=True)
    contract_kind = serializers.CharField(source="contract.kind", read_only=True)
    paid_amount = MoneyField(read_only=True)
    outstanding_amount = MoneyField(read_only=True)
    effective_status = serializers.SerializerMethodField()
    effective_status_label = serializers.SerializerMethodField()

    class Meta:
        model = Receivable
        fields = [
            "id",
            "contract",
            "project",
            "project_name",
            "organization_name",
            "contract_kind",
            "concept",
            "period_start",
            "period_end",
            "due_date",
            "expected_amount",
            "paid_amount",
            "outstanding_amount",
            "currency",
            "status",
            "effective_status",
            "effective_status_label",
            "notes",
            "cancellation_reason",
            "created_at",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.ChoiceField(choices=ReceivableStatus.choices))
    def get_effective_status(self, obj) -> str:
        return metrics.receivable_effective_status(obj)

    def get_effective_status_label(self, obj) -> str:
        return ReceivableStatus(self.get_effective_status(obj)).label


class ReceivableCreateSerializer(serializers.Serializer):
    contract = serializers.PrimaryKeyRelatedField(queryset=Contract.objects.all())
    concept = serializers.CharField(max_length=120)
    due_date = serializers.DateField()
    expected_amount = serializers.DecimalField(**MONEY)
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=4000)


class ReceivableUpdateSerializer(serializers.Serializer):
    concept = serializers.CharField(max_length=120, required=False)
    due_date = serializers.DateField(required=False)
    expected_amount = serializers.DecimalField(**MONEY, required=False)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=4000)


class PaymentSerializer(serializers.ModelSerializer):
    contract = serializers.UUIDField(source="receivable.contract_id", read_only=True)
    project_name = serializers.CharField(source="receivable.contract.project.name", read_only=True)
    organization_name = serializers.CharField(
        source="receivable.contract.organization.name", read_only=True
    )
    receivable_concept = serializers.CharField(source="receivable.concept", read_only=True)
    currency = serializers.CharField(source="receivable.currency", read_only=True)
    method_label = serializers.CharField(source="get_method_display", read_only=True)
    created_by_email = serializers.EmailField(source="created_by.email", default=None)
    is_reversed = serializers.BooleanField(read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "receivable",
            "receivable_concept",
            "contract",
            "project_name",
            "organization_name",
            "amount",
            "currency",
            "paid_on",
            "method",
            "method_label",
            "reference",
            "notes",
            "created_at",
            "created_by_email",
            "is_reversed",
            "reversed_at",
            "reversal_reason",
            "corrects",
        ]
        read_only_fields = fields


class PaymentCreateSerializer(serializers.Serializer):
    receivable = serializers.PrimaryKeyRelatedField(queryset=Receivable.objects.all())
    amount = serializers.DecimalField(**MONEY)
    paid_on = serializers.DateField()
    method = serializers.ChoiceField(choices=PaymentMethod.choices)
    reference = serializers.CharField(required=False, allow_blank=True, default="", max_length=80)
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=4000)


class PaymentCorrectSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)
    amount = serializers.DecimalField(**MONEY)
    paid_on = serializers.DateField()
    method = serializers.ChoiceField(choices=PaymentMethod.choices)
    reference = serializers.CharField(required=False, allow_blank=True, default="", max_length=80)
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=4000)


# --- expenses ------------------------------------------------------------------------------


class ExpenseAllocationSerializer(serializers.Serializer):
    project = serializers.UUIDField(source="project_id")
    project_name = serializers.CharField(source="project.name")
    percentage = serializers.DecimalField(max_digits=5, decimal_places=2)
    amount = serializers.SerializerMethodField()

    def get_amount(self, obj) -> str:
        return str(metrics.q(obj.expense.amount * obj.percentage / 100))


class ExpenseSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source="get_category_display", read_only=True)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    recurrence_label = serializers.CharField(source="get_recurrence_display", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    allocations = ExpenseAllocationSerializer(many=True, read_only=True)
    allocated_pct = serializers.SerializerMethodField()
    is_voided = serializers.BooleanField(read_only=True)

    class Meta:
        model = Expense
        fields = [
            "id",
            "concept",
            "category",
            "category_label",
            "amount",
            "currency",
            "incurred_on",
            "project",
            "project_name",
            "kind",
            "kind_label",
            "recurrence",
            "recurrence_label",
            "notes",
            "allocations",
            "allocated_pct",
            "is_voided",
            "voided_at",
            "void_reason",
            "created_at",
        ]
        read_only_fields = fields

    def get_allocated_pct(self, obj) -> str:
        return str(sum((a.percentage for a in obj.allocations.all()), Decimal("0.00")))


class ExpenseWriteSerializer(serializers.Serializer):
    concept = serializers.CharField(max_length=150)
    category = serializers.ChoiceField(choices=ExpenseCategory.choices)
    amount = serializers.DecimalField(**MONEY)
    currency = serializers.ChoiceField(choices=Currency.choices, default=Currency.MXN)
    incurred_on = serializers.DateField()
    project = serializers.PrimaryKeyRelatedField(
        queryset=Project.objects.all(), required=False, allow_null=True, default=None
    )
    kind = serializers.ChoiceField(choices=ExpenseKind.choices, default=ExpenseKind.ONE_TIME)
    recurrence = serializers.ChoiceField(
        choices=BillingPeriod.choices, required=False, allow_blank=True, default=""
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=4000)


class AllocationItemSerializer(serializers.Serializer):
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all())
    percentage = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=Decimal("0.01"), max_value=Decimal("100")
    )


class AllocationsSerializer(serializers.Serializer):
    allocations = AllocationItemSerializer(many=True)


# --- client portal -------------------------------------------------------------------------


class PortalContractSerializer(serializers.ModelSerializer):
    """What a client may see of its own contracts: no amounts, costs or margins."""

    project_name = serializers.CharField(source="project.name", read_only=True)
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    billing_period_label = serializers.CharField(
        source="get_billing_period_display", read_only=True
    )
    next_due_date = serializers.DateField(read_only=True, allow_null=True)

    class Meta:
        model = Contract
        fields = [
            "id",
            "project",
            "project_name",
            "organization_name",
            "kind",
            "kind_label",
            "status",
            "status_label",
            "start_date",
            "end_date",
            "billing_period",
            "billing_period_label",
            "next_due_date",
        ]
        read_only_fields = fields
