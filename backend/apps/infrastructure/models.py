from django.db import models

from common.models import TimeStampedModel


class ServerType(models.TextChoices):
    APPLICATION = "APPLICATION", "Aplicaciones"
    DATABASE = "DATABASE", "Datos"
    MIXED = "MIXED", "Mixto"
    OTHER = "OTHER", "Otro"


class ServerStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Activo"
    MAINTENANCE = "MAINTENANCE", "Mantenimiento"
    INACTIVE = "INACTIVE", "Inactivo"


class Server(TimeStampedModel):
    """Inventory record for a physical/virtual host. Never stores credentials."""

    name = models.CharField("nombre", max_length=100)
    identifier = models.SlugField("identificador", max_length=63, unique=True)
    location = models.CharField("ubicación lógica", max_length=100, blank=True)
    server_type = models.CharField(
        "tipo", max_length=16, choices=ServerType.choices, default=ServerType.APPLICATION
    )
    operating_system = models.CharField("sistema operativo", max_length=80, blank=True)
    vpn_address = models.GenericIPAddressField("dirección VPN", null=True, blank=True)
    status = models.CharField(
        max_length=16, choices=ServerStatus.choices, default=ServerStatus.ACTIVE, db_index=True
    )
    notes = models.TextField("notas", blank=True)
    # Set by the monitoring process (Fase 6); never filled with simulated values.
    last_checked_at = models.DateTimeField("última verificación", null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.identifier})"


class EnvironmentKind(models.TextChoices):
    DEVELOPMENT = "DEVELOPMENT", "Development"
    DEMO = "DEMO", "Demo"
    PRODUCTION = "PRODUCTION", "Production"


class EnvironmentStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Activo"
    MAINTENANCE = "MAINTENANCE", "Mantenimiento"
    INACTIVE = "INACTIVE", "Inactivo"


class Environment(TimeStampedModel):
    """A deployment target of a project (one per kind)."""

    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="environments"
    )
    server = models.ForeignKey(
        Server,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="environments",
        verbose_name="servidor",
    )
    kind = models.CharField("tipo", max_length=16, choices=EnvironmentKind.choices)
    name = models.CharField("nombre", max_length=60, blank=True)
    public_url = models.URLField("URL pública", max_length=300, blank=True)
    deployed_version = models.CharField("versión desplegada", max_length=50, blank=True)
    status = models.CharField(
        max_length=16,
        choices=EnvironmentStatus.choices,
        default=EnvironmentStatus.ACTIVE,
        db_index=True,
    )

    class Meta:
        ordering = ["project__name", "kind"]
        constraints = [
            models.UniqueConstraint(fields=["project", "kind"], name="environment_one_per_kind"),
        ]

    def __str__(self) -> str:
        return f"{self.project} · {self.display_name}"

    @property
    def display_name(self) -> str:
        return self.name or self.get_kind_display()
