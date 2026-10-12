"""Centralized API error handling.

Every error response has the shape::

    {"code": "validation_error", "detail": "Human readable message", "fields": {...}}

`fields` is only present for validation errors and maps field -> list of messages.
"""

import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


class DomainError(Exception):
    """Raised by the service layer when a business rule is violated."""

    def __init__(self, message: str, code: str = "business_rule", field: str | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.field = field


def _flatten_codes(codes) -> str:
    if isinstance(codes, str):
        return codes
    if isinstance(codes, list) and codes:
        return _flatten_codes(codes[0])
    if isinstance(codes, dict) and codes:
        return _flatten_codes(next(iter(codes.values())))
    return "error"


def api_exception_handler(exc, context):
    if isinstance(exc, DomainError):
        body = {"code": exc.code, "detail": exc.message}
        if exc.field:
            body["fields"] = {exc.field: [exc.message]}
        return Response(body, status=status.HTTP_400_BAD_REQUEST)

    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(
            exc.message_dict if hasattr(exc, "error_dict") else {"non_field_errors": exc.messages}
        )
    elif isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled API error", exc_info=exc)
        return Response(
            {"code": "server_error", "detail": "Error interno del servidor."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    if isinstance(exc, exceptions.ValidationError):
        data = response.data
        fields = data if isinstance(data, dict) else {"non_field_errors": data}
        non_field = fields.get("non_field_errors")
        detail = str(non_field[0]) if non_field else "Los datos enviados no son válidos."
        response.data = {"code": "validation_error", "detail": detail, "fields": fields}
        return response

    detail = response.data.get("detail") if isinstance(response.data, dict) else response.data
    response.data = {"code": _flatten_codes(exc.get_codes()), "detail": str(detail)}
    return response
