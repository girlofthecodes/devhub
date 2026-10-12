from django.contrib import admin

from .models import Environment, Server


@admin.register(Server)
class ServerAdmin(admin.ModelAdmin):
    list_display = ["name", "identifier", "server_type", "status", "location", "last_checked_at"]
    list_filter = ["status", "server_type"]
    search_fields = ["name", "identifier"]
    readonly_fields = ["last_checked_at"]


@admin.register(Environment)
class EnvironmentAdmin(admin.ModelAdmin):
    list_display = ["project", "kind", "server", "status", "deployed_version", "updated_at"]
    list_filter = ["kind", "status"]
    search_fields = ["project__name", "public_url"]
