"""Removes secrets from arbitrary data before it is persisted in audit/trace logs."""

import re
from typing import Any

REDACTED = "[REDACTED]"
_SENSITIVE_KEY = re.compile(
    r"pass(word)?|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|"
    r"credential|session[_-]?(id|key)|dsn|connection[_-]?string|database[_-]?url",
    re.IGNORECASE,
)
# Values that look like secrets even under innocent keys.
_SENSITIVE_VALUE = re.compile(
    r"(postgres(ql)?|mysql|redis|mongodb)://\S+|bearer\s+\S+|gh[pousr]_[A-Za-z0-9]{20,}",
    re.IGNORECASE,
)
_MAX_DEPTH = 6
_MAX_STRING = 2000


def sanitize(value: Any, _depth: int = 0) -> Any:
    if _depth > _MAX_DEPTH:
        return "[TRUNCATED]"
    if isinstance(value, dict):
        return {
            str(k): REDACTED if _SENSITIVE_KEY.search(str(k)) else sanitize(v, _depth + 1)
            for k, v in value.items()
        }
    if isinstance(value, list | tuple | set):
        return [sanitize(v, _depth + 1) for v in value]
    if isinstance(value, str):
        if _SENSITIVE_VALUE.search(value):
            return REDACTED
        return value[:_MAX_STRING]
    if value is None or isinstance(value, bool | int | float):
        return value
    return str(value)[:_MAX_STRING]
