"""Load ai-buffer's redact_secrets and apply it to provider error text.

The installed package file is preferred. backend/vendor/ai_buffer_redact.py is the
same module from ai-buffer v0.4.0, used when node_modules is not present.
"""

from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from typing import Callable

_BACKEND = Path(__file__).resolve().parent
PACKAGE_REDACT = (
    _BACKEND.parent / "frontend" / "node_modules" / "ai-buffer" / "python" / "ai_buffer" / "redact.py"
)
VENDOR_REDACT = _BACKEND / "vendor" / "ai_buffer_redact.py"


def load_redact_secrets(path: Path | None = None) -> Callable[[str], str]:
    candidates = (path,) if path is not None else (PACKAGE_REDACT, VENDOR_REDACT)
    for candidate in candidates:
        if candidate is None or not candidate.is_file():
            continue
        spec = spec_from_file_location(f"ai_buffer_redact_{candidate.stem}", candidate)
        if spec is None or spec.loader is None:
            continue
        module = module_from_spec(spec)
        spec.loader.exec_module(module)
        fn = getattr(module, "redact_secrets", None)
        if callable(fn):
            return fn
    raise ImportError("ai-buffer redact_secrets was not found")


redact_secrets = load_redact_secrets()


def redact_provider_text(value: str, limit: int = 500) -> str:
    """Redact the whole string, then keep the first `limit` characters."""
    return redact_secrets(str(value))[:limit]
