"""Replace API key material in errors and logs."""

from __future__ import annotations

import re

MASK = "••••"

_REPLACEMENTS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r"((?:authorization|x-goog-api-key|api[-_ ]?key|access[-_ ]?token)\s*[:=]\s*[\"']?(?:bearer\s+)?)([A-Za-z0-9._~+/=-]{8,})",
            re.IGNORECASE,
        ),
        r"\1[redacted]",
    ),
    (re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{8,}", re.IGNORECASE), "Bearer [redacted]"),
    (re.compile(r"\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}"), "[redacted]"),
    (re.compile(r"\bnvapi-[A-Za-z0-9_-]{8,}", re.IGNORECASE), "[redacted]"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{10,}"), "[redacted]"),
    (re.compile(r"([?&](?:key|api_key|apiKey|access_token|token)=)[^&\s\"'#]+", re.IGNORECASE), r"\1[redacted]"),
    (
        re.compile(
            r"([\"'](?:api_key|apiKey|access_token|authorization|x-goog-api-key)[\"']\s*:\s*[\"'])[^\"']+([\"'])",
            re.IGNORECASE,
        ),
        r"\1[redacted]\2",
    ),
]


def redact_secrets(value: str) -> str:
    """Replace key material with `[redacted]`. Safe to call more than once."""
    text = value
    for pattern, replacement in _REPLACEMENTS:
        text = pattern.sub(replacement, text)
    return text


def looks_like_secret(value: str) -> bool:
    """True when a string looks like key material rather than a model id."""
    text = value.strip()
    if not text:
        return False
    if re.match(r"^(?:sk|rk|pk)-", text, re.IGNORECASE):
        return True
    if re.match(r"^nvapi-", text, re.IGNORECASE):
        return True
    if text.startswith("AIza"):
        return True
    if re.match(r"^Bearer\s+\S+", text, re.IGNORECASE):
        return True
    if len(text) >= 32 and re.fullmatch(r"[A-Za-z0-9+/=_-]+", text):
        return True
    return False


def mask_key_hint(value: str) -> str:
    """Last 4 characters, prefixed with the mask. A shorter value produces ''."""
    trimmed = value.strip()
    if not trimmed:
        return ""
    stripped = trimmed[len(MASK) :] if trimmed.startswith(MASK) else trimmed
    tail = stripped[-4:]
    if len(tail) < 4:
        return ""
    return f"{MASK}{tail}"
