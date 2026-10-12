from django.contrib import admin

from .models import Project, ProjectAccess, ProjectMember


class ProjectMemberInline(admin.TabularInline):
    model = ProjectMember
    extra = 0
    autocomplete_fields = ["user"]


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "status", "visibility", "owner", "updated_at"]
    list_filter = ["status", "visibility"]
    search_fields = ["name", "slug"]
    readonly_fields = ["archived_at", "status_before_archive"]
    inlines = [ProjectMemberInline]


@admin.register(ProjectAccess)
class ProjectAccessAdmin(admin.ModelAdmin):
    list_display = ["project", "organization", "expires_at", "revoked_at", "created_at"]
    list_filter = ["revoked_at"]
    search_fields = ["project__name", "organization__name"]
