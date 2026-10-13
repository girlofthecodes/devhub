"""Client-facing representations. Only fields meant for clients are exposed here:
no servers, internal environments, deployments, repositories, members or other clients."""

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.monitoring.services import availability_for_project
from apps.projects.models import Project, Release


class AvailabilitySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["HEALTHY", "DEGRADED", "UNAVAILABLE", "UNKNOWN"])
    label = serializers.CharField()
    checked_at = serializers.DateTimeField(allow_null=True)


class PortalAccessSerializer(serializers.Serializer):
    organization = serializers.CharField()
    expires_at = serializers.DateTimeField(allow_null=True)


class PortalReleaseSerializer(serializers.ModelSerializer):
    project = serializers.UUIDField(source="project_id", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Release
        fields = ["id", "project", "project_name", "version", "title", "notes", "published_at"]
        read_only_fields = fields


class PortalProjectSerializer(serializers.ModelSerializer):
    description = serializers.CharField(source="client_description", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    logo_url = serializers.SerializerMethodField()
    published_version = serializers.CharField(read_only=True, allow_null=True)
    published_at = serializers.DateTimeField(read_only=True, allow_null=True)
    has_demo = serializers.BooleanField(read_only=True)
    availability = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "logo_url",
            "status",
            "status_label",
            "technologies",
            "site_url",
            "published_version",
            "published_at",
            "has_demo",
            "availability",
        ]
        read_only_fields = fields

    def get_logo_url(self, obj: Project) -> str | None:
        return obj.logo.url if obj.logo else None

    @extend_schema_field(AvailabilitySerializer)
    def get_availability(self, obj: Project) -> dict:
        return availability_for_project(obj)


class PortalProjectDetailSerializer(PortalProjectSerializer):
    access = serializers.SerializerMethodField()

    class Meta(PortalProjectSerializer.Meta):
        fields = [*PortalProjectSerializer.Meta.fields, "access"]
        read_only_fields = fields

    @extend_schema_field(PortalAccessSerializer(many=True))
    def get_access(self, obj: Project) -> list[dict]:
        grants = self.context.get("grants", [])
        return [{"organization": g.organization.name, "expires_at": g.expires_at} for g in grants]


class PortalSummarySerializer(serializers.Serializer):
    applications = serializers.IntegerField()
    demos = serializers.IntegerField()
    organizations = serializers.ListField(child=serializers.CharField())
    recent_releases = PortalReleaseSerializer(many=True)


class DemoLaunchSerializer(serializers.Serializer):
    launch_url = serializers.URLField()
    expires_at = serializers.DateTimeField()


class DemoRedeemRequestSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=200)


class DemoRedeemResponseSerializer(serializers.Serializer):
    valid = serializers.BooleanField()
    user = serializers.DictField()
    organization = serializers.CharField(allow_null=True)
    project = serializers.CharField()
    environment = serializers.CharField()
    session_expires_at = serializers.DateTimeField()


class PublicProjectSerializer(serializers.ModelSerializer):
    description = serializers.CharField(source="client_description", read_only=True)
    logo_url = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = ["name", "slug", "description", "logo_url", "technologies", "site_url"]
        read_only_fields = fields

    def get_logo_url(self, obj: Project) -> str | None:
        return obj.logo.url if obj.logo else None
