"""Downloads vulnerability databases on the host so code scans can run with no network."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import httpx

NUCLEI_RELEASES = "https://api.github.com/repos/projectdiscovery/nuclei-templates/releases/latest"
OSV_ECOSYSTEMS = ["PyPI", "npm", "Go", "Maven", "RubyGems", "crates.io", "Packagist", "NuGet", "Pub", "Hex"]
OSV_BUCKET = "https://osv-vulnerabilities.storage.googleapis.com"
STAMP = ".last-refresh"


def osv_dir(root: Path) -> Path:
    return root / "osv"


def trivy_dir(root: Path) -> Path:
    return root / "trivy"


def needs_refresh(root: Path, max_age_hours: int) -> bool:
    stamp = root / STAMP
    return not stamp.exists() or (time.time() - stamp.stat().st_mtime) > max_age_hours * 3600


def refresh(root: Path, log=print) -> None:
    root.mkdir(parents=True, exist_ok=True)
    # osv-scanner looks for <cache>/osv-scalibr/<Ecosystem>/all.zip in offline mode.
    for eco in OSV_ECOSYSTEMS:
        dest = osv_dir(root) / "osv-scalibr" / eco / "all.zip"
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp")
        with httpx.stream("GET", f"{OSV_BUCKET}/{eco}/all.zip", timeout=300, follow_redirects=True) as res:
            res.raise_for_status()
            with open(tmp, "wb") as fh:
                for chunk in res.iter_bytes():
                    fh.write(chunk)
        tmp.replace(dest)
        log(f"osv database refreshed: {eco}")
    trivy_dir(root).mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["trivy", "fs", "--download-db-only", "--cache-dir", str(trivy_dir(root)), "--quiet"],
        check=True,
        timeout=900,
    )
    # Running a misconfig scan once caches the checks bundle for offline use.
    empty = root / "empty"
    empty.mkdir(exist_ok=True)
    subprocess.run(
        ["trivy", "fs", "--cache-dir", str(trivy_dir(root)), "--scanners", "misconfig", "--quiet", str(empty)],
        check=True,
        timeout=900,
        capture_output=True,
    )
    log("trivy database refreshed")
    refresh_nuclei_templates(root, log=log)
    (root / STAMP).touch()


def nuclei_dir(root: Path) -> Path:
    return root / "nuclei-templates"


def refresh_nuclei_templates(root: Path, log=print) -> None:
    """Installs the latest projectdiscovery/nuclei-templates release (MIT licensed)."""
    release = httpx.get(NUCLEI_RELEASES, timeout=30, follow_redirects=True)
    release.raise_for_status()
    tag = release.json()["tag_name"]
    dest = nuclei_dir(root)
    if (dest / ".tag").exists() and (dest / ".tag").read_text().strip() == tag:
        return
    staging = root / "nuclei-templates.new"
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    with tempfile.NamedTemporaryFile(suffix=".tar.gz") as tmp:
        url = f"https://github.com/projectdiscovery/nuclei-templates/archive/refs/tags/{tag}.tar.gz"
        with httpx.stream("GET", url, timeout=300, follow_redirects=True) as res:
            res.raise_for_status()
            for chunk in res.iter_bytes():
                tmp.write(chunk)
        tmp.flush()
        subprocess.run(["tar", "xzf", tmp.name, "-C", str(staging), "--strip-components=1"], check=True, timeout=300)
    (staging / ".tag").write_text(tag)
    shutil.rmtree(dest, ignore_errors=True)
    staging.replace(dest)
    log(f"nuclei templates refreshed: {tag}")
