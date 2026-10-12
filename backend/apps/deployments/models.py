import hashlib
import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from common.models import TimeStampedModel


class DeploymentStatus(models.TextChoices):
    PENDING = "PENDING", "Pendiente"
    RUNNING = "RUNNING", "En ejecución"
    SUCCESS = "SUCCESS", "Exitoso"
    FAILED = "FAILED", "Fallido"
    CANCELLED = "CANCELLED", "Cancelado"


TERMINAL_STATUSES = frozenset(
    {DeploymentStatus.SUCCESS, DeploymentStatus.FAILED, DeploymentStatus.CANCELLED}
)
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    DeploymentStatus.PENDING: frozenset(
        {DeploymentStatus.RUNNING, DeploymentStatus.FAILED, DeploymentStatus.CANCELLED}
    ),
    DeploymentStatus.RUNNING: frozenset(TERMINAL_STATUSES),
    DeploymentStatus.SUCCESS: frozenset(),
    DeploymentStatus.FAILED: frozenset(),
    DeploymentStatus.CANCELLED: frozenset(),
}


class DeploymentSource(models.TextChoices):
    MANUAL = "MANUAL", "Manual"
    GITHUB_ACTIONS = "GITHUB_ACTIONS", "GitHub Actions"
    API = "API", "Integración API"


def new_correlation_id() -> str:
    return f"dep-{uuid.uuid4().hex}"


class Deployment(TimeStampedModel):
    """One deployment of a version to an environment."""

    environment = models.ForeignKey(
        "infrastructure.Environment", on_delete=models.PROTECT, related_name="deployments"
    )
    version = models.CharField("versión", max_length=50)
    commit_sha = models.CharField("commit", max_length=40, blank=True)
    branch = models.CharField("rama", max_length=120, blank=True)
    source = models.CharField(
        max_length=16, choices=DeploymentSource.choices, default=DeploymentSource.MANUAL
    )
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deployments",
    )
    triggered_by_label = models.CharField("responsable", max_length=150, blank=True)
    status = models.CharField(
        max_length=16,
        choices=DeploymentStatus.choices,
        default=DeploymentStatus.PENDING,
        db_index=True,
    )
    started_at = models.DateTimeField(null=True, blank=True, db_index=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    ci_run_id = models.CharField("ejecución CI/CD", max_length=64, blank=True, db_index=True)
    ci_run_url = models.URLField("URL de la ejecución", max_length=300, blank=True)
    message = models.TextField("mensaje de resultado", blank=True)
    correlation_id = models.CharField(
        max_length=64, default=new_correlation_id, unique=True, editable=False
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["environment", "ci_run_id"],
                condition=~models.Q(ci_run_id=""),
                name="deployment_unique_ci_run_per_environment",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.environment} @ {self.version}"

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES

    @property
    def duration_seconds(self) -> int | None:
        if not self.started_at:
            return None
        end = self.finished_at or (None if self.is_terminal else timezone.now())
        return int((end - self.started_at).total_seconds()) if end else None


TOKEN_PREFIX = "dhs"  # noqa: S105 - public, non-secret prefix that identifies DevHub tokens


def hash_token(raw: str) -> str:
    # Tokens are 256-bit random values, so a fast hash is appropriate (no brute force risk).
    return hashlib.sha256(raw.encode()).hexdigest()


class ServiceTokenQuerySet(models.QuerySet):
    def usable(self):
        now = timezone.now()
        return self.filter(revoked_at__isnull=True).filter(
            models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=now)
        )


class ServiceToken(TimeStampedModel):
    """Credential for CI/CD integrations. Scoped to projects; only its hash is stored."""

    name = models.CharField("nombre", max_length=80)
    key_prefix = models.CharField(max_length=12, unique=True, editable=False)
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    projects = models.ManyToManyField("projects.Project", related_name="service_tokens")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    objects = ServiceTokenQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.key_prefix})"

    @classmethod
    def generate(cls) -> tuple[str, str, str]:
        """Return (raw_token, prefix, hash). The raw token is shown to the user once."""
        prefix = secrets.token_hex(4)
        raw = f"{TOKEN_PREFIX}_{prefix}_{secrets.token_urlsafe(32)}"
        return raw, prefix, hash_token(raw)

    @property
    def state(self) -> str:
        if self.revoked_at:
            return "REVOKED"
        if self.expires_at and self.expires_at <= timezone.now():
            return "EXPIRED"
        return "ACTIVE"
