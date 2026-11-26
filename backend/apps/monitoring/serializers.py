from rest_framework import serializers

from apps.infrastructure.models import Environment
from apps.projects import selectors as project_selectors

from . import services
from .models import METRIC_FIELDS, Alert, CheckResult, HealthCheck, HealthStatus, MetricSample


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


# --- internal metrics and alerts ------------------------------------------------------


class MetricIngestSerializer(serializers.Serializer):
    """Payload an application pushes with its service token (all metrics optional)."""

    project = serializers.SlugField(max_length=140)
    environment = serializers.ChoiceField(choices=["DEVELOPMENT", "DEMO", "PRODUCTION"])
    recorded_at = serializers.DateTimeField(required=False)
    cpu_percent = serializers.FloatField(min_value=0, max_value=100, required=False)
    memory_percent = serializers.FloatField(min_value=0, max_value=100, required=False)
    memory_used_mb = serializers.IntegerField(min_value=0, max_value=10_000_000, required=False)
    requests_per_minute = serializers.FloatField(min_value=0, max_value=10_000_000, required=False)
    error_rate_percent = serializers.FloatField(min_value=0, max_value=100, required=False)
    latency_p95_ms = serializers.IntegerField(min_value=0, max_value=600_000, required=False)
    active_connections = serializers.IntegerField(min_value=0, max_value=10_000_000, required=False)
    process_uptime_seconds = serializers.IntegerField(min_value=0, max_value=10**10, required=False)


class MetricSampleSerializer(serializers.ModelSerializer):
    class Meta:
        model = MetricSample
        fields = ["id", "environment", "recorded_at", "received_at", *METRIC_FIELDS]
        read_only_fields = fields


class AlertSerializer(serializers.ModelSerializer):
    project = serializers.UUIDField(source="environment.project_id", read_only=True)
    project_name = serializers.CharField(source="environment.project.name", read_only=True)
    environment_kind = serializers.CharField(source="environment.kind", read_only=True)
    environment_label = serializers.CharField(source="environment.display_name", read_only=True)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    duration_seconds = serializers.IntegerField(read_only=True)
    acknowledged_by_email = serializers.CharField(
        source="acknowledged_by.email", read_only=True, default=None
    )
    resolved_by_email = serializers.CharField(
        source="resolved_by.email", read_only=True, default=None
    )
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = Alert
        fields = [
            "id",
            "environment",
            "project",
            "project_name",
            "environment_kind",
            "environment_label",
            "kind",
            "kind_label",
            "severity",
            "status",
            "status_label",
            "message",
            "value",
            "threshold",
            "hits",
            "opened_at",
            "last_seen_at",
            "acknowledged_at",
            "acknowledged_by_email",
            "resolved_at",
            "resolved_by_email",
            "duration_seconds",
            "can_edit",
        ]
        read_only_fields = fields

    def get_can_edit(self, obj: Alert) -> bool:
        request = self.context.get("request")
        return bool(request) and project_selectors.can_edit_project(
            request.user, obj.environment.project
        )


class AlertSummarySerializer(serializers.Serializer):
    open = serializers.IntegerField()
    acknowledged = serializers.IntegerField()
    critical = serializers.IntegerField()
    resolved_7d = serializers.IntegerField()
    opened_24h = serializers.IntegerField()
    mttr_seconds_7d = serializers.IntegerField(allow_null=True)
