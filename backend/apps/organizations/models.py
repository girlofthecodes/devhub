from django.conf import settings
from django.db import models
from django.db.models.functions import Lower

from common.models import TimeStampedModel


class Organization(TimeStampedModel):
    """A company, client or team. Clients reach projects through their organization."""

    name = models.CharField("nombre", max_length=150)
    slug = models.SlugField(max_length=160, unique=True)
    description = models.TextField("descripción", blank=True)
    contact_email = models.EmailField("correo de contacto", blank=True)
    is_active = models.BooleanField("activa", default=True, db_index=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="organization_name_ci_unique"),
        ]

    def __str__(self) -> str:
        return self.name


class MembershipRole(models.TextChoices):
    OWNER = "OWNER", "Responsable"
    MEMBER = "MEMBER", "Miembro"


class Membership(TimeStampedModel):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(
        max_length=16, choices=MembershipRole.choices, default=MembershipRole.MEMBER
    )

    class Meta:
        ordering = ["organization__name", "user__email"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "user"], name="membership_unique_user_per_org"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user} @ {self.organization}"
