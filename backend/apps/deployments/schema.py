"""OpenAPI description of the service-token authentication."""

from drf_spectacular.extensions import OpenApiAuthenticationExtension


class ServiceTokenScheme(OpenApiAuthenticationExtension):
    target_class = "apps.deployments.authentication.ServiceTokenAuthentication"
    name = "ServiceToken"

    def get_security_definition(self, auto_schema):
        return {
            "type": "http",
            "scheme": "bearer",
            "description": "Token de servicio de DevHub (`dhs_…`), limitado a proyectos.",
        }
