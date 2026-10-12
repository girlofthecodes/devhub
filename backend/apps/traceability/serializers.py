from rest_framework import serializers

from .models import Event


class EventSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    environment_kind = serializers.CharField(
        source="environment.kind", read_only=True, default=None
    )
    deployment_version = serializers.CharField(
        source="deployment.version", read_only=True, default=None
    )
    event_type_label = serializers.CharField(source="get_event_type_display", read_only=True)
    severity_label = serializers.CharField(source="get_severity_display", read_only=True)
    source_label = serializers.CharField(source="get_source_display", read_only=True)

    class Meta:
        model = Event
        fields = [
            "id",
            "occurred_at",
            "event_type",
            "event_type_label",
            "severity",
            "severity_label",
            "source",
            "source_label",
            "description",
            "project",
            "project_name",
            "environment",
            "environment_kind",
            "deployment",
            "deployment_version",
            "correlation_id",
            "actor_label",
            "metadata",
        ]
        read_only_fields = fields
