"""Converts each tool's native output into Finding objects and merges duplicates."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from typing import Any

from .models import SEVERITIES, Finding, downgrade, max_severity

SANDBOX_ROOT = "/src"
MAX_EVIDENCE = 2000


def _rel(path: str | None, root: str = SANDBOX_ROOT) -> str | None:
    if not path:
        return None
    for prefix in (root.rstrip("/") + "/", "./"):
        if path.startswith(prefix):
            return path[len(prefix) :]
    return path.lstrip("/")


def _clip(text: str | None, limit: int = MAX_EVIDENCE) -> str | None:
    if text is None:
        return None
    return text if len(text) <= limit else text[:limit] + "\n…"


def _cwe(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, list):
        value = value[0] if value else None
        if value is None:
            return None
    if isinstance(value, dict):
        value = value.get("id")
    match = re.search(r"(\d+)", str(value))
    return f"CWE-{match.group(1)}" if match else None


# ---------------------------------------------------------------------------
# Opengrep (in-house rules)
# ---------------------------------------------------------------------------

_OPENGREP_SEVERITY = {"ERROR": "high", "WARNING": "medium", "INFO": "low"}
_RULE_ID = re.compile(r"(patchai\.(?:python|js|go|java)\..+)$")


def parse_opengrep(data: dict, root: str = SANDBOX_ROOT) -> list[Finding]:
    out: list[Finding] = []
    for r in data.get("results", []):
        extra = r.get("extra", {})
        meta = extra.get("metadata", {}) or {}
        match = _RULE_ID.search(r.get("check_id", ""))
        rule_id = match.group(1) if match else r.get("check_id", "unknown")
        severity = _OPENGREP_SEVERITY.get(extra.get("severity", "WARNING"), "medium")
        if str(meta.get("confidence", "")).upper() == "LOW":
            severity = downgrade(severity)
        message = extra.get("message", "")
        out.append(
            Finding(
                tool="opengrep",
                rule_id=rule_id,
                title=_title_from_rule(rule_id),
                description=message,
                severity=severity,
                category="sast",
                cwe=_cwe(meta.get("cwe")),
                file_path=_rel(r.get("path"), root),
                start_line=r.get("start", {}).get("line"),
                end_line=r.get("end", {}).get("line"),
                evidence=_clip(extra.get("lines")) if extra.get("lines") not in (None, "requires login") else None,
            )
        )
    return out


_TOPIC_TITLES = {
    "sql-injection": "SQL injection",
    "command-injection": "Command injection",
    "code-injection": "Code injection",
    "deserialization": "Unsafe deserialization",
    "crypto": "Weak cryptography",
    "flask": "Flask misconfiguration",
    "tls": "TLS verification disabled",
    "ssrf": "Server-side request forgery (SSRF)",
    "path-traversal": "Path traversal",
    "xss": "Cross-site scripting (XSS)",
    "jwt": "JWT verification weakness",
    "cors": "Permissive CORS policy",
    "xxe": "XML external entity (XXE) injection",
}


def _title_from_rule(rule_id: str) -> str:
    parts = rule_id.split(".")
    topic = parts[2] if len(parts) > 2 else rule_id
    detail = parts[3].replace("-", " ") if len(parts) > 3 else ""
    title = _TOPIC_TITLES.get(topic, topic.replace("-", " ").capitalize())
    return f"{title} ({detail})" if detail else title


# ---------------------------------------------------------------------------
# Bandit
# ---------------------------------------------------------------------------

# Hardcoded-password tests echo the secret in both the code and the message.
_BANDIT_SECRET_TESTS = {"B105", "B106", "B107"}
# Align Bandit's CWE choice with the in-house rules so the same issue merges.
_BANDIT_CWE_OVERRIDES = {"B506": "CWE-502", "B201": "CWE-489", "B608": "CWE-89"}


def parse_bandit(data: dict, root: str = SANDBOX_ROOT) -> list[Finding]:
    out: list[Finding] = []
    for r in data.get("results", []):
        test_id = r.get("test_id", "")
        if test_id.startswith("B4"):  # import-only warnings; the call sites are reported separately
            continue
        severity = {"HIGH": "high", "MEDIUM": "medium", "LOW": "low"}.get(r.get("issue_severity"), "low")
        if r.get("issue_confidence") == "LOW":
            severity = downgrade(severity)
        is_secret = test_id in _BANDIT_SECRET_TESTS
        out.append(
            Finding(
                tool="bandit",
                rule_id=f"bandit.{test_id}",
                title=r.get("test_name", test_id).replace("_", " ").capitalize(),
                description="Possible hardcoded credential. The value is withheld from this report."
                if is_secret
                else r.get("issue_text"),
                severity=severity,
                category="secret" if is_secret else "sast",
                cwe=_BANDIT_CWE_OVERRIDES.get(test_id) or _cwe(r.get("issue_cwe")),
                file_path=_rel(r.get("filename"), root),
                start_line=r.get("line_number"),
                end_line=(r.get("line_range") or [None])[-1],
                evidence=None if is_secret else _clip(r.get("code")),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Gitleaks (run with --redact)
# ---------------------------------------------------------------------------

_CRITICAL_SECRET_HINTS = ("private-key", "aws", "gcp", "azure", "stripe", "github", "gitlab", "slack")


def parse_gitleaks(data: list, root: str = SANDBOX_ROOT) -> list[Finding]:
    out: list[Finding] = []
    for r in data or []:
        rule = r.get("RuleID", "secret")
        severity = "critical" if any(h in rule.lower() for h in _CRITICAL_SECRET_HINTS) else "high"
        out.append(
            Finding(
                tool="gitleaks",
                rule_id=f"gitleaks.{rule}",
                title=f"Leaked secret: {rule.replace('-', ' ')}",
                description=(r.get("Description") or "A credential appears to be committed to source code.")
                + " Rotate it immediately, then remove it from the code and git history.",
                severity=severity,
                category="secret",
                cwe="CWE-798",
                file_path=_rel(r.get("File"), root),
                start_line=r.get("StartLine"),
                end_line=r.get("EndLine"),
                evidence="[redacted]",
            )
        )
    return out


# ---------------------------------------------------------------------------
# Dependency scanners
# ---------------------------------------------------------------------------


def _cvss_to_severity(score: float | None) -> str | None:
    if score is None:
        return None
    if score >= 9.0:
        return "critical"
    if score >= 7.0:
        return "high"
    if score >= 4.0:
        return "medium"
    if score > 0:
        return "low"
    return "info"


def _version_key(v: str) -> tuple:
    return tuple(int(p) if p.isdigit() else -1 for p in re.split(r"[.\-+]", v) if p)


def _is_prerelease(v: str) -> bool:
    return bool(re.search(r"[a-zA-Z]", v))


def _min_fix(installed: str | None, fixes: Iterable[str]) -> str | None:
    """Smallest stable fixed version newer than the installed one, for a single advisory."""
    candidates = sorted({f.strip() for f in fixes if f and f.strip()}, key=_version_key)
    candidates = [c for c in candidates if not _is_prerelease(c)] or candidates
    if installed:
        candidates = [c for c in candidates if _version_key(c) > _version_key(installed)]
    return candidates[0] if candidates else None


def _best_fix(installed: str | None, per_advisory_fixes: Iterable[Iterable[str]]) -> str | None:
    """The smallest upgrade that clears every advisory: the highest of each advisory's minimal fix."""
    minima = [m for fixes in per_advisory_fixes if (m := _min_fix(installed, fixes))]
    return max(minima, key=_version_key) if minima else None


def parse_osv(data: dict, root: str = SANDBOX_ROOT) -> list[Finding]:
    out: list[Finding] = []
    for result in data.get("results", []):
        source = _rel(result.get("source", {}).get("path"), root)
        for pkg in result.get("packages", []):
            info = pkg.get("package", {})
            name, version = info.get("name"), info.get("version")
            vulns = pkg.get("vulnerabilities", [])
            groups = pkg.get("groups", []) or [{"ids": [v["id"]]} for v in vulns]
            if not groups:
                continue
            severity = "low"
            for g in groups:
                try:
                    score = float(g.get("max_severity") or 0) or None
                except ValueError:
                    score = None
                sev = _cvss_to_severity(score)
                if sev is None:
                    sev = "medium"
                severity = max_severity(severity, sev)
            fixes: list[list[str]] = []
            cwes: list[str] = []
            lines: list[str] = []
            for v in vulns:
                advisory_fixes: list[str] = []
                for aff in v.get("affected", []):
                    if (aff.get("package", {}).get("name") or "").lower() != (name or "").lower():
                        continue
                    for rng in aff.get("ranges", []):
                        for ev in rng.get("events", []):
                            if "fixed" in ev:
                                advisory_fixes.append(ev["fixed"])
                fixes.append(advisory_fixes)
                cwes.extend(v.get("database_specific", {}).get("cwe_ids", []) or [])
                ids = [v["id"], *[a for a in v.get("aliases", []) if a.startswith("CVE-")]]
                lines.append(f"{', '.join(dict.fromkeys(ids))}: {v.get('summary') or v.get('details', '')[:120]}")
            fixed = _best_fix(version, fixes)
            count = len(groups)
            out.append(
                Finding(
                    tool="osv-scanner",
                    rule_id=f"dependency.{info.get('ecosystem', 'pkg').lower()}.{name}",
                    title=f"{name} {version} has {count} known {'vulnerability' if count == 1 else 'vulnerabilities'}",
                    description=(
                        f"{name} {version} ({info.get('ecosystem')}) declared in {source} is affected by {count} "
                        f"published advisories."
                        + (f" Upgrade to {fixed} or later." if fixed else " No fixed version is published yet.")
                    ),
                    severity=severity,
                    category="dependency",
                    cwe=_cwe(cwes[0]) if cwes else None,
                    file_path=source,
                    evidence=_clip("\n".join(lines[:15])),
                    package_name=name,
                    installed_version=version,
                    fixed_version=fixed,
                )
            )
    return out


_TRIVY_SEVERITY = {"CRITICAL": "critical", "HIGH": "high", "MEDIUM": "medium", "LOW": "low", "UNKNOWN": "info"}


def parse_trivy(data: dict, root: str = SANDBOX_ROOT) -> list[Finding]:
    out: list[Finding] = []
    for result in data.get("Results", []) or []:
        target = _rel(result.get("Target"), root)
        by_pkg: dict[tuple[str, str], list[dict]] = {}
        for v in result.get("Vulnerabilities") or []:
            by_pkg.setdefault((v.get("PkgName", ""), v.get("InstalledVersion", "")), []).append(v)
        for (name, version), vulns in by_pkg.items():
            severity = "info"
            fixes: list[list[str]] = []
            lines: list[str] = []
            for v in vulns:
                severity = max_severity(severity, _TRIVY_SEVERITY.get(v.get("Severity", "UNKNOWN"), "info"))
                fixes.append([f.strip() for f in (v.get("FixedVersion") or "").split(",") if f.strip()])
                lines.append(f"{v.get('VulnerabilityID')}: {v.get('Title') or ''}".strip())
            fixed = _best_fix(version, fixes)
            count = len(vulns)
            cwe = next((c for v in vulns for c in (v.get("CweIDs") or [])), None)
            out.append(
                Finding(
                    tool="trivy",
                    rule_id=f"dependency.{(result.get('Type') or 'pkg').lower()}.{name}",
                    title=f"{name} {version} has {count} known {'vulnerability' if count == 1 else 'vulnerabilities'}",
                    description=f"{name} {version} declared in {target} is affected by {count} published advisories."
                    + (f" Upgrade to {fixed} or later." if fixed else ""),
                    severity=severity,
                    category="dependency",
                    cwe=_cwe(cwe),
                    file_path=target,
                    evidence=_clip("\n".join(lines[:15])),
                    package_name=name,
                    installed_version=version,
                    fixed_version=fixed,
                )
            )
        for m in result.get("Misconfigurations") or []:
            if m.get("Status") != "FAIL":
                continue
            cause = m.get("CauseMetadata", {}) or {}
            code_lines = [ln.get("Content", "") for ln in (cause.get("Code", {}) or {}).get("Lines") or []]
            out.append(
                Finding(
                    tool="trivy",
                    rule_id=f"trivy.{m.get('ID')}",
                    title=m.get("Title") or m.get("ID", "Misconfiguration"),
                    description=" ".join(filter(None, [m.get("Description"), m.get("Resolution")])),
                    severity=_TRIVY_SEVERITY.get(m.get("Severity", "UNKNOWN"), "info"),
                    category="iac",
                    file_path=target,
                    start_line=cause.get("StartLine"),
                    end_line=cause.get("EndLine"),
                    url=m.get("PrimaryURL"),
                    evidence=_clip("\n".join(code_lines)) or None,
                )
            )
    return out


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

_TOOL_PREFERENCE = ["opengrep", "gitleaks", "osv-scanner", "trivy", "bandit", "zap", "nuclei", "patchai-passive"]


def merge_findings(findings: Iterable[Finding]) -> list[Finding]:
    """Collapses the same issue reported by several tools into one finding with all tool names."""
    merged: dict[tuple, Finding] = {}
    for f in findings:
        key = f.dedupe_key()
        existing = merged.get(key)
        if existing is None:
            merged[key] = f
            continue
        primary, other = (
            (existing, f)
            if _TOOL_PREFERENCE.index(existing.tool) <= _TOOL_PREFERENCE.index(f.tool)
            else (f, existing)
        )
        primary.severity = max_severity(primary.severity, other.severity)
        primary.tools = sorted(set(primary.tools) | set(other.tools), key=_TOOL_PREFERENCE.index)
        fixes = [v for v in (primary.fixed_version, other.fixed_version) if v]
        primary.fixed_version = max(fixes, key=_version_key) if fixes else None
        primary.evidence = primary.evidence or other.evidence
        primary.cwe = primary.cwe or other.cwe
        merged[key] = primary
    return sorted(
        merged.values(),
        key=lambda f: (SEVERITIES.index(f.severity), f.category, f.file_path or "", f.start_line or 0),
    )


def summarize(findings: Iterable[Finding]) -> dict[str, int]:
    summary = {s: 0 for s in SEVERITIES}
    total = 0
    for f in findings:
        summary[f.severity] += 1
        total += 1
    summary["total"] = total
    return summary


def load_json(path: str) -> Any:
    with open(path, encoding="utf-8") as fh:
        text = fh.read().strip()
    return json.loads(text) if text else None
