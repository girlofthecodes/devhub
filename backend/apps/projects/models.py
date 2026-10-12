import uuid

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone

from common.models import TimeStampedModel


class ProjectStatus(models.TextChoices):
    PLANNING = "PLANNING", "Planificación"
    DEVELOPMENT = "DEVELOPMENT", "Desarrollo"
    TESTING = "TESTING", "Pruebas"
    AVAILABLE = "AVAILABLE", "Disponible"
    MAINTENANCE = "MAINTENANCE", "Mantenimiento"
    ARCHIVED = "ARCHIVED", "Archivado"


class ProjectVisibility(models.TextChoices):
    INTERNAL = "INTERNAL", "Interno"
    PUBLIC = "PUBLIC", "Portafolio público"


def logo_upload_to(instance: "Project", filename: str) -> str:
    # Random name: never trust the client-provided filename.
    ext = filename.rsplit(".", 1)[-1].lower()
    return f"projects/logos/{instance.pk}/{uuid.uuid4().hex}.{ext}"


class ProjectQuerySet(models.QuerySet):
    def active(self):
        return self.exclude(status=ProjectStatus.ARCHIVED)


class Project(TimeStampedModel):
    """An independent application managed by DevHub."""

    name = models.CharField("nombre", max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    description = models.TextField("descripción", blank=True)
    logo = models.ImageField(upload_to=logo_upload_to, blank=True)
    repository_url = models.URLField("repositorio", max_length=300, blank=True)
    documentation_url = models.URLField("documentación", max_length=300, blank=True)
    site_url = models.URLField(
        "URL del sitio",
        max_length=300,
        blank=True,
        help_text="URL pública donde está desplegada la aplicación.",
    )
    technologies = ArrayField(models.CharField(max_length=40), default=list, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_projects",
        verbose_name="responsable",
    )
    status = models.CharField(
        max_length=16, choices=ProjectStatus.choices, default=ProjectStatus.PLANNING, db_index=True
    )
    status_before_archive = models.CharField(
        max_length=16, choices=ProjectStatus.choices, blank=True
    )
    visibility = models.CharField(
        max_length=16, choices=ProjectVisibility.choices, default=ProjectVisibility.INTERNAL
    )
    archived_at = models.DateTimeField(null=True, blank=True)

    objects = ProjectQuerySet.as_manager()

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="project_name_ci_unique"),
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def is_archived(self) -> bool:
        return self.status == ProjectStatus.ARCHIVED


class ProjectMemberRole(models.TextChoices):
    MAINTAINER = "MAINTAINER", "Mantenedor"
    CONTRIBUTOR = "CONTRIBUTOR", "Colaborador"


class ProjectMember(TimeStampedModel):
    """Developer assigned to a project."""

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_memberships"
    )
    role = models.CharField(
        max_length=16, choices=ProjectMemberRole.choices, default=ProjectMemberRole.CONTRIBUTOR
    )

    class Meta:
        ordering = ["project__name", "user__email"]
        constraints = [
            models.UniqueConstraint(fields=["project", "user"], name="project_member_unique"),
        ]

    def __str__(self) -> str:
        return f"{self.user} → {self.project}"


class ProjectAccessQuerySet(models.QuerySet):
    def current(self, at=None):
        """Grants that are neither revoked nor expired."""
        at = at or timezone.now()
        return self.filter(revoked_at__isnull=True).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=at)
        )


class ProjectAccess(TimeStampedModel):
    """Explicit grant of a project to an organization. Revoked grants are kept as history."""

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="access_grants")
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="project_grants"
    )
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    expires_at = models.DateTimeField("expira", null=True, blank=True)
    notes = models.CharField("notas", max_length=255, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    objects = ProjectAccessQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "organization"],
                condition=Q(revoked_at__isnull=True),
                name="project_access_one_open_grant",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.organization} → {self.project}"

    @property
    def state(self) -> str:
        if self.revoked_at:
            return "REVOKED"
        if self.expires_at and self.expires_at <= timezone.now():
            return "EXPIRED"
        return "ACTIVE"
