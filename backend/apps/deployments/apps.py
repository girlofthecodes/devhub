from django.apps import AppConfig


class DeploymentsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.deployments"
    label = "deployments"
    verbose_name = "Despliegues"

    def ready(self) -> None:
        from . import schema  # noqa: F401  (registers the OpenAPI auth extension)
