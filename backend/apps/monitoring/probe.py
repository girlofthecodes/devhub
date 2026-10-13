"""SSRF-hardened HTTPS probe used by the monitor.

Defenses (in order):
1. The URL is rebuilt from an already-validated public https domain (Environment.public_url)
   plus a validated path; it is re-validated here anyway.
2. Only https and an allow-listed set of ports.
3. DNS is resolved *at check time*; if ANY resolved address is private, loopback,
   link-local, multicast, reserved or unspecified, the probe is refused.
4. The TCP connection is pinned to the vetted IP (no second resolution → no DNS rebinding),
   while TLS still verifies the certificate for the original hostname (SNI).
5. Redirects are never followed; at most a small amount of the body is read; strict
   connect/read timeout.
"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlsplit

from django.conf import settings

from common.validators import validate_public_https_url

MAX_BODY_BYTES = 64 * 1024
USER_AGENT = "DevHub-Monitor/1.0"


class ProbeRefused(Exception):
    """The target is not allowed by policy (never contacted)."""


class ProbeDNSError(Exception):
    """The hostname could not be resolved (the service is unreachable, not forbidden)."""


@dataclass(frozen=True)
class ProbeResult:
    ok_connection: bool
    status_code: int | None
    response_ms: int | None
    error: str = ""


Resolver = Callable[[str, int], list[str]]


def system_resolver(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return sorted({info[4][0] for info in infos})


def _is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
        or (addr.version == 4 and addr in ipaddress.ip_network("100.64.0.0/10"))
    )


def validate_path(path: str) -> str:
    if not path.startswith("/") or path.startswith("//") or ".." in path:
        raise ValueError("La ruta debe empezar con «/» y no contener «//» ni «..».")
    if any(c in path for c in " \t\r\n\\#"):
        raise ValueError("La ruta contiene caracteres no permitidos.")
    if len(path) > 200:
        raise ValueError("La ruta es demasiado larga.")
    return path


def resolve_target(url: str, resolver: Resolver = system_resolver) -> tuple[str, int, str, str]:
    """Return (host, port, request_path, pinned_ip) or raise ProbeRefused."""
    try:
        validate_public_https_url(url)
    except Exception as exc:  # django ValidationError
        raise ProbeRefused("URL no permitida para monitoreo.") from exc
    parts = urlsplit(url)
    host = parts.hostname or ""
    port = parts.port or 443
    if port not in settings.MONITOR_ALLOWED_PORTS:
        raise ProbeRefused(f"Puerto {port} no permitido para monitoreo.")
    try:
        addresses = resolver(host, port)
    except OSError as exc:
        raise ProbeDNSError(f"DNS: no se pudo resolver {host}") from exc
    if not addresses:
        raise ProbeDNSError(f"DNS: no se pudo resolver {host}")
    if not all(_is_public(a) for a in addresses):
        raise ProbeRefused("El destino resuelve a una dirección interna o reservada.")
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    return host, port, path, addresses[0]


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(
        self, host: str, port: int, pinned_ip: str, timeout: float, context: ssl.SSLContext
    ):
        super().__init__(host, port, timeout=timeout, context=context)
        self._pinned_ip = pinned_ip
        self._ssl_context = context

    def connect(self) -> None:
        sock = socket.create_connection((self._pinned_ip, self.port), timeout=self.timeout)
        self.sock = self._ssl_context.wrap_socket(sock, server_hostname=self.host)


def probe(url: str, *, timeout: float, resolver: Resolver = system_resolver) -> ProbeResult:
    """Perform one GET. Raises ProbeRefused for disallowed targets; network errors are
    reported in the result (ok_connection=False)."""
    try:
        host, port, path, ip = resolve_target(url, resolver)
    except ProbeDNSError as exc:
        return ProbeResult(False, None, None, str(exc)[:255])
    context = ssl.create_default_context()
    conn = _PinnedHTTPSConnection(host, port, ip, timeout, context)
    start = time.monotonic()
    try:
        conn.request(
            "GET", path, headers={"User-Agent": USER_AGENT, "Accept": "*/*", "Connection": "close"}
        )
        response = conn.getresponse()
        response.read(MAX_BODY_BYTES)  # bounded read; redirects are NOT followed
        elapsed = int((time.monotonic() - start) * 1000)
        return ProbeResult(True, response.status, elapsed)
    except ssl.SSLError as exc:
        return ProbeResult(False, None, None, f"TLS: {exc.reason or exc.__class__.__name__}"[:255])
    except TimeoutError:
        return ProbeResult(False, None, None, f"Tiempo de espera agotado ({timeout:g} s)")
    except OSError as exc:
        return ProbeResult(False, None, None, f"Conexión fallida: {exc.__class__.__name__}"[:255])
    except http.client.HTTPException as exc:
        return ProbeResult(
            False, None, None, f"Respuesta HTTP inválida: {exc.__class__.__name__}"[:255]
        )
    finally:
        conn.close()
