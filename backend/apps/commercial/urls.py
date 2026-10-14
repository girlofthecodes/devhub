from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register(
    "commercial/applications", views.CommercialApplicationViewSet, basename="commercial-app"
)
router.register("commercial/contracts", views.ContractViewSet, basename="contract")
router.register("commercial/receivables", views.ReceivableViewSet, basename="receivable")
router.register("commercial/payments", views.PaymentViewSet, basename="payment")
router.register("commercial/expenses", views.ExpenseViewSet, basename="expense")

urlpatterns = [
    path("commercial/summary/", views.FinanceSummaryView.as_view(), name="commercial-summary"),
    path(
        "commercial/recurring/", views.RecurringRevenueView.as_view(), name="commercial-recurring"
    ),
    path("commercial/upcoming/", views.UpcomingView.as_view(), name="commercial-upcoming"),
    path("portal/contracts/", views.PortalContractListView.as_view(), name="portal-contracts"),
    *router.urls,
]
