from django.conf import settings
from django.db import models

from common.models import UUIDModel


class DemoAccessToken(UUIDModel):
    """Single-use, short-lived ticket that lets an authorized client open a demo.

    DevHub never trusts its own session as authorization for an external URL: the demo
    application must redeem this ticket against DevHub (server-to-server, with a service
    token) before granting access. Only the SHA-256 of the ticket is stored.
    """

    environment = models.ForeignKey(
        "infrastructure.Environment", on_delete=models.CASCADE, related_name="demo_tokens"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="demo_tokens"
    )
    organization = models.ForeignKey(
        "organizations.Organization", null=True, on_delete=models.SET_NULL, related_name="+"
    )
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    redeemed_at = models.DateTimeField(null=True, blank=True)
    redeemed_by_service = models.CharField(max_length=80, blank=True)
    session_expires_at = models.DateTimeField(null=True, blank=True)
    issued_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"demo {self.environment_id} → {self.user_id}"
