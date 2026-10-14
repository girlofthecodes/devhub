import uuid
from functools import cached_property

from django.contrib.auth.models import AbstractUser, BaseUserManager, Group
from django.db import models

from .roles import ROLE_NAMES, Role


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra_fields):
        if not email:
            raise ValueError("El correo electrónico es obligatorio.")
        user = self.model(email=self.normalize_email(email).lower(), **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email: str, password: str | None = None, **extra_fields):
        extra_fields["is_staff"] = True
        extra_fields["is_superuser"] = True
        user = self._create_user(email, password, **extra_fields)
        group, _ = Group.objects.get_or_create(name=Role.ADMIN)
        user.groups.add(group)
        return user


class User(AbstractUser):
    """DevHub user. Authenticates by e-mail; its role is the Django Group it belongs to."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = None
    email = models.EmailField("correo electrónico", unique=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()

    class Meta:
        ordering = ["email"]

    def __str__(self) -> str:
        return self.email

    def save(self, *args, **kwargs):
        self.email = (self.email or "").strip().lower()
        super().save(*args, **kwargs)

    @cached_property
    def role(self) -> str | None:
        return self.primary_role()

    def primary_role(self) -> str | None:
        """Role from the user's groups, ignoring any portal context pinned on the instance."""
        names = set(self.groups.values_list("name", flat=True)) & ROLE_NAMES
        for candidate in (Role.ADMIN, Role.DEVELOPER, Role.CLIENT, Role.VISITOR):
            if candidate in names:
                return candidate
        return Role.ADMIN if self.is_superuser else None

    def clear_role_cache(self) -> None:
        self.__dict__.pop("role", None)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email


class UserSession(models.Model):
    """Tracks sessions per user so they can be revoked (e.g. on deactivation)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="tracked_sessions")
    session_key = models.CharField(max_length=40, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=256, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user_id} @ {self.created_at:%Y-%m-%d %H:%M}"
