import json

import httpx
import pytest

from patchai_worker import passive_checks as pc
from patchai_worker.normalize import parse_nuclei_jsonl, parse_zap
from patchai_worker.web_scan import TargetError, is_public, resolve_and_pin

URL = "https://app.example.com/"


def response(headers: list[tuple[str, str]], status: int = 200) -> httpx.Response:
    return httpx.Response(status, headers=headers, request=httpx.Request("GET", URL))


def rules(findings):
    return sorted(f.rule_id for f in findings)


def test_bare_html_response_reports_missing_protections():
    found = rules(pc.check_headers(URL, response([("content-type", "text/html"), ("server", "nginx/1.18.0")])))
    assert found == [
        "passive/clickjacking",
        "passive/missing-csp",
        "passive/missing-hsts",
        "passive/missing-nosniff",
        "passive/version-disclosure",
    ]


def test_hardened_response_is_clean():
    headers = [
        ("content-type", "text/html"),
        ("strict-transport-security", "max-age=63072000; includeSubDomains"),
        ("content-security-policy", "default-src 'self'; frame-ancestors 'none'"),
        ("x-content-type-options", "nosniff"),
        ("server", "nginx"),
    ]
    assert pc.check_headers(URL, response(headers)) == []


def test_cookie_flags():
    res = response([
        ("set-cookie", "sessionid=abc; Path=/"),
        ("set-cookie", "theme=dark; Path=/; Secure"),
        ("set-cookie", "auth_token=x; Secure; HttpOnly; SameSite=Lax"),
    ])
    found = rules(pc.check_cookies(URL, res))
    assert found == [
        "passive/cookie-httponly-sessionid",
        "passive/cookie-insecure-sessionid",
        "passive/cookie-samesite-sessionid",
    ]
    assert next(f for f in pc.check_cookies(URL, res) if "insecure" in f.rule_id).severity == "medium"


def test_cors_reflection_with_credentials_is_high():
    res = response([
        ("access-control-allow-origin", pc.PROBE_ORIGIN),
        ("access-control-allow-credentials", "true"),
    ])
    [finding] = pc.check_cors(URL, res)
    assert finding.severity == "high" and finding.cwe == "CWE-942"
    assert pc.check_cors(URL, response([("access-control-allow-origin", "*")])) == []


def test_exposed_env_values_are_withheld():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.env":
            return httpx.Response(200, text="DB_PASSWORD=hunter2\nSTRIPE_KEY=sk_live_x\n")
        if request.url.path == "/.git/HEAD":
            return httpx.Response(200, text="ref: refs/heads/main\n")
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        found = pc.check_exposures(client, "https://app.example.com")
    assert rules(found) == ["passive/exposed-env", "passive/exposed-git"]
    env = next(f for f in found if f.rule_id == "passive/exposed-env")
    assert env.severity == "critical"
    assert "hunter2" not in (env.description + (env.evidence or ""))
    assert "DB_PASSWORD" in env.description


def test_spa_fallback_is_not_an_exposed_env():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>APP_NAME=x\nFOO=y</html>", headers={"content-type": "text/html"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert pc.check_exposures(client, "https://app.example.com") == []


@pytest.mark.parametrize(
    "address,public",
    [("8.8.8.8", True), ("10.0.0.1", False), ("169.254.169.254", False), ("127.0.0.1", False),
     ("100.64.1.1", False), ("::1", False), ("::ffff:10.0.0.1", False), ("2606:4700::1111", True)],
)
def test_is_public(address, public):
    assert is_public(address) is public


def test_private_resolution_is_refused():
    with pytest.raises(TargetError, match="non-public"):
        resolve_and_pin("localhost")
    pinned, _ = resolve_and_pin("localhost", allow_private=True)
    assert pinned == "127.0.0.1"


def test_parse_nuclei():
    line = json.dumps({
        "template-id": "git-config",
        "info": {"name": "Git Config Disclosure", "severity": "medium",
                 "classification": {"cwe-id": ["cwe-200"]}, "remediation": "Block /.git"},
        "matched-at": "https://app.example.com/.git/config",
        "extracted-results": ["[core]"],
    })
    [f] = parse_nuclei_jsonl(line + "\nnot json\n")
    assert (f.rule_id, f.severity, f.cwe, f.url) == (
        "nuclei/git-config", "medium", "CWE-200", "https://app.example.com/.git/config")
    assert "Block /.git" in f.description


def test_nuclei_exposure_merges_with_passive_check():
    from patchai_worker.normalize import merge_findings

    line = json.dumps({"template-id": "laravel-env", "info": {"name": "Laravel .env", "severity": "high",
                       "tags": ["config", "exposure", "laravel"]}, "matched-at": "https://app.example.com/.env"})
    passive = pc._f("exposed-env", "Environment file exposed", "critical", "https://app.example.com/.env",
                    "x", "CWE-538")
    [merged] = merge_findings(parse_nuclei_jsonl(line) + [passive])
    assert merged.severity == "critical"
    assert sorted(merged.tools) == ["nuclei", "patchai-passive"]


def test_parse_zap_downgrades_low_confidence_and_drops_false_positives():
    data = {"site": [{"@name": "https://app.example.com", "alerts": [
        {"pluginid": "40012", "alert": "Cross Site Scripting (Reflected)", "riskcode": "3", "confidence": "2",
         "cweid": "79", "desc": "<p>XSS</p>", "solution": "<p>Encode output</p>",
         "instances": [{"uri": "https://app.example.com/search?q=x", "method": "GET", "param": "q",
                        "attack": "<script>alert(1)</script>"}]},
        {"pluginid": "10020", "alert": "Missing Anti-clickjacking Header", "riskcode": "2", "confidence": "1",
         "cweid": "1021", "instances": [{"uri": "https://app.example.com/"}]},
        {"pluginid": "1", "alert": "Noise", "riskcode": "3", "confidence": "0", "instances": [{}]},
    ]}]}
    found = parse_zap(data)
    assert [(f.rule_id, f.severity, f.cwe) for f in found] == [
        ("zap/40012", "high", "CWE-79"),
        ("zap/10020", "low", "CWE-1021"),
    ]
    assert found[0].description == "XSS\n\nSolution: Encode output"
    assert "param: q" in found[0].evidence
