"""Commercial layer of the project catalog: contracts, receivables, payments and expenses.

Money is always Decimal (never float) and always carries an explicit currency. Amounts of
different currencies are never added together: every metric is computed per currency.
Financial movements are never physically deleted: receivables are cancelled, payments are
reversed and expenses are voided, keeping the full history.
"""

from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from common.models import TimeStampedModel, UUIDModel

MONEY = {"max_digits": 14, "decimal_places": 2}
POSITIVE = [MinValueValidator(Decimal("0.01"))]


class Currency(models.TextChoices):
    MXN = "MXN", "Peso mexicano (MXN)"
    USD = "USD", "Dólar estadounidense (USD)"


DEFAULT_CURRENCY = Currency.MXN


class CommercialStatus(models.TextChoices):
    NOT_COMMERCIAL = "NOT_COMMERCIAL", "No comercializable"
    PREPARING = "PREPARING", "En preparación comercial"
    FOR_SALE = "FOR_SALE", "Disponible para venta"
    FOR_RENT = "FOR_RENT", "Disponible para renta"
    FOR_SALE_AND_RENT = "FOR_SALE_AND_RENT", "Disponible para venta y renta"
    SUSPENDED = "SUSPENDED", "Comercialización suspendida"


class ContractKind(models.TextChoices):
    SALE = "SALE", "Venta única"
    SUBSCRIPTION = "SUBSCRIPTION", "Renta / suscripción"


# Which contract kinds a commercial status allows to create.
ALLOWED_KINDS = {
    CommercialStatus.FOR_SALE: {ContractKind.SALE},
    CommercialStatus.FOR_RENT: {ContractKind.SUBSCRIPTION},
    CommercialStatus.FOR_SALE_AND_RENT: {ContractKind.SALE, ContractKind.SUBSCRIPTION},
}


class CommercialProfile(TimeStampedModel):
    """Commercial state of a project, independent from its technical status."""

    project = models.OneToOneField(
        "projects.Project", on_delete=models.CASCADE, related_name="commercial_profile"
    )
    status = models.CharField(
        "estado comercial",
        max_length=24,
        choices=CommercialStatus.choices,
        default=CommercialStatus.NOT_COMMERCIAL,
        db_index=True,
    )
    notes = models.TextField("notas comerciales", blank=True)
    end_users_count = models.PositiveIntegerField(
        "usuarios finales (informativo)",
        null=True,
        blank=True,
        help_text="Dato capturado manualmente; no se usa en ningún cálculo.",
    )
    end_users_updated_at = models.DateTimeField(null=True, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["project__name"]
        permissions = [
            ("view_finance", "Puede consultar el módulo financiero"),
            ("manage_finance", "Puede gestionar el módulo financiero"),
        ]

    def __str__(self) -> str:
        return f"{self.project} — {self.get_status_display()}"


class ContractStatus(models.TextChoices):
    DRAFT = "DRAFT", "Borrador"
    PENDING = "PENDING", "Pendiente"
    ACTIVE = "ACTIVE", "Activo"
    SUSPENDED = "SUSPENDED", "Suspendido"
    FINISHED = "FINISHED", "Finalizado"
    CANCELLED = "CANCELLED", "Cancelado"


OPEN_CONTRACT_STATUSES = (
    ContractStatus.DRAFT,
    ContractStatus.PENDING,
    ContractStatus.ACTIVE,
    ContractStatus.SUSPENDED,
)
CLOSED_CONTRACT_STATUSES = (ContractStatus.FINISHED, ContractStatus.CANCELLED)


class BillingPeriod(models.TextChoices):
    MONTHLY = "MONTHLY", "Mensual"
    QUARTERLY = "QUARTERLY", "Trimestral"
    SEMIANNUAL = "SEMIANNUAL", "Semestral"
    ANNUAL = "ANNUAL", "Anual"


PERIOD_MONTHS = {
    BillingPeriod.MONTHLY: 1,
    BillingPeriod.QUARTERLY: 3,
    BillingPeriod.SEMIANNUAL: 6,
    BillingPeriod.ANNUAL: 12,
}


class Contract(TimeStampedModel):
    """Agreement between DevHub and a client organization over one project."""

    project = models.ForeignKey(
        "projects.Project", on_delete=models.PROTECT, related_name="contracts"
    )
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.PROTECT, related_name="contracts"
    )
    kind = models.CharField("modelo comercial", max_length=16, choices=ContractKind.choices)
    status = models.CharField(
        max_length=16,
        choices=ContractStatus.choices,
        default=ContractStatus.DRAFT,
        db_index=True,
    )
    currency = models.CharField(max_length=3, choices=Currency.choices, default=DEFAULT_CURRENCY)
    start_date = models.DateField("fecha de inicio / venta")
    end_date = models.DateField("fecha de finalización", null=True, blank=True)
    billing_period = models.CharField(
        "periodicidad", max_length=16, choices=BillingPeriod.choices, blank=True
    )
    next_billing_date = models.DateField("próxima fecha de cobro", null=True, blank=True)
    terms = models.TextField("condiciones comerciales", blank=True)
    portal_visible = models.BooleanField(
        "visible en el portal",
        default=False,
        help_text="La organización puede consultar este contrato en su portal.",
    )
    grants_access = models.BooleanField(
        "habilita acceso",
        default=True,
        help_text="Al activarse, concede acceso al proyecto en el portal; se revoca al "
        "cancelarse o finalizar.",
    )
    access_grant = models.ForeignKey(
        "projects.ProjectAccess",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="Acceso al portal creado por este contrato (solo ese se revoca).",
    )
    cancellation_reason = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-start_date", "-created_at"]
        indexes = [models.Index(fields=["project", "status"]), models.Index(fields=["kind"])]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "organization", "kind"],
                condition=Q(status__in=OPEN_CONTRACT_STATUSES),
                name="contract_one_open_per_org_project_kind",
                violation_error_message=(
                    "Ya existe un contrato abierto equivalente para esta organización."
                ),
            ),
            models.CheckConstraint(
                condition=(Q(kind=ContractKind.SALE) & Q(billing_period=""))
                | (Q(kind=ContractKind.SUBSCRIPTION) & ~Q(billing_period="")),
                name="contract_period_matches_kind",
            ),
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(end_date__gte=models.F("start_date")),
                name="contract_end_after_start",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} · {self.project} · {self.organization}"

    @property
    def is_subscription(self) -> bool:
        return self.kind == ContractKind.SUBSCRIPTION

    @property
    def period_months(self) -> int | None:
        return PERIOD_MONTHS.get(self.billing_period)


class ContractPrice(UUIDModel):
    """Price history. Each row applies from `effective_from` until the next one.

    Rows are only appended (never edited) so past indicators never change retroactively.
    For subscriptions the amount is per billing period; for sales it is the total.
    """

    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name="prices")
    amount = models.DecimalField("importe", validators=POSITIVE, **MONEY)
    effective_from = models.DateField("vigente desde")
    reason = models.CharField("motivo", max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["effective_from"]
        constraints = [
            models.UniqueConstraint(
                fields=["contract", "effective_from"], name="contract_price_unique_date"
            ),
            models.CheckConstraint(condition=Q(amount__gt=0), name="contract_price_positive"),
        ]

    def __str__(self) -> str:
        return f"{self.amount} desde {self.effective_from}"


class ContractStatusChange(UUIDModel):
    """Status timeline of a contract; it drives historical MRR and the movement analysis."""

    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name="status_changes")
    from_status = models.CharField(max_length=16, choices=ContractStatus.choices, blank=True)
    to_status = models.CharField(max_length=16, choices=ContractStatus.choices)
    effective_date = models.DateField("fecha efectiva")
    reason = models.CharField("motivo", max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["effective_date", "created_at"]

    def __str__(self) -> str:
        return f"{self.from_status or '—'} → {self.to_status} ({self.effective_date})"


class ReceivableStatus(models.TextChoices):
    PENDING = "PENDING", "Pendiente"
    PARTIAL = "PARTIAL", "Parcial"
    PAID = "PAID", "Pagado"
    OVERDUE = "OVERDUE", "Vencido"
    CANCELLED = "CANCELLED", "Cancelado"


# OVERDUE is never stored: it is PENDING/PARTIAL past its due date (see effective status).
OUTSTANDING_STATUSES = (ReceivableStatus.PENDING, ReceivableStatus.PARTIAL)


class Receivable(TimeStampedModel):
    """An amount expected from a contract (a billing period or a sale installment)."""

    contract = models.ForeignKey(Contract, on_delete=models.PROTECT, related_name="receivables")
    concept = models.CharField("concepto", max_length=120)
    period_start = models.DateField("inicio del periodo", null=True, blank=True)
    period_end = models.DateField("fin del periodo", null=True, blank=True)
    due_date = models.DateField("vencimiento", db_index=True)
    expected_amount = models.DecimalField("importe esperado", validators=POSITIVE, **MONEY)
    currency = models.CharField(max_length=3, choices=Currency.choices)
    status = models.CharField(
        max_length=16,
        choices=[c for c in ReceivableStatus.choices if c[0] != ReceivableStatus.OVERDUE],
        default=ReceivableStatus.PENDING,
        db_index=True,
    )
    notes = models.TextField("observaciones", blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["due_date", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["contract", "period_start"],
                condition=Q(period_start__isnull=False) & ~Q(status="CANCELLED"),
                name="receivable_one_per_period",
                violation_error_message="Ese periodo ya tiene un cobro registrado.",
            ),
            models.CheckConstraint(
                condition=Q(expected_amount__gt=0), name="receivable_expected_positive"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.concept} · {self.contract}"


class PaymentMethod(models.TextChoices):
    TRANSFER = "TRANSFER", "Transferencia"
    DEPOSIT = "DEPOSIT", "Depósito"
    CARD = "CARD", "Tarjeta"
    CASH = "CASH", "Efectivo"
    OTHER = "OTHER", "Otro"


class Payment(UUIDModel):
    """Money actually received. Confirmed payments are never edited or deleted: a mistake
    is fixed by reversing the payment (and, optionally, recording the corrected one)."""

    receivable = models.ForeignKey(Receivable, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField("importe cobrado", validators=POSITIVE, **MONEY)
    paid_on = models.DateField("fecha de pago", db_index=True)
    method = models.CharField("método", max_length=16, choices=PaymentMethod.choices)
    reference = models.CharField("referencia", max_length=80, blank=True)
    notes = models.TextField("observaciones", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reversal_reason = models.CharField(max_length=255, blank=True)
    corrects = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="corrections",
        help_text="Pago revertido al que este registro corrige.",
    )

    class Meta:
        ordering = ["-paid_on", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["method", "reference"],
                condition=~Q(reference="") & Q(reversed_at__isnull=True),
                name="payment_unique_reference",
                violation_error_message="Ya existe un pago con esa referencia.",
            ),
            models.CheckConstraint(condition=Q(amount__gt=0), name="payment_amount_positive"),
        ]

    def __str__(self) -> str:
        return f"{self.amount} el {self.paid_on}"

    @property
    def is_reversed(self) -> bool:
        return self.reversed_at is not None


class ExpenseCategory(models.TextChoices):
    HOSTING = "HOSTING", "Hosting"
    ELECTRICITY = "ELECTRICITY", "Electricidad"
    INTERNET = "INTERNET", "Internet"
    DOMAINS = "DOMAINS", "Dominios"
    SERVERS = "SERVERS", "Servidores"
    MAINTENANCE = "MAINTENANCE", "Mantenimiento"
    EXTERNAL_SERVICES = "EXTERNAL_SERVICES", "Servicios externos"
    LICENSES = "LICENSES", "Licencias"
    OTHER = "OTHER", "Otros gastos"


class ExpenseKind(models.TextChoices):
    ONE_TIME = "ONE_TIME", "Único"
    RECURRING = "RECURRING", "Recurrente"


class Expense(TimeStampedModel):
    """A cost actually incurred on `incurred_on` (recognized in that period).

    Recurring expenses are registered once per occurrence; the system never projects them.
    `project` empty means a general (shared) expense, attributed to projects only through
    explicit allocations.
    """

    concept = models.CharField("concepto", max_length=150)
    category = models.CharField("categoría", max_length=24, choices=ExpenseCategory.choices)
    amount = models.DecimalField("importe", validators=POSITIVE, **MONEY)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=DEFAULT_CURRENCY)
    incurred_on = models.DateField("fecha", db_index=True)
    project = models.ForeignKey(
        "projects.Project",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="expenses",
    )
    kind = models.CharField(
        "tipo", max_length=16, choices=ExpenseKind.choices, default=ExpenseKind.ONE_TIME
    )
    recurrence = models.CharField(
        "periodicidad", max_length=16, choices=BillingPeriod.choices, blank=True
    )
    notes = models.TextField("observaciones", blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    void_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-incurred_on", "-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="expense_amount_positive"),
            models.CheckConstraint(
                condition=(Q(kind=ExpenseKind.ONE_TIME) & Q(recurrence=""))
                | (Q(kind=ExpenseKind.RECURRING) & ~Q(recurrence="")),
                name="expense_recurrence_matches_kind",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.concept} ({self.incurred_on})"

    @property
    def is_voided(self) -> bool:
        return self.voided_at is not None


class ExpenseAllocation(UUIDModel):
    """Share (%) of a general expense attributed to a project for its profitability.

    Allocations never add money: the portfolio total always uses the expense amount once.
    """

    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name="allocations")
    project = models.ForeignKey(
        "projects.Project", on_delete=models.PROTECT, related_name="expense_allocations"
    )
    percentage = models.DecimalField(
        "porcentaje",
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01")), MaxValueValidator(Decimal("100"))],
    )

    class Meta:
        ordering = ["project__name"]
        constraints = [
            models.UniqueConstraint(fields=["expense", "project"], name="allocation_unique"),
            models.CheckConstraint(
                condition=Q(percentage__gt=0) & Q(percentage__lte=100),
                name="allocation_percentage_range",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.percentage}% → {self.project}"
