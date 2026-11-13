"""Code scans: fetch source, run the static tools in a no-network sandbox, normalize results."""

from __future__ import annotations

import os
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from . import normalize
from .config import Config
from .models import Finding
from .sandbox import Mounts, Sandbox, ToolResult
from .vulndb import osv_dir, trivy_dir


@dataclass(frozen=True)
class Tool:
    name: str
    argv: tuple[str, ...]
    output: str
    parser: Callable[..., list[Finding]]
    ok_exit_codes: tuple[int, ...] = (0,)
    env: tuple[tuple[str, str], ...] = ()


TOOLS: tuple[Tool, ...] = (
    Tool(
        "opengrep",
        ("opengrep", "scan", "--config", "{rules}/patchai", "--json", "--json-output={out}/opengrep.json",
         "--no-git-ignore", "--timeout", "30", "--max-target-bytes", "1000000", "--quiet", "{src}"),
        "opengrep.json",
        normalize.parse_opengrep,
        ok_exit_codes=(0, 1),
    ),
    Tool(
        "bandit",
        ("bandit", "-r", "{src}", "-f", "json", "-o", "{out}/bandit.json", "-q", "--exit-zero"),
        "bandit.json",
        normalize.parse_bandit,
    ),
    Tool(
        "gitleaks",
        ("gitleaks", "dir", "{src}", "--report-format", "json", "--report-path", "{out}/gitleaks.json",
         "--redact", "--no-banner", "--exit-code", "0"),
        "gitleaks.json",
        normalize.parse_gitleaks,
    ),
    Tool(
        "osv-scanner",
        ("osv-scanner", "scan", "source", "-r", "--format", "json", "--output-file", "{out}/osv.json",
         "--offline-vulnerabilities", "{src}"),
        "osv.json",
        normalize.parse_osv,
        # 1 = vulnerabilities found, 128 = no package sources found
        ok_exit_codes=(0, 1, 128),
        env=(("OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY", "{vulndb}/osv"),),
    ),
    Tool(
        "trivy",
        ("trivy", "fs", "--cache-dir", "{vulndb}/trivy", "--cache-backend", "memory", "--skip-db-update",
         "--skip-check-update", "--offline-scan", "--scanners", "vuln,misconfig", "--format", "json",
         "--output", "{out}/trivy.json", "--quiet", "{src}"),
        "trivy.json",
        normalize.parse_trivy,
    ),
)


@dataclass
class CodeScanResult:
    findings: list[Finding]
    tool_errors: dict[str, str]


def run_code_tools(
    config: Config,
    sandbox: Sandbox,
    src: Path,
    out: Path,
    *,
    should_stop: Callable[[], bool],
    log: Callable[[str], None],
    tools: tuple[Tool, ...] = TOOLS,
) -> CodeScanResult:
    out.mkdir(parents=True, exist_ok=True)
    # Containers run as an unprivileged user and must be able to write results.
    os.chmod(out, 0o777)
    mounts = Mounts(src=src, out=out, vulndb=config.vulndb_dir, rules=config.rules_dir)
    paths = sandbox.paths(mounts)
    root = "/src" if config.sandbox == "docker" else str(src)

    if not (osv_dir(config.vulndb_dir).exists() and trivy_dir(config.vulndb_dir).exists()):
        log("warning: vulnerability databases are missing; dependency results may be incomplete")

    findings: list[Finding] = []
    errors: dict[str, str] = {}
    for tool in tools:
        env = {k: v.format(**paths) for k, v in tool.env}
        env.setdefault("HOME", "/tmp")
        result: ToolResult = sandbox.run(
            tool.name, tool.argv, mounts, network="none", env=env, should_stop=should_stop, log=log
        )
        output = out / tool.output
        if result.exit_code not in tool.ok_exit_codes or not output.exists():
            errors[tool.name] = f"exit {result.exit_code}: {result.stderr_tail[-500:]}"
            log(f"[{tool.name}] failed; continuing with the other tools")
            continue
        try:
            data = normalize.load_json(str(output))
            parsed = tool.parser(data, root) if data is not None else []
        except Exception as exc:  # a parser bug must not lose the other tools' results
            errors[tool.name] = f"could not parse output: {exc}"
            continue
        log(f"[{tool.name}] {len(parsed)} raw findings")
        findings.extend(parsed)

    merged = normalize.merge_findings(findings)
    log(f"{len(merged)} findings after de-duplication")
    return CodeScanResult(merged, errors)


def cleanup(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
