"""Reference WSGI middleware that protects a demo application with DevHub demo tickets.

Flow
----
1. A client clicks "Abrir demo" in the DevHub portal. DevHub checks the client is
   authorized and redirects to ``https://demo.example.com/...?devhub_demo_token=<ticket>``.
2. This middleware redeems the ticket server-to-server against DevHub
   (``POST /api/v1/integrations/demo-access/redeem/`` with a service token scoped to the
   project). Tickets are single-use and expire in minutes.
3. On success it sets a short-lived, HMAC-signed, HttpOnly session cookie and redirects to
   the same URL without the ticket. Every other request needs a valid cookie; otherwise it
   answers 403. Logging into DevHub alone never grants access to the demo.

Configuration (environment variables)
-------------------------------------
DEVHUB_URL            Base URL of DevHub (e.g. https://devhub.example.com)
DEVHUB_TOKEN          Service token (dhs_...) scoped to the demo's project
DEMO_SESSION_SECRET   Random secret (>= 32 chars) used to sign the session cookie
DEMO_COOKIE_SECURE    "true" (default) to mark the cookie Secure; "false" only for local tests
DEVHUB_PORTAL_URL     Optional link shown on the 403 page

Usage::

    from devhub_demo_guard import DemoGuard
    application = DemoGuard(your_wsgi_app)

Run ``python devhub_demo_guard.py`` to serve a sample protected app on 127.0.0.1:8765.
Only the Python standard library is used.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import os
import time
import urllib.error
import urllib.request
from http.cookies import SimpleCookie
from urllib.parse import parse_qsl, urlencode

TICKET_PARAM = "devhub_demo_token"
COOKIE_NAME = "devhub_demo_session"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class DemoGuard:
    def __init__(self, app, *, devhub_url=None, service_token=None, secret=None, secure_cookie=None,
                 portal_url=None, timeout=5.0):
        self.app = app
        self.devhub_url = (devhub_url or os.environ["DEVHUB_URL"]).rstrip("/")
        self.service_token = service_token or os.environ["DEVHUB_TOKEN"]
        secret = secret or os.environ["DEMO_SESSION_SECRET"]
        if len(secret) < 32:
            raise ValueError("DEMO_SESSION_SECRET must be at least 32 characters")
        self.secret = secret.encode()
        if secure_cookie is None:
            secure_cookie = os.environ.get("DEMO_COOKIE_SECURE", "true").lower() != "false"
        self.secure_cookie = secure_cookie
        self.portal_url = portal_url or os.environ.get("DEVHUB_PORTAL_URL", "")
        self.timeout = timeout

    # --- session cookie ----------------------------------------------------------------
    def _sign(self, payload: dict) -> str:
        body = _b64(json.dumps(payload, separators=(",", ":")).encode())
        sig = _b64(hmac.new(self.secret, body.encode(), hashlib.sha256).digest())
        return f"{body}.{sig}"

    def _verify(self, value: str) -> dict | None:
        try:
            body, sig = value.split(".", 1)
            expected = _b64(hmac.new(self.secret, body.encode(), hashlib.sha256).digest())
            if not hmac.compare_digest(sig, expected):
                return None
            payload = json.loads(_unb64(body))
        except (ValueError, json.JSONDecodeError):
            return None
        return payload if payload.get("exp", 0) > time.time() else None

    # --- DevHub ------------------------------------------------------------------------
    def _redeem(self, ticket: str) -> dict | None:
        req = urllib.request.Request(
            f"{self.devhub_url}/api/v1/integrations/demo-access/redeem/",
            data=json.dumps({"token": ticket}).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.service_token}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:  # noqa: S310 - configured URL
                data = json.loads(res.read().decode("utf-8"))
                return data if data.get("valid") else None
        except urllib.error.HTTPError:
            return None  # 401/403/4xx: invalid, expired, reused or out of scope

    # --- WSGI --------------------------------------------------------------------------
    def __call__(self, environ, start_response):
        query = parse_qsl(environ.get("QUERY_STRING", ""), keep_blank_values=True)
        ticket = next((v for k, v in query if k == TICKET_PARAM), None)
        if ticket is not None:
            try:
                info = self._redeem(ticket)
            except (urllib.error.URLError, TimeoutError):
                return self._page(start_response, "503 Service Unavailable",
                                  "No se pudo verificar el acceso con DevHub. Intenta de nuevo.")
            if info is None:
                return self._denied(start_response)
            exp = min(time.time() + 8 * 3600, _parse_ts(info.get("session_expires_at")) or time.time() + 3600)
            cookie = SimpleCookie()
            cookie[COOKIE_NAME] = self._sign({"email": info["user"]["email"], "org": info.get("organization"), "exp": exp})
            morsel = cookie[COOKIE_NAME]
            morsel["path"] = "/"
            morsel["httponly"] = True
            morsel["samesite"] = "Lax"
            morsel["max-age"] = str(int(exp - time.time()))
            if self.secure_cookie:
                morsel["secure"] = True
            clean = urlencode([(k, v) for k, v in query if k != TICKET_PARAM])
            location = environ.get("PATH_INFO", "/") + (f"?{clean}" if clean else "")
            start_response("303 See Other", [
                ("Location", location),
                ("Set-Cookie", morsel.OutputString()),
                ("Cache-Control", "no-store"),
                ("Referrer-Policy", "no-referrer"),
            ])
            return [b""]

        cookies = SimpleCookie(environ.get("HTTP_COOKIE", ""))
        session = self._verify(cookies[COOKIE_NAME].value) if COOKIE_NAME in cookies else None
        if session is None:
            return self._denied(start_response)
        environ["devhub.demo_user"] = session["email"]
        environ["devhub.demo_organization"] = session.get("org")
        return self.app(environ, start_response)

    def _denied(self, start_response):
        link = f' <a href="{html.escape(self.portal_url)}">Ir al portal</a>' if self.portal_url else ""
        return self._page(start_response, "403 Forbidden",
                          f"Abre esta demostración desde el portal de clientes de DevHub.{link}")

    @staticmethod
    def _page(start_response, status, message):
        body = (f"<!doctype html><meta charset=utf-8><title>Acceso restringido</title>"
                f"<p style='font-family:sans-serif'>{message}</p>").encode()
        start_response(status, [("Content-Type", "text/html; charset=utf-8"), ("Cache-Control", "no-store")])
        return [body]


def _parse_ts(value: str | None) -> float | None:
    if not value:
        return None
    from datetime import datetime

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


if __name__ == "__main__":  # pragma: no cover - local demo server
    from wsgiref.simple_server import make_server

    def sample_app(environ, start_response):
        user = html.escape(environ.get("devhub.demo_user", ""))
        start_response("200 OK", [("Content-Type", "text/html; charset=utf-8")])
        return [f"<h1>Demo protegida</h1><p>Sesión de demo para {user}</p>".encode()]

    port = int(os.environ.get("PORT", "8765"))
    print(f"Demo protegida en http://127.0.0.1:{port}")
    make_server("127.0.0.1", port, DemoGuard(sample_app)).serve_forever()
