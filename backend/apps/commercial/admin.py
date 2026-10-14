from django.contrib import admin

from .models import CommercialProfile, Contract, Expense, Payment, Receivable


class ReadOnlyAdmin(admin.ModelAdmin):
    """Financial records are managed through the API (services keep audit and integrity)."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(CommercialProfile)
class CommercialProfileAdmin(ReadOnlyAdmin):
    list_display = ["project", "status", "updated_at"]
    list_filter = ["status"]


@admin.register(Contract)
class ContractAdmin(ReadOnlyAdmin):
    list_display = ["project", "organization", "kind", "status", "currency", "start_date"]
    list_filter = ["kind", "status", "currency"]


@admin.register(Receivable)
class ReceivableAdmin(ReadOnlyAdmin):
    list_display = ["contract", "concept", "due_date", "expected_amount", "status"]
    list_filter = ["status"]


@admin.register(Payment)
class PaymentAdmin(ReadOnlyAdmin):
    list_display = ["receivable", "amount", "paid_on", "method", "reversed_at"]


@admin.register(Expense)
class ExpenseAdmin(ReadOnlyAdmin):
    list_display = ["concept", "category", "amount", "currency", "incurred_on", "project"]
    list_filter = ["category", "kind"]
