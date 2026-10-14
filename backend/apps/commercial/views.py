"""Commercial API. Every endpoint requires explicit finance access (HasFinanceAccess) inside an
admin-panel session, except the client portal view, which only exposes the client's own
contracts that were explicitly made visible and never any amount."""

import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count, OuterRef, Prefetch, Q, Subquery
from django.utils.dateparse import parse_date
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.portal.views import IsClient
from apps.projects.models import Project, ProjectStatus
from common.permissions import HasFinanceAccess

from . import metrics, services
from .models import (
    ALLOWED_KINDS,
    CommercialStatus,
    Contract,
    ContractKind,
    ContractPrice,
    ContractStatus,
    ContractStatusChange,
    Currency,
    Expense,
    Payment,
    Receivable,
    ReceivableStatus,
)
from .serializers import (
    AllocationsSerializer,
    CommercialApplicationSerializer,
    CommercialProfileWriteSerializer,
    ContractCreateSerializer,
    ContractDetailSerializer,
    ContractSerializer,
    ContractTransitionSerializer,
    ContractUpdateSerializer,
    ExpenseSerializer,
    ExpenseWriteSerializer,
    PaymentCorrectSerializer,
    PaymentCreateSerializer,
    PaymentSerializer,
    PortalContractSerializer,
    PriceChangeSerializer,
    ReasonSerializer,
    ReceivableCreateSerializer,
    ReceivableSerializer,
    ReceivableUpdateSerializer,
)

MAX_RANGE_DAYS = 366 * 5
# Contracts a client may see (if made visible): never drafts, pending or cancelled ones.
PORTAL_VISIBLE_STATUSES = (ContractStatus.ACTIVE, ContractStatus.SUSPENDED, ContractStatus.FINISHED)

PERIOD_PARAMS = [
    OpenApiParameter(
        "date_from", OpenApiTypes.DATE, description="Inicio (por defecto: 1.º del mes)."
    ),
    OpenApiParameter("date_to", OpenApiTypes.DATE, description="Fin (por defecto: hoy)."),
    OpenApiParameter("currency", str, enum=Currency.values, description="Moneda (MXN)."),
    OpenApiParameter("project", OpenApiTypes.UUID),
    OpenApiParameter("kind", str, enum=ContractKind.values, description="Modelo comercial."),
]


def to_json(value):
    """Metrics → JSON: money as 2-decimal strings (never floats), dates as ISO strings."""
    if isinstance(value, dict):
        return {k: to_json(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [to_json(v) for v in value]
    if isinstance(value, Decimal):
        return str(metrics.q(value))
    if isinstance(value, date):
        return value.isoformat()
    if hasattr(value, "hex") and not isinstance(value, str | bytes | int):
        return str(value)  # UUID
    return value


def _date_param(params, name: str, default: date) -> date:
    raw = params.get(name)
    if not raw:
        return default
    parsed = parse_date(raw)
    if parsed is None:
        raise ValidationError({name: ["Fecha no válida (AAAA-MM-DD)."]})
    return parsed


def parse_filters(request, *, project: Project | None = None) -> metrics.Filters:
    params = request.query_params
    today = metrics.business_today()
    date_from = _date_param(params, "date_from", metrics.month_start(today))
    date_to = _date_param(params, "date_to", today)
    if date_from > date_to:
        raise ValidationError({"date_from": ["El inicio debe ser anterior al fin."]})
    if (date_to - date_from).days > MAX_RANGE_DAYS:
        raise ValidationError({"date_to": ["El rango máximo es de 5 años."]})
    currency = params.get("currency") or Currency.MXN
    if currency not in Currency.values:
        raise ValidationError({"currency": ["Moneda no válida."]})
    kind = params.get("kind") or None
    if kind and kind not in ContractKind.values:
        raise ValidationError({"kind": ["Modelo comercial no válido."]})
    if project is None and params.get("project"):
        try:
            project = Project.objects.filter(pk=uuid.UUID(params["project"])).first()
        except ValueError:
            project = None
        if project is None:
            raise ValidationError({"project": ["Proyecto no encontrado."]})
    return metrics.Filters(date_from, date_to, currency, project, kind)


class FinanceViewMixin:
    permission_classes = [HasFinanceAccess]


# --- applications ------------------------------------------------------------------------


class CommercialApplicationViewSet(
    FinanceViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """The existing project catalog with its commercial status (no second catalog)."""

    serializer_class = CommercialApplicationSerializer
    search_fields = ["name", "slug"]
    ordering_fields = ["name"]
    ordering = ["name"]
    filterset_fields: list[str] = []

    def get_queryset(self):
        active = Q(contracts__status=ContractStatus.ACTIVE)
        qs = Project.objects.select_related("commercial_profile").annotate(
            active_contracts=Count("contracts", filter=active, distinct=True),
            active_sales=Count(
                "contracts", filter=active & Q(contracts__kind=ContractKind.SALE), distinct=True
            ),
            active_subscriptions=Count(
                "contracts",
                filter=active & Q(contracts__kind=ContractKind.SUBSCRIPTION),
                distinct=True,
            ),
            organizations=Count("contracts__organization", filter=active, distinct=True),
        )
        params = getattr(self.request, "query_params", {})
        if params.get("include_archived") != "true":
            qs = qs.active()
        status_filter = params.get("commercial_status")
        if status_filter == CommercialStatus.NOT_COMMERCIAL:
            qs = qs.filter(
                Q(commercial_profile__isnull=True)
                | Q(commercial_profile__status=CommercialStatus.NOT_COMMERCIAL)
            )
        elif status_filter:
            qs = qs.filter(commercial_profile__status=status_filter)
        elif params.get("commercial") == "true":
            qs = qs.filter(commercial_profile__status__in=list(ALLOWED_KINDS))
        return qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if getattr(self, "swagger_fake_view", False):
            return context
        today = metrics.business_today()
        f = metrics.Filters(today, today, Currency.MXN)
        snap = metrics.snapshot(list(metrics.subscriptions_for(f)), today)
        context["mrr_by_project"] = {r["project"]: r["mrr"] for r in snap["by_project"]}
        return context

    @extend_schema(
        parameters=[
            OpenApiParameter("commercial_status", str, enum=CommercialStatus.values),
            OpenApiParameter("commercial", bool, description="Solo comercializables."),
            OpenApiParameter("include_archived", bool),
        ]
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(
        request=CommercialProfileWriteSerializer, responses=CommercialApplicationSerializer
    )
    @action(detail=True, methods=["patch"])
    def profile(self, request, pk=None):
        project = self.get_object()
        serializer = CommercialProfileWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_profile(
            project, actor=request.user, data=dict(serializer.validated_data), request=request
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=project.pk)).data)

    @extend_schema(parameters=PERIOD_PARAMS[:3] + PERIOD_PARAMS[4:], responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def profitability(self, request, pk=None):
        project = self.get_object()
        f = parse_filters(request, project=project)
        return Response(to_json(metrics.project_summary(project, f)))


# --- contracts -----------------------------------------------------------------------------


class ContractViewSet(
    FinanceViewMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Commercial contracts. Never deleted: they are cancelled or finished."""

    serializer_class = ContractSerializer
    filterset_fields = ["project", "organization", "kind", "status", "currency"]
    search_fields = ["project__name", "organization__name", "terms"]
    ordering_fields = ["start_date", "created_at", "end_date"]
    ordering = ["-start_date", "-created_at"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return Contract.objects.select_related(
            "project", "organization", "access_grant"
        ).prefetch_related(
            Prefetch("prices", queryset=ContractPrice.objects.order_by("effective_from")),
            Prefetch(
                "status_changes",
                queryset=ContractStatusChange.objects.select_related("actor").order_by(
                    "effective_date", "created_at"
                ),
            ),
        )

    def get_serializer_class(self):
        return ContractDetailSerializer if self.action != "list" else ContractSerializer

    def _respond(self, contract, code=status.HTTP_200_OK):
        return Response(
            ContractDetailSerializer(self.get_queryset().get(pk=contract.pk)).data, status=code
        )

    @extend_schema(request=ContractCreateSerializer, responses={201: ContractDetailSerializer})
    def create(self, request, *args, **kwargs):
        serializer = ContractCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        contract = services.create_contract(
            actor=request.user, request=request, **serializer.validated_data
        )
        return self._respond(contract, status.HTTP_201_CREATED)

    @extend_schema(request=ContractUpdateSerializer, responses=ContractDetailSerializer)
    def partial_update(self, request, *args, **kwargs):
        contract = self.get_object()
        serializer = ContractUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_contract(
            contract, actor=request.user, data=dict(serializer.validated_data), request=request
        )
        return self._respond(contract)

    def update(self, request, *args, **kwargs):
        if not kwargs.get("partial"):
            return Response(
                {"code": "method_not_allowed", "detail": "Usa PATCH."},
                status=status.HTTP_405_METHOD_NOT_ALLOWED,
            )
        return super().update(request, *args, **kwargs)

    @extend_schema(request=ContractTransitionSerializer, responses=ContractDetailSerializer)
    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        contract = self.get_object()
        serializer = ContractTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.transition(
            contract, actor=request.user, request=request, **serializer.validated_data
        )
        return self._respond(contract)

    @extend_schema(request=PriceChangeSerializer, responses=ContractDetailSerializer)
    @action(detail=True, methods=["post"], url_path="change-price")
    def change_price(self, request, pk=None):
        contract = self.get_object()
        serializer = PriceChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.change_price(
            contract, actor=request.user, request=request, **serializer.validated_data
        )
        return self._respond(contract)

    @extend_schema(request=None, responses={201: ReceivableSerializer})
    @action(detail=True, methods=["post"], url_path="generate-receivable")
    def generate_receivable(self, request, pk=None):
        receivable = services.generate_next_receivable(
            self.get_object(), actor=request.user, request=request
        )
        row = metrics.with_paid(receivable_queryset()).get(pk=receivable.pk)
        return Response(ReceivableSerializer(row).data, status=status.HTTP_201_CREATED)


# --- receivables ---------------------------------------------------------------------------


def receivable_queryset():
    return Receivable.objects.select_related("contract__project", "contract__organization")


class ReceivableViewSet(
    FinanceViewMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Expected amounts (billing periods and sale installments)."""

    serializer_class = ReceivableSerializer
    filterset_fields = ["contract", "currency"]
    search_fields = ["concept", "contract__project__name", "contract__organization__name"]
    ordering_fields = ["due_date", "expected_amount", "created_at"]
    ordering = ["due_date"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = metrics.with_paid(receivable_queryset())
        params = getattr(self.request, "query_params", {})
        if params.get("project"):
            qs = qs.filter(contract__project_id=params["project"])
        if params.get("organization"):
            qs = qs.filter(contract__organization_id=params["organization"])
        if params.get("kind"):
            qs = qs.filter(contract__kind=params["kind"])
        if params.get("due_from"):
            qs = qs.filter(due_date__gte=_date_param(params, "due_from", date.min))
        if params.get("due_to"):
            qs = qs.filter(due_date__lte=_date_param(params, "due_to", date.max))
        state = params.get("status")
        today = metrics.business_today()
        outstanding = (ReceivableStatus.PENDING, ReceivableStatus.PARTIAL)
        if state == ReceivableStatus.OVERDUE:
            qs = qs.filter(status__in=outstanding, due_date__lt=today)
        elif state in outstanding:
            qs = qs.filter(status=state, due_date__gte=today)
        elif state == "OPEN":
            qs = qs.filter(status__in=outstanding)
        elif state:
            qs = qs.filter(status=state)
        return qs

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "status",
                str,
                enum=[*ReceivableStatus.values, "OPEN"],
                description="OVERDUE: pendiente con vencimiento pasado. OPEN: por cobrar.",
            ),
            OpenApiParameter("project", OpenApiTypes.UUID),
            OpenApiParameter("organization", OpenApiTypes.UUID),
            OpenApiParameter("kind", str, enum=ContractKind.values),
            OpenApiParameter("due_from", OpenApiTypes.DATE),
            OpenApiParameter("due_to", OpenApiTypes.DATE),
        ]
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def _respond(self, receivable, code=status.HTTP_200_OK):
        return Response(
            ReceivableSerializer(self.get_queryset().get(pk=receivable.pk)).data, status=code
        )

    @extend_schema(request=ReceivableCreateSerializer, responses={201: ReceivableSerializer})
    def create(self, request, *args, **kwargs):
        serializer = ReceivableCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        receivable = services.create_receivable(
            actor=request.user, request=request, **serializer.validated_data
        )
        return self._respond(receivable, status.HTTP_201_CREATED)

    @extend_schema(request=ReceivableUpdateSerializer, responses=ReceivableSerializer)
    def partial_update(self, request, *args, **kwargs):
        receivable = self.get_object()
        serializer = ReceivableUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_receivable(
            receivable, actor=request.user, data=dict(serializer.validated_data), request=request
        )
        return self._respond(receivable)

    def update(self, request, *args, **kwargs):
        if not kwargs.get("partial"):
            return Response(
                {"code": "method_not_allowed", "detail": "Usa PATCH."},
                status=status.HTTP_405_METHOD_NOT_ALLOWED,
            )
        return super().update(request, *args, **kwargs)

    @extend_schema(request=ReasonSerializer, responses=ReceivableSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        receivable = self.get_object()
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.cancel_receivable(
            receivable, actor=request.user, request=request, **serializer.validated_data
        )
        return self._respond(receivable)


# --- payments ------------------------------------------------------------------------------


class PaymentViewSet(
    FinanceViewMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """Payments actually received. No update or delete: reverse or correct instead."""

    serializer_class = PaymentSerializer
    filterset_fields = ["receivable", "method"]
    search_fields = ["reference", "receivable__concept", "receivable__contract__project__name"]
    ordering_fields = ["paid_on", "amount", "created_at"]
    ordering = ["-paid_on", "-created_at"]

    def get_queryset(self):
        qs = Payment.objects.select_related(
            "receivable__contract__project", "receivable__contract__organization", "created_by"
        )
        params = getattr(self.request, "query_params", {})
        if params.get("contract"):
            qs = qs.filter(receivable__contract_id=params["contract"])
        if params.get("project"):
            qs = qs.filter(receivable__contract__project_id=params["project"])
        if params.get("paid_from"):
            qs = qs.filter(paid_on__gte=_date_param(params, "paid_from", date.min))
        if params.get("paid_to"):
            qs = qs.filter(paid_on__lte=_date_param(params, "paid_to", date.max))
        if params.get("include_reversed") != "true":
            qs = qs.filter(reversed_at__isnull=True)
        return qs

    @extend_schema(
        parameters=[
            OpenApiParameter("contract", OpenApiTypes.UUID),
            OpenApiParameter("project", OpenApiTypes.UUID),
            OpenApiParameter("paid_from", OpenApiTypes.DATE),
            OpenApiParameter("paid_to", OpenApiTypes.DATE),
            OpenApiParameter("include_reversed", bool),
        ]
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(request=PaymentCreateSerializer, responses={201: PaymentSerializer})
    def create(self, request, *args, **kwargs):
        serializer = PaymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payment = services.record_payment(
            actor=request.user, request=request, **serializer.validated_data
        )
        return Response(
            PaymentSerializer(self.get_queryset().get(pk=payment.pk)).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(request=ReasonSerializer, responses=PaymentSerializer)
    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        payment = self.get_object()
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reverse_payment(
            payment, actor=request.user, request=request, **serializer.validated_data
        )
        payment.refresh_from_db()
        return Response(PaymentSerializer(payment).data)

    @extend_schema(request=PaymentCorrectSerializer, responses={201: PaymentSerializer})
    @action(detail=True, methods=["post"])
    def correct(self, request, pk=None):
        payment = self.get_object()
        serializer = PaymentCorrectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        corrected = services.correct_payment(
            payment, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(
            PaymentSerializer(Payment.objects.get(pk=corrected.pk)).data,
            status=status.HTTP_201_CREATED,
        )

    def get_object(self):
        # Reversed payments are hidden from the list by default but remain addressable.
        obj = (
            Payment.objects.select_related(
                "receivable__contract__project", "receivable__contract__organization"
            )
            .filter(pk=self.kwargs["pk"])
            .first()
        )
        if obj is None:
            raise NotFound()
        self.check_object_permissions(self.request, obj)
        return obj


# --- expenses ------------------------------------------------------------------------------


class ExpenseViewSet(
    FinanceViewMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Costs of projects and infrastructure. Never deleted: they are voided."""

    serializer_class = ExpenseSerializer
    filterset_fields = ["category", "kind", "currency"]
    search_fields = ["concept", "notes", "project__name"]
    ordering_fields = ["incurred_on", "amount", "created_at"]
    ordering = ["-incurred_on", "-created_at"]
    http_method_names = ["get", "post", "patch", "put", "head", "options"]

    def get_queryset(self):
        qs = Expense.objects.select_related("project").prefetch_related(
            "allocations__project", "allocations__expense"
        )
        params = getattr(self.request, "query_params", {})
        project = params.get("project")
        if project == "general":
            qs = qs.filter(project__isnull=True)
        elif project:
            qs = qs.filter(Q(project_id=project) | Q(allocations__project_id=project)).distinct()
        if params.get("date_from"):
            qs = qs.filter(incurred_on__gte=_date_param(params, "date_from", date.min))
        if params.get("date_to"):
            qs = qs.filter(incurred_on__lte=_date_param(params, "date_to", date.max))
        if params.get("include_voided") != "true":
            qs = qs.filter(voided_at__isnull=True)
        return qs

    def get_object(self):
        obj = self.get_queryset().model.objects.filter(pk=self.kwargs["pk"]).first()
        if obj is None:
            raise NotFound()
        return obj

    @extend_schema(
        parameters=[
            OpenApiParameter("project", str, description="UUID del proyecto o «general»."),
            OpenApiParameter("date_from", OpenApiTypes.DATE),
            OpenApiParameter("date_to", OpenApiTypes.DATE),
            OpenApiParameter("include_voided", bool),
        ]
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def _respond(self, expense, code=status.HTTP_200_OK):
        row = (
            Expense.objects.select_related("project")
            .prefetch_related("allocations__project", "allocations__expense")
            .get(pk=expense.pk)
        )
        return Response(ExpenseSerializer(row).data, status=code)

    @extend_schema(request=ExpenseWriteSerializer, responses={201: ExpenseSerializer})
    def create(self, request, *args, **kwargs):
        serializer = ExpenseWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expense = services.create_expense(
            actor=request.user, request=request, **serializer.validated_data
        )
        return self._respond(expense, status.HTTP_201_CREATED)

    @extend_schema(request=ExpenseWriteSerializer, responses=ExpenseSerializer)
    def partial_update(self, request, *args, **kwargs):
        expense = self.get_object()
        serializer = ExpenseWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_expense(
            expense, actor=request.user, data=dict(serializer.validated_data), request=request
        )
        return self._respond(expense)

    def update(self, request, *args, **kwargs):
        if not kwargs.get("partial"):
            return Response(
                {"code": "method_not_allowed", "detail": "Usa PATCH."},
                status=status.HTTP_405_METHOD_NOT_ALLOWED,
            )
        return super().update(request, *args, **kwargs)

    @extend_schema(request=ReasonSerializer, responses=ExpenseSerializer)
    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        expense = self.get_object()
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.void_expense(
            expense, actor=request.user, request=request, **serializer.validated_data
        )
        return self._respond(expense)

    @extend_schema(request=AllocationsSerializer, responses=ExpenseSerializer)
    @action(detail=True, methods=["put"])
    def allocations(self, request, pk=None):
        expense = self.get_object()
        serializer = AllocationsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.set_allocations(
            expense,
            allocations=[
                (item["project"], item["percentage"])
                for item in serializer.validated_data["allocations"]
            ],
            actor=request.user,
            request=request,
        )
        return self._respond(expense)


# --- metrics -------------------------------------------------------------------------------


class FinanceSummaryView(FinanceViewMixin, APIView):
    """Business & profitability dashboard (global or filtered by project / model)."""

    @extend_schema(parameters=PERIOD_PARAMS, responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(to_json(metrics.financial_summary(parse_filters(request))))


class RecurringRevenueView(FinanceViewMixin, APIView):
    """MRR / ARR: current values, growth, per project, history and movements."""

    @extend_schema(parameters=PERIOD_PARAMS[:4], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(to_json(metrics.recurring_summary(parse_filters(request))))


class UpcomingView(FinanceViewMixin, APIView):
    """Next receivables to collect, overdue ones and contracts about to end."""

    @extend_schema(
        parameters=[
            OpenApiParameter("project", OpenApiTypes.UUID),
            OpenApiParameter("days", int, description="Ventana en días (1–365, por defecto 60)."),
        ],
        responses=OpenApiTypes.OBJECT,
    )
    def get(self, request):
        today = metrics.business_today()
        try:
            days = max(1, min(int(request.query_params.get("days", 60)), 365))
        except ValueError:
            days = 60
        receivables = metrics.with_paid(receivable_queryset()).filter(
            status__in=(ReceivableStatus.PENDING, ReceivableStatus.PARTIAL)
        )
        contracts = (
            Contract.objects.select_related("project", "organization")
            .prefetch_related("prices", "status_changes")
            .filter(
                status=ContractStatus.ACTIVE,
                end_date__isnull=False,
                end_date__gte=today,
                end_date__lte=today + timedelta(days=days),
            )
        )
        project = request.query_params.get("project")
        if project:
            receivables = receivables.filter(contract__project_id=project)
            contracts = contracts.filter(project_id=project)
        return Response(
            {
                "as_of": today.isoformat(),
                "upcoming": ReceivableSerializer(
                    receivables.filter(
                        due_date__gte=today, due_date__lte=today + timedelta(days=days)
                    ).order_by("due_date")[:20],
                    many=True,
                ).data,
                "overdue": ReceivableSerializer(
                    receivables.filter(due_date__lt=today).order_by("due_date")[:20], many=True
                ).data,
                "expiring_contracts": ContractSerializer(
                    contracts.order_by("end_date")[:20], many=True
                ).data,
            }
        )


# --- client portal -------------------------------------------------------------------------


class PortalContractListView(ListAPIView):
    """The client's own contracts explicitly made visible. No amounts, costs or margins."""

    permission_classes = [IsClient]
    serializer_class = PortalContractSerializer
    pagination_class = None
    filter_backends: list = []

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Contract.objects.none()
        next_due = (
            Receivable.objects.filter(
                contract=OuterRef("pk"),
                status__in=(ReceivableStatus.PENDING, ReceivableStatus.PARTIAL),
            )
            .order_by("due_date")
            .values("due_date")[:1]
        )
        return (
            Contract.objects.filter(
                portal_visible=True,
                status__in=PORTAL_VISIBLE_STATUSES,
                organization__is_active=True,
                organization__memberships__user=self.request.user,
            )
            .exclude(project__status=ProjectStatus.ARCHIVED)
            .select_related("project", "organization")
            .annotate(next_due_date=Subquery(next_due))
            .order_by("project__name", "-start_date")
            .distinct()
        )
