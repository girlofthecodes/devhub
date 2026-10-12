from django.contrib import admin

from .models import Event


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ["occurred_at", "event_type", "severity", "project", "source", "correlation_id"]
    list_filter = ["event_type", "severity", "source"]
    search_fields = ["description", "correlation_id"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
