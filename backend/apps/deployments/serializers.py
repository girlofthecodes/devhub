import re

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.infrastructure.models import Environment, EnvironmentKind
from apps.projects import selectors as project_selectors
from apps.projects.models import Project
from common.validators import validate_public_https_url

from .models import Deployment, DeploymentSource, DeploymentStatus, ServiceToken

_VERSION = re.compile(r"^[\w.+\-]{1,50}$")
_SHA = re.compile(r"^[0-9a-f]{7,40}$")
_BRANCH = re.compile(r"^[\w./\-]{1,120}$")
_RUN_ID = re.compile(r"^[\w.\-]{1,64}$")

INITIAL_STATUSES = [
    (s, label)
    for s, label in DeploymentStatus.choices
    if s in {"PENDING", "RUNNING", "SUCCESS", "FAILED"}
]
TRANSITION_STATUSES = [(s, label) for s, label in DeploymentStatus.choices if s != "PENDING"]


class DeploymentFieldsMixin(serializers.Serializer):
    version = serializers.CharField(max_length=50)
    commit_sha = serializers.CharField(max_length=40, required=False, allow_blank=True)
    branch = serializers.CharField(max_length=120, required=False, allow_blank=True)
    ci_run_url = serializers.CharField(
        max_length=300, required=False, allow_blank=True, validators=[validate_public_https_url]
    )
    message = serializers.CharField(max_length=2000, required=False, allow_blank=True)

    def validate_version(self, value: str) -> str:
        value = value.strip()
        if not _VERSION.match(value):
            raise serializers.ValidationError("Usa letras, números y . _ - + (p. ej. v1.4.0).")
        return value

    def validate_commit_sha(self, value: str) -> str:
        value = value.strip().lower()
        if value and not _SHA.match(value):
            raise serializers.ValidationError("SHA de commit no válido (7–40 caracteres hex).")
        return value

    def validate_branch(self, value: str) -> str:
        value = value.strip()
        if value and not _BRANCH.match(value):
            raise serializers.ValidationError("Nombre de rama no válido.")
        return value


class DeploymentSerializer(serializers.ModelSerializer):
    project = serializers.UUIDField(source="environment.project_id", read_only=True)
    project_name = serializers.CharField(source="environment.project.name", read_only=True)
    project_slug = serializers.CharField(source="environment.project.slug", read_only=True)
    repository_url = serializers.CharField(
        source="environment.project.repository_url", read_only=True
    )
    environment_kind = serializers.CharField(source="environment.kind", read_only=True)
    environment_label = serializers.CharField(source="environment.display_name", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    source_label = serializers.CharField(source="get_source_display", read_only=True)
    duration_seconds = serializers.IntegerField(read_only=True, allow_null=True)
    is_terminal = serializers.BooleanField(read_only=True)
    can_manage = serializers.SerializerMethodField()

    class Meta:
        model = Deployment
        fields = [
            "id",
            "project",
            "project_name",
            "project_slug",
            "repository_url",
            "environment",
            "environment_kind",
            "environment_label",
            "version",
            "commit_sha",
            "branch",
            "source",
            "source_label",
            "triggered_by_label",
            "status",
            "status_label",
            "is_terminal",
            "started_at",
            "finished_at",
            "duration_seconds",
            "ci_run_id",
            "ci_run_url",
            "message",
            "correlation_id",
            "can_manage",
            "created_at",
        ]
        read_only_fields = fields

    def get_can_manage(self, obj: Deployment) -> bool:
        request = self.context.get("request")
        if request is None or not getattr(request.user, "role", None):
            return False
        return project_selectors.can_edit_project(request.user, obj.environment.project)


class DeploymentCreateSerializer(DeploymentFieldsMixin):
    environment = serializers.PrimaryKeyRelatedField(queryset=Environment.objects.all())
    status = serializers.ChoiceField(choices=INITIAL_STATUSES, default="PENDING")


class TransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=TRANSITION_STATUSES)
    message = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class IntegrationDeploymentSerializer(DeploymentFieldsMixin):
    project = serializers.SlugField(help_text="Slug del proyecto en DevHub.")
    environment = serializers.ChoiceField(choices=EnvironmentKind.choices)
    status = serializers.ChoiceField(choices=INITIAL_STATUSES, default="RUNNING")
    ci_run_id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    triggered_by = serializers.CharField(max_length=150, required=False, allow_blank=True)
    source = serializers.ChoiceField(
        choices=[
            (DeploymentSource.GITHUB_ACTIONS, "GitHub Actions"),
            (DeploymentSource.API, "API"),
        ],
        default=DeploymentSource.GITHUB_ACTIONS,
    )

    def validate_ci_run_id(self, value: str) -> str:
        value = value.strip()
        if value and not _RUN_ID.match(value):
            raise serializers.ValidationError("Identificador de ejecución no válido.")
        return value


class DayStatsSerializer(serializers.Serializer):
    date = serializers.DateField()
    SUCCESS = serializers.IntegerField()
    FAILED = serializers.IntegerField()
    CANCELLED = serializers.IntegerField()
    IN_PROGRESS = serializers.IntegerField()


class DeploymentStatsSerializer(serializers.Serializer):
    days = DayStatsSerializer(many=True)
    totals = serializers.DictField(child=serializers.IntegerField())
    success_rate = serializers.FloatField(allow_null=True)


class TokenProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "name", "slug"]
        read_only_fields = fields


class ServiceTokenSerializer(serializers.ModelSerializer):
    projects = TokenProjectSerializer(many=True, read_only=True)
    state = serializers.CharField(read_only=True)
    created_by_email = serializers.EmailField(source="created_by.email", read_only=True, default="")

    class Meta:
        model = ServiceToken
        fields = [
            "id",
            "name",
            "key_prefix",
            "projects",
            "state",
            "expires_at",
            "last_used_at",
            "revoked_at",
            "created_by_email",
            "created_at",
        ]
        read_only_fields = fields


class ServiceTokenCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=80)
    projects = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all(), many=True)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)


class ServiceTokenCreatedSerializer(ServiceTokenSerializer):
    token = serializers.SerializerMethodField(
        help_text="Valor del token. Solo se muestra en esta respuesta."
    )

    class Meta(ServiceTokenSerializer.Meta):
        fields = [*ServiceTokenSerializer.Meta.fields, "token"]
        read_only_fields = fields

    @extend_schema_field(serializers.CharField())
    def get_token(self, obj) -> str:
        return self.context["raw_token"]
