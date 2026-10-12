from rest_framework import serializers

from .models import AuditAction, AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    action_label = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "created_at",
            "actor",
            "actor_email",
            "action",
            "action_label",
            "target_type",
            "target_id",
            "target_repr",
            "changes",
            "metadata",
            "ip_address",
            "request_id",
        ]
        read_only_fields = fields

    def get_action_label(self, obj: AuditLog) -> str:
        try:
            return AuditAction(obj.action).label
        except ValueError:
            return obj.action
