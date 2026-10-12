import re

from django.core.validators import URLValidator
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.users.models import User

from . import selectors
from .models import Project, ProjectAccess, ProjectMember, ProjectStatus, ProjectVisibility

https_only = URLValidator(schemes=["https"], message="Debe ser una URL https:// válida.")
_TECH_RE = re.compile(r"^[\w .#+\-/]+$", re.UNICODE)
EDITABLE_STATUSES = [c for c in ProjectStatus.choices if c[0] != ProjectStatus.ARCHIVED]


class UserSummarySerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    role = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "is_active"]
        read_only_fields = fields


class ProjectPermissionsSerializer(serializers.Serializer):
    can_edit = serializers.BooleanField()
    can_manage = serializers.BooleanField()


class ProjectSerializer(serializers.ModelSerializer):
    owner = UserSummarySerializer(read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    visibility_label = serializers.CharField(source="get_visibility_display", read_only=True)
    logo_url = serializers.SerializerMethodField()
    is_archived = serializers.BooleanField(read_only=True)
    member_count = serializers.IntegerField(read_only=True, default=0)
    organization_count = serializers.IntegerField(read_only=True, default=0)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "logo_url",
            "repository_url",
            "documentation_url",
            "site_url",
            "technologies",
            "owner",
            "status",
            "status_label",
            "visibility",
            "visibility_label",
            "is_archived",
            "archived_at",
            "member_count",
            "organization_count",
            "permissions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_logo_url(self, obj: Project) -> str | None:
        return obj.logo.url if obj.logo else None

    @extend_schema_field(ProjectPermissionsSerializer)
    def get_permissions(self, obj: Project) -> dict:
        user = self.context["request"].user
        return {
            "can_edit": not obj.is_archived and selectors.can_edit_project(user, obj),
            "can_manage": selectors.can_manage_project(user),
        }


class ProjectWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    description = serializers.CharField(allow_blank=True, required=False, max_length=5000)
    repository_url = serializers.CharField(
        allow_blank=True, required=False, max_length=300, validators=[https_only]
    )
    documentation_url = serializers.CharField(
        allow_blank=True, required=False, max_length=300, validators=[https_only]
    )
    site_url = serializers.CharField(
        allow_blank=True, required=False, max_length=300, validators=[https_only]
    )
    technologies = serializers.ListField(
        child=serializers.CharField(max_length=40), required=False, max_length=20
    )
    owner = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())
    status = serializers.ChoiceField(choices=EDITABLE_STATUSES, required=False)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("El nombre debe tener al menos 2 caracteres.")
        return value

    def validate_technologies(self, value: list[str]) -> list[str]:
        result, seen = [], set()
        for raw in value:
            tech = " ".join(raw.split())
            if not tech:
                continue
            if not _TECH_RE.match(tech):
                raise serializers.ValidationError(f"«{tech}» contiene caracteres no permitidos.")
            if tech.lower() not in seen:
                seen.add(tech.lower())
                result.append(tech)
        return result


class VisibilitySerializer(serializers.Serializer):
    visibility = serializers.ChoiceField(choices=ProjectVisibility.choices)


class LogoUploadSerializer(serializers.Serializer):
    logo = serializers.FileField()


class ProjectMemberSerializer(serializers.ModelSerializer):
    user_detail = UserSummarySerializer(source="user", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = ProjectMember
        fields = ["id", "project", "project_name", "user", "user_detail", "role", "created_at"]
        read_only_fields = ["id", "project_name", "user_detail", "created_at"]
        validators = []  # uniqueness enforced by the service with a friendly message


class ProjectMemberUpdateSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=ProjectMember._meta.get_field("role").choices)


class ProjectAccessSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    project_slug = serializers.CharField(source="project.slug", read_only=True)
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    granted_by_email = serializers.EmailField(source="granted_by.email", read_only=True, default="")
    revoked_by_email = serializers.EmailField(source="revoked_by.email", read_only=True, default="")
    state = serializers.ChoiceField(choices=["ACTIVE", "EXPIRED", "REVOKED"], read_only=True)

    class Meta:
        model = ProjectAccess
        fields = [
            "id",
            "project",
            "project_name",
            "project_slug",
            "organization",
            "organization_name",
            "state",
            "expires_at",
            "notes",
            "granted_by_email",
            "created_at",
            "revoked_at",
            "revoked_by_email",
        ]
        read_only_fields = [
            "id",
            "project_name",
            "project_slug",
            "organization_name",
            "state",
            "granted_by_email",
            "created_at",
            "revoked_at",
            "revoked_by_email",
        ]
        validators = []


class ProjectAccessUpdateSerializer(serializers.Serializer):
    expires_at = serializers.DateTimeField(allow_null=True, required=False)
    notes = serializers.CharField(max_length=255, allow_blank=True, required=False)
