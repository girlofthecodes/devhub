from django.contrib import admin

from .models import Alert, CheckResult, HealthCheck, MetricSample


@admin.register(HealthCheck)
class HealthCheckAdmin(admin.ModelAdmin):
    list_display = [
        "environment",
        "path",
        "status",
        "last_checked_at",
        "last_response_ms",
        "enabled",
    ]
    list_filter = ["status", "enabled"]
    readonly_fields = [
        "status",
        "last_checked_at",
        "last_response_ms",
        "last_status_code",
        "last_error",
        "consecutive_failures",
        "status_changed_at",
    ]


@admin.register(CheckResult)
class CheckResultAdmin(admin.ModelAdmin):
    list_display = ["health_check", "checked_at", "status", "response_ms", "status_code"]
    list_filter = ["status"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(MetricSample)
class MetricSampleAdmin(admin.ModelAdmin):
    list_display = [
        "environment",
        "recorded_at",
        "cpu_percent",
        "memory_percent",
        "requests_per_minute",
        "error_rate_percent",
    ]
    list_select_related = ["environment__project"]
    date_hierarchy = "recorded_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Alert)
class AlertAdmin(admin.ModelAdmin):
    list_display = ["kind", "environment", "severity", "status", "opened_at", "resolved_at"]
    list_filter = ["status", "severity", "kind"]
    list_select_related = ["environment__project"]

    def has_add_permission(self, request):
        return False
