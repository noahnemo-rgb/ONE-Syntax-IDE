"""Worker entry point: claims scans from Postgres and runs them."""

from __future__ import annotations

import logging
import signal
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any

from . import code_scan, retention, triage, vulndb, web_scan
from .config import Config
from .db import Database
from .normalize import summarize
from .sandbox import Cancelled, Sandbox
from .sources import SourceError, extract_tarball, extract_zip, fetch_github_repo

log = logging.getLogger("patchai.worker")
HEARTBEAT_SECONDS = 10


class ScanContext:
    """Per-scan state shared with the heartbeat thread."""

    def __init__(self, db: Database, config: Config, scan: dict[str, Any]):
        self.db = db
        self.config = config
        self.scan = scan
        self.stop = threading.Event()
        self.stop_reason = ""
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._beat, daemon=True)

    def __enter__(self) -> ScanContext:
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._done.set()
        self._thread.join(timeout=HEARTBEAT_SECONDS + 5)

    def _beat(self) -> None:
        while not self._done.wait(HEARTBEAT_SECONDS):
            try:
                status = self.db.heartbeat(self.scan["id"], self.config.worker_id)
                if status != "running":
                    self.stop_reason = "the scan was cancelled"
                    self.stop.set()
                elif self.config.kill_switch_env or self.db.scans_paused():
                    self.stop_reason = "the platform kill switch was engaged"
                    self.stop.set()
            except Exception:  # transient DB errors must not kill the scan
                log.exception("heartbeat failed")

    def should_stop(self) -> bool:
        return self.stop.is_set()

    def log(self, message: str) -> None:
        log.info("[%s] %s", self.scan["id"], message)
        try:
            self.db.append_log(self.scan["id"], f"{time.strftime('%H:%M:%S')} {message}")
        except Exception:
            log.exception("could not persist scan log")


class Worker:
    def __init__(self, config: Config):
        self.config = config
        self.db = Database(config.database_url)
        self.sandbox = Sandbox(config)
        self.running = True
        self._last_retention = 0.0

    def stop(self, *_: object) -> None:
        log.info("shutdown requested; finishing the current scan")
        self.running = False

    def maintenance(self) -> None:
        self.db.recover_stale()
        now = time.time()
        if now - self._last_retention > self.config.retention_interval:
            self._last_retention = now
            try:
                retention.run(self.db, log=log.info)
            except Exception:
                log.exception("retention job failed")
        if vulndb.needs_refresh(
            self.config.vulndb_dir, self.config.vulndb_refresh_hours
        ):
            try:
                vulndb.refresh(self.config.vulndb_dir, log=log.info)
            except Exception:
                log.exception("vulnerability database refresh failed; using cached copy")

    def run_forever(self) -> None:
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)
        log.info("worker %s started (kinds=%s, sandbox=%s)", self.config.worker_id, self.config.kinds, self.config.sandbox)
        last_maintenance = 0.0
        while self.running:
            if time.time() - last_maintenance > 60:
                last_maintenance = time.time()
                self.maintenance()
            if not self.run_once():
                time.sleep(self.config.poll_interval)

    def run_once(self) -> bool:
        """Claims and runs at most one scan. Returns True if a scan was processed."""
        if self.config.kill_switch_env or self.db.scans_paused():
            return False
        scan = self.db.claim_scan(self.config.worker_id, self.config.kinds)
        if not scan:
            return False
        self.process(scan)
        return True

    def process(self, scan: dict[str, Any]) -> None:
        scan_id = str(scan["id"])
        org_id = str(scan["org_id"])
        workdir = self.config.work_dir / f"{scan_id}-{uuid.uuid4().hex[:6]}"
        with ScanContext(self.db, self.config, scan) as ctx:
            self.db.audit(org_id, "scan.started", scan_id, {"worker": self.config.worker_id, "kind": scan["kind"]})
            try:
                if scan["kind"] == "code":
                    findings, commit_sha, errors, src = self._code(ctx, workdir)
                else:
                    findings, errors = web_scan.run(ctx, self.db, self.config, self.sandbox, workdir)
                    commit_sha, src = None, None
                self.db.insert_findings(scan_id, org_id, findings)
                summary = summarize(findings)
                if errors:
                    ctx.log(f"tools with errors: {', '.join(sorted(errors))}")
                org = self.db.get_org(org_id)
                if org and org["ai_triage_enabled"]:
                    triage.triage_scan(ctx, self.db, self.config, scan_id, src)
                status = "succeeded" if len(errors) < 3 else "failed"
                self.db.finish_scan(
                    scan_id,
                    status,
                    summary=summary,
                    commit_sha=commit_sha,
                    error=None if status == "succeeded" else f"{len(errors)} tools failed; see the scan log.",
                )
                ctx.log(f"scan {status}: {summary['total']} findings")
                self.db.audit(org_id, f"scan.{status}", scan_id, {"summary": summary, "tool_errors": list(errors)})
            except Cancelled as exc:
                ctx.log(str(exc))
                self.db.finish_scan(scan_id, "cancelled", error=f"Stopped because {ctx.stop_reason or 'it was cancelled'}.")
                self.db.audit(org_id, "scan.stopped", scan_id, {"reason": ctx.stop_reason})
            except (SourceError, web_scan.TargetError, TimeoutError) as exc:
                ctx.log(f"error: {exc}")
                self.db.finish_scan(scan_id, "failed", error=str(exc))
                self.db.audit(org_id, "scan.failed", scan_id, {"error": str(exc)})
            except Exception as exc:
                ctx.log("internal error: " + "".join(traceback.format_exception_only(exc)).strip())
                log.exception("scan %s crashed", scan_id)
                self.db.finish_scan(scan_id, "failed", error="Internal error while scanning. Our team has been notified.")
                self.db.audit(org_id, "scan.failed", scan_id, {"error": type(exc).__name__})
            finally:
                code_scan.cleanup(workdir)

    def _code(self, ctx: ScanContext, workdir: Path):
        scan = ctx.scan
        src = workdir / "src"
        commit_sha = None
        if scan.get("upload_id"):
            data = self.db.get_upload_bytes(str(scan["upload_id"]))
            if data is None:
                raise SourceError("the uploaded archive has already been deleted; upload it again")
            files = extract_zip(data, src, max_bytes=self.config.max_source_bytes, max_files=self.config.max_files)
            self.db.discard_upload_bytes(str(scan["upload_id"]))
            ctx.log(f"extracted {files} files from the uploaded archive (archive deleted)")
        else:
            repo = self.db.get_repo(str(scan["repo_id"]))
            if not repo or repo["source"] != "github":
                raise SourceError("repository not found")
            if not (self.config.github_app_id and self.config.github_private_key):
                raise SourceError("the GitHub App is not configured on this worker")
            ctx.log(f"downloading {repo['name']}")
            data, commit_sha = fetch_github_repo(
                app_id=self.config.github_app_id,
                private_key=self.config.github_private_key,
                installation_id=int(repo["github_installation_id"]),
                full_name=repo["name"],
                ref=scan.get("ref") or repo.get("default_branch"),
                max_bytes=self.config.max_source_bytes,
            )
            files = extract_tarball(data, src, max_bytes=self.config.max_source_bytes, max_files=self.config.max_files)
            ctx.log(f"extracted {files} files at commit {commit_sha[:10]}")
        result = code_scan.run_code_tools(
            self.config, self.sandbox, src, workdir / "out", should_stop=ctx.should_stop, log=ctx.log
        )
        return result.findings, commit_sha, result.tool_errors, src


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    Worker(Config.from_env()).run_forever()


if __name__ == "__main__":
    main()
