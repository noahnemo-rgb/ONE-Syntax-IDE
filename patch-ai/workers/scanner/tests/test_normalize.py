import json
from pathlib import Path

from patchai_worker import normalize
from patchai_worker.models import Finding

FIXTURES = Path(__file__).parent / "fixtures" / "tool-output"


def load(name):
    return json.loads((FIXTURES / name).read_text())


def test_opengrep_rule_ids_titles_and_paths():
    findings = normalize.parse_opengrep(load("opengrep.json"))
    assert len(findings) == 10
    sqli = next(f for f in findings if "sql-injection" in f.rule_id)
    assert sqli.rule_id == "patchai.python.sql-injection.string-format"
    assert sqli.title == "SQL injection (string format)"
    assert sqli.file_path == "app.py"
    assert sqli.start_line == 17
    assert sqli.cwe == "CWE-89"
    assert sqli.severity == "high"
    weak_hash = next(f for f in findings if "weak-hash" in f.rule_id)
    assert weak_hash.severity == "low"  # WARNING downgraded for LOW confidence


def test_bandit_drops_import_noise_and_never_keeps_secret_values():
    findings = normalize.parse_bandit(load("bandit.json"))
    assert not any(f.rule_id.startswith("bandit.B4") for f in findings)
    secret = next(f for f in findings if f.rule_id == "bandit.B105")
    assert secret.category == "secret"
    assert secret.evidence is None
    assert "FIXTURE" not in (secret.description or "")
    yaml_load = next(f for f in findings if f.rule_id == "bandit.B506")
    assert yaml_load.cwe == "CWE-502"


def test_gitleaks_is_redacted_and_critical_for_known_providers():
    findings = normalize.parse_gitleaks(load("gitleaks.json"))
    assert {f.evidence for f in findings} == {"[redacted]"}
    assert all(f.severity == "critical" for f in findings)
    assert findings[0].file_path == "settings.py"


def test_osv_groups_one_finding_per_package_with_fix():
    findings = normalize.parse_osv(load("osv.json"))
    names = {f.package_name for f in findings}
    assert {"django", "flask", "lodash", "express", "pyyaml", "requests"} <= names
    express = next(f for f in findings if f.package_name == "express")
    assert express.category == "dependency"
    assert express.installed_version == "4.16.0"
    assert express.fixed_version and not express.fixed_version.startswith("5.0.0-")


def test_trivy_vulns_and_misconfig():
    findings = normalize.parse_trivy(load("trivy.json"))
    root = next(f for f in findings if f.rule_id == "trivy.DS-0002")
    assert root.category == "iac" and root.severity == "high" and root.start_line == 2
    assert any(f.category == "dependency" and f.package_name == "django" for f in findings)


def test_merge_combines_tools_and_keeps_highest_severity():
    raw = (
        normalize.parse_opengrep(load("opengrep.json"))
        + normalize.parse_bandit(load("bandit.json"))
        + normalize.parse_gitleaks(load("gitleaks.json"))
        + normalize.parse_osv(load("osv.json"))
        + normalize.parse_trivy(load("trivy.json"))
    )
    merged = normalize.merge_findings(raw)
    assert len(merged) < len(raw)
    sqli = next(f for f in merged if f.cwe == "CWE-89" and f.file_path == "app.py")
    assert sqli.tools == ["opengrep", "bandit"]
    django = next(f for f in merged if f.package_name == "django")
    assert django.tools == ["osv-scanner", "trivy"]
    secret = next(f for f in merged if f.file_path == "settings.py" and f.start_line == 1)
    assert secret.tools[0] == "gitleaks"
    # Sorted most severe first.
    order = [normalize.SEVERITIES.index(f.severity) for f in merged]
    assert order == sorted(order)
    summary = normalize.summarize(merged)
    assert summary["total"] == len(merged)


def test_best_fix_clears_every_advisory():
    assert normalize._best_fix("4.16.0", [["4.19.2", "5.0.0-beta.3"], ["4.20.0", "5.0.0"]]) == "4.20.0"
    assert normalize._best_fix("0.12.2", [["0.12.3"], ["2.2.5", "2.3.2"]]) == "2.2.5"
    assert normalize._best_fix("1.0.0", [[]]) is None


def test_fingerprint_is_stable_and_location_based():
    a = Finding(tool="opengrep", rule_id="r", title="t", severity="high", category="sast", cwe="CWE-89",
                file_path="a.py", start_line=3)
    b = Finding(tool="bandit", rule_id="x", title="y", severity="low", category="sast", cwe="CWE-89",
                file_path="a.py", start_line=3)
    assert a.fingerprint == b.fingerprint
    assert len(a.fingerprint) == 32
