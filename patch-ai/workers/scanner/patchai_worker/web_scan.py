"""Live-target scans.

Order of operations, each of which can stop the scan:
1. The target must still exist, be enabled, and have a signed attestation for
   the requested profile.
2. The hostname is resolved once and every address must be public. One address
   is pinned for the whole scan (no DNS rebinding).
3. The egress guard starts; it is the only exit for scanner traffic and only
   reaches the pinned address on ports 80/443.
4. Ownership is re-verified (DNS TXT, or the well-known file fetched through the
   guard). A failure clears the target's verification.
5. Passive checks, then Nuclei, then ZAP (baseline for passive, full scan for
   active) run under a shared deadline and the scan's stop signal.
"""

from __future__ import annotations

import ipaddress
import os
import socket
import time
from pathlib import Path
from typing import Any

import dns.exception
import dns.resolver
import httpx

from . import passive_checks
from .config import Config
from .db import Database
from .egress_guard import EgressGuard
from .models import Finding
from .normalize import load_json, merge_findings, parse_nuclei_jsonl, parse_zap
from .sandbox import Mounts, Sandbox

DNS_PREFIX = "_patchai-verify"
WELL_KNOWN_PATH = "/.well-known/patchai-verify.txt"

NUCLEI_EXCLUDED_ALWAYS = "dos,bruteforce,brute-force,default-login,fuzz,intrusive,oast"
NUCLEI_PASSIVE_TAGS = "misconfig,exposure,tech,ssl,headers,panel,config"


class TargetError(Exception):
    pass


def is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def resolve_and_pin(hostname: str, allow_private: bool = False) -> tuple[str, list[str]]:
    try:
        infos = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise TargetError(f"{hostname} does not resolve ({exc.strerror})") from exc
    addresses = sorted({info[4][0] for info in infos})
    if not addresses:
        raise TargetError(f"{hostname} does not resolve")
    blocked = [a for a in addresses if not is_public(a)]
    if blocked and not allow_private:
        raise TargetError(f"{hostname} resolves to a non-public address ({', '.join(blocked)}); refusing to scan")
    ipv4 = [a for a in addresses if ":" not in a]
    return (ipv4 or addresses)[0], addresses


def expected_value(token: str) -> str:
    return f"patchai-verify={token}"


def dns_verified(hostname: str, token: str) -> bool:
    try:
        answers = dns.resolver.resolve(f"{DNS_PREFIX}.{hostname}", "TXT", lifetime=10)
    except (dns.exception.DNSException, OSError):
        return False
    want = expected_value(token)
    return any(b"".join(r.strings).decode(errors="replace").strip() == want for r in answers)


def http_verified(base_url: str, token: str, proxy_url: str, user_agent: str) -> bool:
    try:
        with httpx.Client(proxy=proxy_url, timeout=10, follow_redirects=False,
                          headers={"user-agent": user_agent}) as client:
            res = client.get(base_url + WELL_KNOWN_PATH)
    except httpx.HTTPError:
        return False
    if res.status_code != 200 or len(res.content) > 4096:
        return False
    return expected_value(token) in (line.strip() for line in res.text.splitlines())


def nuclei_args(base_url: str, proxy_url: str, profile: str, config: Config) -> list[str]:
    args = [
        "nuclei", "-u", base_url,
        "-t", "{vulndb}/nuclei-templates/http",
        "-proxy", proxy_url,
        "-jsonl", "-o", "{out}/nuclei.jsonl",
        "-duc", "-ni", "-silent", "-nc",
        "-rl", str(config.web_rate_limit), "-c", "5", "-bs", "5",
        "-timeout", "10", "-retries", "1", "-mhe", "20",
        "-H", f"User-Agent: {config.scanner_user_agent}",
        "-etags", NUCLEI_EXCLUDED_ALWAYS,
        "-severity", "low,medium,high,critical",
    ]
    if profile == "passive":
        args += ["-tags", NUCLEI_PASSIVE_TAGS]
    return args


def zap_args(base_url: str, proxy_host: str, proxy_port: int, profile: str, config: Config) -> list[str]:
    script = "zap-full-scan.py" if profile == "active" else "zap-baseline.py"
    minutes = "5" if profile == "active" else "2"
    zap_options = " ".join([
        "-config connection.proxyChain.enabled=true",
        f"-config connection.proxyChain.hostName={proxy_host}",
        f"-config connection.proxyChain.port={proxy_port}",
        "-config connection.defaultUserAgent=PatchAI-Scanner/1.0",
        "-config scanner.threadPerHost=2",
        f"-config scanner.delayInMs={max(50, 1000 // max(1, config.web_rate_limit))}",
    ])
    return [script, "-t", base_url, "-J", "zap.json", "-m", minutes, "-I", "-z", zap_options]


def run(ctx: Any, db: Database, config: Config, sandbox: Sandbox, workdir: Path) -> tuple[list[Finding], set[str]]:
    scan = ctx.scan
    deadline = time.monotonic() + config.web_scan_timeout
    target = db.get_target(str(scan["target_id"]))
    if not target:
        raise TargetError("target not found")
    if target["disabled"]:
        raise TargetError("this target has been disabled")
    profile = scan.get("profile") or "passive"
    if not db.latest_attestation(str(target["id"]), profile):
        raise TargetError(f"no signed attestation for {profile} scanning")
    hostname = target["hostname"]

    # Development only: lets the smoke test scan a local plain-HTTP app.
    dev_http = config.allow_private_targets and os.environ.get("DEV_TARGET_SCHEME") == "http"
    scheme = "http" if dev_http else "https"
    base_url = f"{scheme}://{hostname}"

    pinned, addresses = resolve_and_pin(hostname, config.allow_private_targets)
    ctx.log(f"{hostname} resolves to {', '.join(addresses)}; pinned {pinned} for this scan")

    bind = os.environ.get("EGRESS_PROXY_BIND") if config.sandbox == "docker" else "127.0.0.1"
    findings: list[Finding] = []
    errors: set[str] = set()
    out = workdir / "out"
    out.mkdir(parents=True, exist_ok=True)
    out.chmod(0o777)

    with EgressGuard(
        hostname,
        pinned,
        bind_host=bind or "127.0.0.1",
        # Tools open roughly one proxy connection per request, so this enforces
        # the per-target request rate even if a tool ignores its own limit.
        connections_per_second=config.web_rate_limit,
        should_stop=lambda: ctx.should_stop() or time.monotonic() > deadline,
    ) as guard:
        ctx.log(f"egress guard listening on {guard.url}; only {hostname} ({pinned}) on ports 80/443 is reachable")

        if dns_verified(hostname, target["verification_token"]):
            ctx.log("ownership re-verified via DNS TXT record")
        elif http_verified(base_url, target["verification_token"], guard.url, config.scanner_user_agent):
            ctx.log("ownership re-verified via well-known file")
        else:
            db.mark_target_unverified(str(target["id"]))
            raise TargetError(
                "ownership could not be re-verified: the DNS TXT record or well-known file is missing. "
                "Verify the target again before scanning."
            )

        def remaining() -> int:
            left = int(deadline - time.monotonic())
            if left <= 0:
                raise TimeoutError(f"the scan exceeded its {config.web_scan_timeout}s time limit")
            return left

        try:
            findings += passive_checks.run(hostname, guard.url, user_agent=config.scanner_user_agent,
                                           scheme=scheme, log=ctx.log)
        except httpx.HTTPError as exc:
            ctx.log(f"[passive] error: {exc}")
            errors.add("passive")

        mounts = Mounts(out=out, vulndb=config.vulndb_dir)
        templates = config.vulndb_dir / "nuclei-templates" / "http"
        if templates.is_dir():
            res = sandbox.run(
                "nuclei", nuclei_args(base_url, guard.url, profile, config), mounts, network="egress",
                timeout=min(remaining(), config.tool_timeout), should_stop=ctx.should_stop, log=ctx.log,
            )
            if res.exit_code != 0:
                ctx.log(f"[nuclei] error: {res.stderr_tail[-400:]}")
                errors.add("nuclei")
            report = out / "nuclei.jsonl"
            if report.exists():
                findings += parse_nuclei_jsonl(report.read_text(errors="replace"))
        else:
            ctx.log("[nuclei] skipped: templates are not installed on this worker")
            errors.add("nuclei")

        if config.sandbox == "docker":
            res = sandbox.run(
                "zap", zap_args(base_url, guard.bind_host, guard.port, profile, config), mounts,
                network="egress", image=config.zap_image, user=None, out_mount="/zap/wrk",
                extra_tmpfs=["/home/zap:rw,uid=1000,gid=1000,size=512m"],
                timeout=min(remaining(), config.web_scan_timeout), should_stop=ctx.should_stop, log=ctx.log,
            )
            # zap-*.py exit 0 (pass), 1 (fail-level alerts) or 2 (warnings); >2 is an error.
            if res.exit_code > 2:
                ctx.log(f"[zap] error: {res.stderr_tail[-400:]}")
                errors.add("zap")
            report = out / "zap.json"
            if report.exists():
                findings += parse_zap(load_json(str(report)))
        else:
            ctx.log("[zap] skipped: ZAP runs only in the docker sandbox")

        stats = guard.stats
        ctx.log(
            f"egress guard: {stats.allowed} connections allowed, {stats.denied} denied, "
            f"{stats.throttled} throttled, {stats.bytes // 1024} KiB transferred"
        )
        if stats.denied_hosts:
            ctx.log(f"egress guard blocked: {', '.join(sorted(stats.denied_hosts)[:10])}")
        db.audit(
            str(scan["org_id"]),
            "scan.egress_summary",
            str(scan["id"]),
            {"pinned_ip": pinned, "allowed": stats.allowed, "denied": stats.denied,
             "throttled": stats.throttled, "bytes": stats.bytes, "denied_hosts": sorted(stats.denied_hosts)[:50]},
        )

    return merge_findings(findings), errors
