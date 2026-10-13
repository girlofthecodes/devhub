from rest_framework import serializers

from apps.infrastructure.models import Environment
from apps.projects import selectors as project_selectors

from . import services
from .models import CheckResult, HealthCheck, HealthStatus


class HealthCheckSerializer(serializers.ModelSerializer):
    project = serializers.UUIDField(source="environment.project_id", read_only=True)
    project_name = serializers.CharField(source="environment.project.name", read_only=True)
    environment_kind = serializers.CharField(source="environment.kind", read_only=True)
    environment_label = serializers.CharField(source="environment.display_name", read_only=True)
    server_name = serializers.CharField(
        source="environment.server.name", read_only=True, default=None
    )
    target_url = serializers.CharField(read_only=True)
    effective_status = serializers.CharField(read_only=True)
    effective_status_label = serializers.SerializerMethodField()
    is_stale = serializers.BooleanField(read_only=True)
    uptime_24h = serializers.SerializerMethodField()
    uptime_7d = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = HealthCheck
        fields = [
            "id",
            "environment",
            "project",
            "project_name",
            "environment_kind",
            "environment_label",
            "server_name",
            "target_url",
            "path",
            "expected_status_min",
            "expected_status_max",
            "interval_seconds",
            "timeout_seconds",
            "degraded_threshold_ms",
            "failure_threshold",
            "enabled",
            "status",
            "effective_status",
            "effective_status_label",
            "is_stale",
            "last_checked_at",
            "last_response_ms",
            "last_status_code",
            "last_error",
            "consecutive_failures",
            "status_changed_at",
            "uptime_24h",
            "uptime_7d",
            "can_edit",
            "created_at",
        ]
        read_only_fields = fields

    def get_effective_status_label(self, obj: HealthCheck) -> str:
        if obj.enabled and obj.is_stale:
            return "Verificación desactualizada"
        if obj.enabled and obj.last_checked_at is None:
            return "Pendiente de verificar"
        if not obj.enabled:
            return "Desactivado"
        return HealthStatus(obj.effective_status).label

    def get_uptime_24h(self, obj: HealthCheck) -> float | None:
        return services.uptime(obj, hours=24)

    def get_uptime_7d(self, obj: HealthCheck) -> float | None:
        return services.uptime(obj, hours=24 * 7)

    def get_can_edit(self, obj: HealthCheck) -> bool:
        request = self.context.get("request")
        return bool(request) and project_selectors.can_edit_project(
            request.user, obj.environment.project
        )


class HealthCheckWriteSerializer(serializers.Serializer):
    environment = serializers.PrimaryKeyRelatedField(queryset=Environment.objects.all())
    path = serializers.CharField(max_length=200, required=False)
    expected_status_min = serializers.IntegerField(min_value=100, max_value=599, required=False)
    expected_status_max = serializers.IntegerField(min_value=100, max_value=599, required=False)
    interval_seconds = serializers.IntegerField(min_value=1, max_value=86400, required=False)
    timeout_seconds = serializers.IntegerField(min_value=1, max_value=60, required=False)
    degraded_threshold_ms = serializers.IntegerField(min_value=100, max_value=60000, required=False)
    failure_threshold = serializers.IntegerField(min_value=1, max_value=10, required=False)
    enabled = serializers.BooleanField(required=False)


class HealthCheckUpdateSerializer(HealthCheckWriteSerializer):
    environment = None


class CheckResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = CheckResult
        fields = ["id", "checked_at", "status", "response_ms", "status_code", "error"]
        read_only_fields = fields


class MonitoringSummarySerializer(serializers.Serializer):
    total = serializers.IntegerField()
    by_status = serializers.DictField(child=serializers.IntegerField())
    stale = serializers.IntegerField()
    environments_without_check = serializers.IntegerField()
