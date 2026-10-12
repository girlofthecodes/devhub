import re

from rest_framework import serializers

from apps.projects import selectors as project_selectors
from apps.projects.models import Project
from common.validators import validate_private_address, validate_public_https_url

from .models import (
    Environment,
    EnvironmentKind,
    EnvironmentStatus,
    Server,
    ServerStatus,
    ServerType,
)

_IDENTIFIER = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_VERSION = re.compile(r"^[\w.+\-]{1,50}$")


class ServerSerializer(serializers.ModelSerializer):
    server_type_label = serializers.CharField(source="get_server_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    environment_count = serializers.IntegerField(read_only=True, default=0)
    active_environment_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Server
        fields = [
            "id",
            "name",
            "identifier",
            "location",
            "server_type",
            "server_type_label",
            "operating_system",
            "vpn_address",
            "status",
            "status_label",
            "notes",
            "last_checked_at",
            "environment_count",
            "active_environment_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class ServerWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    identifier = serializers.CharField(max_length=63)
    location = serializers.CharField(max_length=100, allow_blank=True, required=False)
    server_type = serializers.ChoiceField(choices=ServerType.choices, required=False)
    operating_system = serializers.CharField(max_length=80, allow_blank=True, required=False)
    vpn_address = serializers.CharField(
        allow_blank=True, allow_null=True, required=False, validators=[validate_private_address]
    )
    status = serializers.ChoiceField(choices=ServerStatus.choices, required=False)
    notes = serializers.CharField(max_length=2000, allow_blank=True, required=False)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Mínimo 2 caracteres.")
        return value

    def validate_identifier(self, value: str) -> str:
        value = value.strip().lower()
        if not _IDENTIFIER.match(value):
            raise serializers.ValidationError(
                "Usa minúsculas, números y guiones (p. ej. «homelab-app-01»)."
            )
        return value

    def validate_vpn_address(self, value):
        return value or None


class ServerSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Server
        fields = ["id", "name", "identifier", "status"]
        read_only_fields = fields


class EnvironmentSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    project_slug = serializers.CharField(source="project.slug", read_only=True)
    server_detail = ServerSummarySerializer(source="server", read_only=True, allow_null=True)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    display_name = serializers.CharField(read_only=True)
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = Environment
        fields = [
            "id",
            "project",
            "project_name",
            "project_slug",
            "kind",
            "kind_label",
            "name",
            "display_name",
            "server",
            "server_detail",
            "public_url",
            "deployed_version",
            "status",
            "status_label",
            "can_edit",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_can_edit(self, obj: Environment) -> bool:
        request = self.context.get("request")
        if request is None:
            return False
        return not obj.project.is_archived and project_selectors.can_edit_project(
            request.user, obj.project
        )


class EnvironmentWriteSerializer(serializers.Serializer):
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all())
    kind = serializers.ChoiceField(choices=EnvironmentKind.choices)
    name = serializers.CharField(max_length=60, allow_blank=True, required=False)
    server = serializers.PrimaryKeyRelatedField(
        queryset=Server.objects.all(), allow_null=True, required=False
    )
    public_url = serializers.CharField(
        max_length=300, allow_blank=True, required=False, validators=[validate_public_https_url]
    )
    deployed_version = serializers.CharField(max_length=50, allow_blank=True, required=False)
    status = serializers.ChoiceField(choices=EnvironmentStatus.choices, required=False)

    def validate_name(self, value: str) -> str:
        return value.strip()

    def validate_deployed_version(self, value: str) -> str:
        value = value.strip()
        if value and not _VERSION.match(value):
            raise serializers.ValidationError(
                "Usa letras, números y . _ - + (p. ej. «v1.4.0» o «2026.10.1»)."
            )
        return value


class EnvironmentUpdateSerializer(EnvironmentWriteSerializer):
    """Project and kind are immutable after creation."""

    project = None
    kind = None


class InfrastructureSummarySerializer(serializers.Serializer):
    servers = serializers.DictField()
    environments = serializers.DictField()
