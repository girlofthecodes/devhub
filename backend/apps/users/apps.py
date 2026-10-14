from django.apps import AppConfig
from django.db.models.signals import post_migrate


def sync_roles(**kwargs):
    """Idempotently create role groups and attach their model permissions."""
    from django.contrib.auth.models import Group, Permission

    from .roles import CUSTOM_PERMISSIONS, ROLE_MODEL_PERMISSIONS

    for role, models_perms in ROLE_MODEL_PERMISSIONS.items():
        group, _ = Group.objects.get_or_create(name=role)
        perms = []
        for model_label, actions in models_perms.items():
            app_label, model = model_label.split(".")
            codenames = [a if a in CUSTOM_PERMISSIONS else f"{a}_{model}" for a in actions]
            perms.extend(
                Permission.objects.filter(content_type__app_label=app_label, codename__in=codenames)
            )
        group.permissions.set(perms)


class UsersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.users"
    label = "users"
    verbose_name = "Usuarios"

    def ready(self) -> None:
        from . import (
            schema,  # noqa: F401  (registers the OpenAPI auth extension)
            signals,  # noqa: F401
        )

        post_migrate.connect(sync_roles, dispatch_uid="devhub_sync_roles")
