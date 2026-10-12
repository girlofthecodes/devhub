from django.contrib import admin

from .models import Deployment, ServiceToken


@admin.register(Deployment)
class DeploymentAdmin(admin.ModelAdmin):
    list_display = ["environment", "version", "status", "source", "started_at", "finished_at"]
    list_filter = ["status", "source"]
    search_fields = ["version", "commit_sha", "environment__project__name"]

    def has_change_permission(self, request, obj=None):
        return False  # state changes must go through the service (events + rules)

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ServiceToken)
class ServiceTokenAdmin(admin.ModelAdmin):
    list_display = ["name", "key_prefix", "expires_at", "last_used_at", "revoked_at"]
    readonly_fields = ["key_prefix", "token_hash", "last_used_at"]

    def has_add_permission(self, request):
        return False  # created via the API so the raw value is shown exactly once
