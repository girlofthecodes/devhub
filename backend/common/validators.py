"""Reusable validators for URLs and network addresses."""

import ipaddress
from urllib.parse import urlparse

from django.conf import settings
from django.core.exceptions import ValidationError

_BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa")
# Tailscale/WireGuard commonly use CGNAT space for VPN addresses.
_CGNAT = ipaddress.ip_network("100.64.0.0/10")


def validate_public_https_url(value: str) -> None:
    """A public, https URL pointing to a domain name (never an IP or internal host).

    Prevents registering targets that later processes (monitoring) could abuse for SSRF.
    If DEVHUB_ALLOWED_PUBLIC_DOMAINS is configured, the host must belong to one of them.
    """
    if not value:
        return
    try:
        parsed = urlparse(value)
    except ValueError as exc:
        raise ValidationError("URL no válida.") from exc
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        raise ValidationError("Debe ser una URL https:// válida.")
    if parsed.username or parsed.password:
        raise ValidationError("La URL no puede incluir credenciales.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValidationError("Usa un nombre de dominio, no una dirección IP.")
    if host == "localhost" or host.endswith(_BLOCKED_SUFFIXES) or "." not in host:
        raise ValidationError("El dominio debe ser público (no localhost ni nombres internos).")
    allowed = [
        d.lower().lstrip(".") for d in getattr(settings, "DEVHUB_ALLOWED_PUBLIC_DOMAINS", [])
    ]
    if allowed and not any(host == d or host.endswith("." + d) for d in allowed):
        raise ValidationError(
            "Dominio no autorizado. Permitidos: " + ", ".join(sorted(allowed)) + "."
        )


def validate_private_address(value: str) -> None:
    """VPN/LAN addresses must be private (RFC 1918/4193) or CGNAT, never public."""
    if not value:
        return
    try:
        ip = ipaddress.ip_address(value)
    except ValueError as exc:
        raise ValidationError("Dirección IP no válida.") from exc
    if ip.is_loopback or ip.is_unspecified or ip.is_multicast:
        raise ValidationError("Dirección IP no válida para un servidor.")
    if not (ip.is_private or (ip.version == 4 and ip in _CGNAT)):
        raise ValidationError("Debe ser una dirección privada de la VPN o LAN, nunca pública.")
