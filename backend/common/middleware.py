"""Request correlation ID: propagated from X-Request-ID or generated per request."""

import logging
import re
import threading
import uuid

_local = threading.local()
_VALID_ID = re.compile(r"^[A-Za-z0-9\-_.]{8,64}$")


def get_request_id() -> str:
    return getattr(_local, "request_id", "-")


class RequestIDMiddleware:
    header = "HTTP_X_REQUEST_ID"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.META.get(self.header, "")
        request_id = incoming if _VALID_ID.match(incoming) else uuid.uuid4().hex
        request.request_id = request_id
        _local.request_id = request_id
        try:
            response = self.get_response(request)
        finally:
            _local.request_id = "-"
        response["X-Request-ID"] = request_id
        return response


class RequestIDLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True
