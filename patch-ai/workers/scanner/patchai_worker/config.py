from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def _bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    database_url: str
    worker_id: str
    # "docker": every tool runs in a throwaway container (production).
    # "local": tools run as host processes; code scans are wrapped in `unshare -rn`
    #          (no network namespace) when available. For development and CI only.
    sandbox: str
    scanner_image: str
    zap_image: str
    egress_network: str
    work_dir: Path
    vulndb_dir: Path
    rules_dir: Path
    kinds: tuple[str, ...]
    poll_interval: float
    tool_timeout: int
    web_scan_timeout: int
    max_source_bytes: int
    max_files: int
    ai_gateway_url: str
    ai_gateway_key: str | None
    ai_model: str
    triage_max_findings: int
    github_app_id: str | None
    github_private_key: str | None
    kill_switch_env: bool
    allow_private_targets: bool
    web_rate_limit: int
    scanner_user_agent: str
    retention_interval: int
    vulndb_refresh_hours: int
    extra: dict = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> Config:
        key = os.environ.get("GITHUB_APP_PRIVATE_KEY")
        return cls(
            database_url=os.environ["DATABASE_URL"],
            worker_id=os.environ.get("WORKER_ID", socket.gethostname()),
            sandbox=os.environ.get("SANDBOX_MODE", "docker"),
            scanner_image=os.environ.get("SCANNER_IMAGE", "patchai/scanner-tools:latest"),
            zap_image=os.environ.get("ZAP_IMAGE", "ghcr.io/zaproxy/zaproxy:stable"),
            egress_network=os.environ.get("EGRESS_NETWORK", "patchai-egress"),
            work_dir=Path(os.environ.get("WORK_DIR", "/tmp/patchai-work")),
            vulndb_dir=Path(os.environ.get("VULNDB_DIR", "/var/lib/patchai/vulndb")),
            rules_dir=Path(os.environ.get("RULES_DIR", str(PACKAGE_ROOT / "rules"))),
            kinds=tuple(k.strip() for k in os.environ.get("WORKER_KINDS", "code,web").split(",") if k.strip()),
            poll_interval=float(os.environ.get("POLL_INTERVAL", "3")),
            tool_timeout=int(os.environ.get("TOOL_TIMEOUT", "600")),
            web_scan_timeout=int(os.environ.get("WEB_SCAN_TIMEOUT", "1800")),
            max_source_bytes=int(os.environ.get("MAX_SOURCE_BYTES", str(500 * 1024 * 1024))),
            max_files=int(os.environ.get("MAX_FILES", "50000")),
            ai_gateway_url=os.environ.get("AI_GATEWAY_URL", "https://ai-gateway.vercel.sh/v1"),
            ai_gateway_key=os.environ.get("AI_GATEWAY_API_KEY") or None,
            ai_model=os.environ.get("AI_GATEWAY_MODEL", "anthropic/claude-haiku-5.5"),
            triage_max_findings=int(os.environ.get("TRIAGE_MAX_FINDINGS", "40")),
            github_app_id=os.environ.get("GITHUB_APP_ID") or None,
            github_private_key=key.replace("\\n", "\n") if key else None,
            kill_switch_env=_bool("PATCHAI_KILL_SWITCH"),
            allow_private_targets=_bool("ALLOW_PRIVATE_TARGETS"),
            web_rate_limit=int(os.environ.get("WEB_RATE_LIMIT", "10")),
            scanner_user_agent=os.environ.get(
                "SCANNER_USER_AGENT", "PatchAI-Scanner/1.0 (+https://patch.ai/security)"
            ),
            retention_interval=int(os.environ.get("RETENTION_INTERVAL", "3600")),
            vulndb_refresh_hours=int(os.environ.get("VULNDB_REFRESH_HOURS", "12")),
        )
