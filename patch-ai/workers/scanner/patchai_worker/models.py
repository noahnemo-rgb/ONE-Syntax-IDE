from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

SEVERITIES = ("critical", "high", "medium", "low", "info")
SEVERITY_RANK = {s: i for i, s in enumerate(reversed(SEVERITIES))}  # info=0 ... critical=4


def max_severity(a: str, b: str) -> str:
    return a if SEVERITY_RANK[a] >= SEVERITY_RANK[b] else b


def downgrade(severity: str) -> str:
    idx = SEVERITIES.index(severity)
    return SEVERITIES[min(idx + 1, len(SEVERITIES) - 1)]


@dataclass
class Finding:
    tool: str
    rule_id: str
    title: str
    severity: str
    category: str  # sast | dependency | secret | iac | web
    description: str | None = None
    cwe: str | None = None
    file_path: str | None = None
    start_line: int | None = None
    end_line: int | None = None
    url: str | None = None
    evidence: str | None = None
    package_name: str | None = None
    installed_version: str | None = None
    fixed_version: str | None = None
    tools: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.severity not in SEVERITIES:
            raise ValueError(f"unknown severity {self.severity!r}")
        if not self.tools:
            self.tools = [self.tool]

    def dedupe_key(self) -> tuple:
        if self.category == "dependency":
            return ("dependency", (self.package_name or "").lower(), self.installed_version or "")
        if self.category == "web":
            return ("web", self.rule_id if not self.cwe else self.cwe, self.url or "")
        if self.category == "sast" and self.cwe:
            return ("sast", self.file_path or "", self.start_line or 0, self.cwe)
        if self.category == "secret":
            return ("secret", self.file_path or "", self.start_line or 0)
        return (self.category, self.tool, self.rule_id, self.file_path or "", self.start_line or 0)

    @property
    def fingerprint(self) -> str:
        raw = "|".join(str(p) for p in self.dedupe_key())
        return hashlib.sha256(raw.encode()).hexdigest()[:32]
