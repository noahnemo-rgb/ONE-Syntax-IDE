"""Passive checks of a live target: ordinary GET requests only, no attack payloads.

All HTTP traffic goes through the egress guard, including the TLS probes, which
open a CONNECT tunnel through it.
"""

from __future__ import annotations

import re
import socket
import ssl
import time
from collections.abc import Callable
from datetime import UTC, datetime
from http.cookies import SimpleCookie

import httpx

from .models import Finding

TOOL = "patchai-passive"
PROBE_ORIGIN = "https://cors-probe.patchai.invalid"
SESSIONISH = re.compile(r"sess|auth|token|jwt|sid|login|remember", re.I)
VERSIONED = re.compile(r"\d+\.\d+")


def _f(rule: str, title: str, severity: str, url: str, description: str, cwe: str | None = None,
       evidence: str | None = None) -> Finding:
    return Finding(tool=TOOL, rule_id=f"passive/{rule}", title=title, severity=severity, category="web",
                   description=description, cwe=cwe, url=url, evidence=evidence)


def check_headers(url: str, res: httpx.Response) -> list[Finding]:
    h = res.headers
    out: list[Finding] = []
    https = url.startswith("https://")
    if https:
        hsts = h.get("strict-transport-security")
        if not hsts:
            out.append(_f("missing-hsts", "Strict-Transport-Security header missing", "low", url,
                          "Without HSTS, a network attacker can downgrade a first visit to plain HTTP. "
                          "Add `Strict-Transport-Security: max-age=31536000; includeSubDomains`.", "CWE-319"))
        else:
            m = re.search(r"max-age=(\d+)", hsts)
            if not m or int(m.group(1)) < 15552000:
                out.append(_f("short-hsts", "HSTS max-age is shorter than 180 days", "info", url,
                              "Use a max-age of at least 15552000 seconds.", "CWE-319", f"Strict-Transport-Security: {hsts}"))
    csp = h.get("content-security-policy")
    content_type = h.get("content-type", "")
    if "html" in content_type:
        if not csp:
            out.append(_f("missing-csp", "Content-Security-Policy header missing", "low", url,
                          "A Content-Security-Policy limits the damage of cross-site scripting by restricting where "
                          "scripts can load from.", "CWE-693"))
        else:
            script_src = re.search(r"(?:script-src|default-src)([^;]*)", csp)
            if script_src and "'unsafe-inline'" in script_src.group(1) and "nonce-" not in script_src.group(1):
                out.append(_f("csp-unsafe-inline", "Content-Security-Policy allows inline scripts", "low", url,
                              "`'unsafe-inline'` in script-src removes most of the protection CSP gives against XSS. "
                              "Use nonces or hashes instead.", "CWE-79", f"Content-Security-Policy: {csp[:300]}"))
        if not h.get("x-frame-options") and not (csp and "frame-ancestors" in csp):
            out.append(_f("clickjacking", "Page can be framed by other sites (clickjacking)", "low", url,
                          "Set `Content-Security-Policy: frame-ancestors 'none'` (or 'self') or "
                          "`X-Frame-Options: DENY`.", "CWE-1021"))
    if h.get("x-content-type-options", "").lower() != "nosniff":
        out.append(_f("missing-nosniff", "X-Content-Type-Options: nosniff missing", "info", url,
                      "Browsers may MIME-sniff responses into executable content.", "CWE-693"))
    disclosed = [
        f"{name}: {h[name]}" for name in ("server", "x-powered-by", "x-aspnet-version")
        if h.get(name) and VERSIONED.search(h[name])
    ]
    if disclosed:
        out.append(_f("version-disclosure", "Software versions disclosed in response headers", "info", url,
                      "Exact version numbers help attackers pick known exploits. Remove or genericize these headers.",
                      "CWE-200", "\n".join(disclosed)))
    return out


def check_cookies(url: str, res: httpx.Response) -> list[Finding]:
    out: list[Finding] = []
    https = url.startswith("https://")
    for raw in res.headers.get_list("set-cookie"):
        jar = SimpleCookie()
        try:
            jar.load(raw)
        except Exception:
            continue
        lower = raw.lower()
        for name in jar:
            sessionish = bool(SESSIONISH.search(name))
            if https and "secure" not in lower:
                out.append(_f(f"cookie-insecure-{name}", f"Cookie `{name}` lacks the Secure flag",
                              "medium" if sessionish else "low", url,
                              "The cookie can be sent over plain HTTP and intercepted.", "CWE-614"))
            if sessionish and "httponly" not in lower:
                out.append(_f(f"cookie-httponly-{name}", f"Session cookie `{name}` lacks the HttpOnly flag", "medium",
                              url, "Scripts (including injected ones) can read this cookie.", "CWE-1004"))
            if "samesite" not in lower and sessionish:
                out.append(_f(f"cookie-samesite-{name}", f"Session cookie `{name}` has no SameSite attribute", "low",
                              url, "Set `SameSite=Lax` or `Strict` to limit cross-site request forgery.", "CWE-1275"))
    return out


def check_cors(url: str, res: httpx.Response) -> list[Finding]:
    acao = res.headers.get("access-control-allow-origin")
    creds = res.headers.get("access-control-allow-credentials", "").lower() == "true"
    if acao == PROBE_ORIGIN:
        return [_f("cors-reflect", "CORS reflects arbitrary origins" + (" with credentials" if creds else ""),
                   "high" if creds else "medium", url,
                   "The server echoes any Origin in Access-Control-Allow-Origin, so any website can read responses"
                   + (" with the victim's cookies." if creds else "."), "CWE-942",
                   f"Origin: {PROBE_ORIGIN} -> Access-Control-Allow-Origin: {acao}")]
    if acao == "null" and creds:
        return [_f("cors-null", "CORS trusts the null origin with credentials", "high", url,
                   "Sandboxed iframes have the null origin, so any site can read credentialed responses.", "CWE-942")]
    return []


def check_exposures(client: httpx.Client, base: str) -> list[Finding]:
    out: list[Finding] = []
    res = client.get(f"{base}/.git/HEAD")
    if res.status_code == 200 and res.text.startswith("ref: refs/"):
        out.append(_f("exposed-git", "Git repository exposed at /.git/", "high", f"{base}/.git/HEAD",
                      "The site's .git directory is downloadable, which usually reveals the full source code and history.",
                      "CWE-538", res.text[:80].strip()))
    res = client.get(f"{base}/.env")
    lines = [ln for ln in res.text.splitlines()[:50] if re.match(r"^[A-Z][A-Z0-9_]{2,}=", ln)] if res.status_code == 200 else []
    if len(lines) >= 2 and "html" not in res.headers.get("content-type", ""):
        keys = ", ".join(sorted({ln.split("=", 1)[0] for ln in lines})[:10])
        out.append(_f("exposed-env", "Environment file exposed at /.env", "critical", f"{base}/.env",
                      "A .env file is publicly downloadable. It typically contains credentials; rotate every secret in it. "
                      f"Variable names seen (values withheld): {keys}.", "CWE-538", "[redacted]"))
    return out


def _tunnel(proxy_host: str, proxy_port: int, host: str, port: int = 443, timeout: float = 10) -> socket.socket:
    sock = socket.create_connection((proxy_host, proxy_port), timeout=timeout)
    sock.sendall(f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode())
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = sock.recv(4096)
        if not chunk:
            break
        head += chunk
    if not head.startswith(b"HTTP/1.1 200"):
        sock.close()
        raise ConnectionError(head.split(b"\r\n", 1)[0].decode(errors="replace"))
    return sock


def check_tls(proxy_host: str, proxy_port: int, host: str) -> list[Finding]:
    url = f"https://{host}/"
    out: list[Finding] = []
    ctx = ssl.create_default_context()
    try:
        with ctx.wrap_socket(_tunnel(proxy_host, proxy_port, host), server_hostname=host) as tls:
            cert = tls.getpeercert()
            not_after = datetime.fromtimestamp(ssl.cert_time_to_seconds(cert["notAfter"]), UTC)
            days = (not_after - datetime.now(UTC)).days
            if days < 14:
                out.append(_f("cert-expiring", f"TLS certificate expires in {days} days", "medium", url,
                              "Renew the certificate before it expires; automate renewal.", "CWE-298",
                              f"notAfter={cert['notAfter']}"))
    except ssl.SSLCertVerificationError as exc:
        out.append(_f("cert-invalid", "TLS certificate is not trusted", "high", url,
                      f"Browsers will show a warning and users can be trained to click through it: {exc.verify_message}.",
                      "CWE-295"))
    except (OSError, ConnectionError):
        return out
    legacy = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    legacy.check_hostname = False
    legacy.verify_mode = ssl.CERT_NONE
    try:
        legacy.minimum_version = ssl.TLSVersion.TLSv1
        legacy.maximum_version = ssl.TLSVersion.TLSv1_1
        legacy.set_ciphers("DEFAULT:@SECLEVEL=0")
    except (ValueError, ssl.SSLError):
        return out
    try:
        with legacy.wrap_socket(_tunnel(proxy_host, proxy_port, host), server_hostname=host) as tls:
            out.append(_f("legacy-tls", f"Server accepts {tls.version()}", "medium", url,
                          "TLS 1.0 and 1.1 are deprecated (RFC 8996). Accept TLS 1.2 and 1.3 only.", "CWE-326"))
    except (OSError, ssl.SSLError, ConnectionError):
        pass
    return out


def run(host: str, proxy_url: str, *, user_agent: str, scheme: str = "https",
        log: Callable[[str], None] = lambda _: None, delay: float = 0.2) -> list[Finding]:
    base = f"{scheme}://{host}"
    findings: list[Finding] = []
    headers = {"user-agent": user_agent}
    with httpx.Client(proxy=proxy_url, headers=headers, timeout=15, follow_redirects=False, verify=True) as client:
        try:
            res = client.get(f"{base}/", headers={"origin": PROBE_ORIGIN})
        except httpx.ConnectError as exc:
            if scheme == "https" and "CERTIFICATE_VERIFY_FAILED" in str(exc):
                res = None
            else:
                raise
        if res is not None:
            log(f"[passive] GET {base}/ -> {res.status_code}")
            findings += check_headers(f"{base}/", res) + check_cookies(f"{base}/", res) + check_cors(f"{base}/", res)
            time.sleep(delay)
            findings += check_exposures(client, base)
        if scheme == "https":
            time.sleep(delay)
            try:
                plain = client.get(f"http://{host}/")
                location = plain.headers.get("location", "")
                if plain.status_code < 300 and not location.startswith("https://"):
                    findings.append(_f("no-https-redirect", "Plain HTTP is served without redirecting to HTTPS",
                                       "medium", f"http://{host}/",
                                       "Redirect all HTTP requests to HTTPS and enable HSTS.", "CWE-319"))
            except httpx.HTTPError:
                pass
            proxy = httpx.URL(proxy_url)
            findings += check_tls(proxy.host, proxy.port, host)
    log(f"[passive] {len(findings)} observations")
    return findings
