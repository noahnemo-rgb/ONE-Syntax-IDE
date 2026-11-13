"""Postgres job queue and persistence. The `scans` table is the queue."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .models import Finding

# A scan whose worker stopped heart-beating for this long is considered abandoned.
STALE_LOCK_SECONDS = 300
MAX_ATTEMPTS = 2


class Database:
    def __init__(self, url: str):
        self.url = url

    @contextmanager
    def conn(self) -> Iterator[psycopg.Connection]:
        with psycopg.connect(self.url, row_factory=dict_row, autocommit=True) as conn:
            yield conn

    # -- queue -------------------------------------------------------------

    def claim_scan(self, worker_id: str, kinds: tuple[str, ...]) -> dict[str, Any] | None:
        with self.conn() as c:
            return c.execute(
                """
                UPDATE scans SET status = 'running', locked_by = %(w)s, locked_at = now(),
                       started_at = coalesce(started_at, now()), attempts = attempts + 1
                WHERE id = (
                  SELECT id FROM scans
                  WHERE status = 'queued' AND kind::text = ANY(%(kinds)s)
                  ORDER BY created_at
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
                )
                RETURNING *
                """,
                {"w": worker_id, "kinds": list(kinds)},
            ).fetchone()

    def heartbeat(self, scan_id: str, worker_id: str) -> str | None:
        """Refreshes the lock and returns the scan's current status (e.g. 'cancelled')."""
        with self.conn() as c:
            row = c.execute(
                "UPDATE scans SET locked_at = now() WHERE id = %s AND locked_by = %s RETURNING status",
                (scan_id, worker_id),
            ).fetchone()
            return row["status"] if row else None

    def recover_stale(self) -> int:
        with self.conn() as c:
            requeued = c.execute(
                """
                UPDATE scans SET status = 'queued', locked_by = NULL, locked_at = NULL
                WHERE status = 'running' AND locked_at < now() - make_interval(secs => %s)
                  AND attempts < %s
                """,
                (STALE_LOCK_SECONDS, MAX_ATTEMPTS),
            ).rowcount
            c.execute(
                """
                UPDATE scans SET status = 'failed', finished_at = now(),
                       error = 'Worker stopped responding; the scan was abandoned.'
                WHERE status = 'running' AND locked_at < now() - make_interval(secs => %s)
                  AND attempts >= %s
                """,
                (STALE_LOCK_SECONDS, MAX_ATTEMPTS),
            )
            return requeued

    def append_log(self, scan_id: str, line: str) -> None:
        with self.conn() as c:
            c.execute(
                "UPDATE scans SET logs = right(logs || %s, 200000) WHERE id = %s",
                (line.rstrip("\n") + "\n", scan_id),
            )

    def finish_scan(
        self,
        scan_id: str,
        status: str,
        *,
        error: str | None = None,
        summary: dict | None = None,
        commit_sha: str | None = None,
    ) -> None:
        with self.conn() as c:
            # Never overwrite a cancellation that happened while the scan was running.
            c.execute(
                """
                UPDATE scans SET status = %s::scan_status, finished_at = now(), error = %s,
                       summary = coalesce(%s, summary), commit_sha = coalesce(%s, commit_sha),
                       locked_by = NULL
                WHERE id = %s AND status = 'running'
                """,
                (status, error, Jsonb(summary) if summary is not None else None, commit_sha, scan_id),
            )

    # -- lookups -----------------------------------------------------------

    def scans_paused(self) -> bool:
        with self.conn() as c:
            row = c.execute("SELECT value FROM system_settings WHERE key = 'scans_paused'").fetchone()
            return bool(row and row["value"] is True)

    def get_org(self, org_id: str) -> dict[str, Any]:
        with self.conn() as c:
            return c.execute("SELECT * FROM orgs WHERE id = %s", (org_id,)).fetchone()

    def get_repo(self, repo_id: str) -> dict[str, Any] | None:
        with self.conn() as c:
            return c.execute("SELECT * FROM repos WHERE id = %s", (repo_id,)).fetchone()

    def get_upload_bytes(self, upload_id: str) -> bytes | None:
        with self.conn() as c:
            row = c.execute("SELECT data FROM uploads WHERE id = %s", (upload_id,)).fetchone()
            return bytes(row["data"]) if row and row["data"] is not None else None

    def discard_upload_bytes(self, upload_id: str) -> None:
        """Source archives are deleted as soon as they have been scanned."""
        with self.conn() as c:
            c.execute("UPDATE uploads SET data = NULL WHERE id = %s", (upload_id,))

    def get_target(self, target_id: str) -> dict[str, Any] | None:
        with self.conn() as c:
            return c.execute("SELECT * FROM targets WHERE id = %s", (target_id,)).fetchone()

    def latest_attestation(self, target_id: str, profile: str) -> dict[str, Any] | None:
        with self.conn() as c:
            return c.execute(
                """SELECT * FROM attestations WHERE target_id = %s AND profile = %s::scan_profile
                   ORDER BY created_at DESC LIMIT 1""",
                (target_id, profile),
            ).fetchone()

    def mark_target_unverified(self, target_id: str) -> None:
        with self.conn() as c:
            c.execute(
                "UPDATE targets SET verified_at = NULL, verification_expires_at = NULL WHERE id = %s",
                (target_id,),
            )

    # -- results -----------------------------------------------------------

    def insert_findings(self, scan_id: str, org_id: str, findings: list[Finding]) -> None:
        if not findings:
            return
        with self.conn() as c, c.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO findings (scan_id, org_id, fingerprint, tools, rule_id, title, description,
                  severity, category, cwe, file_path, start_line, end_line, url, evidence,
                  package_name, installed_version, fixed_version)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::severity, %s::finding_category, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s)
                ON CONFLICT (scan_id, fingerprint) DO NOTHING
                """,
                [
                    (
                        scan_id, org_id, f.fingerprint, f.tools, f.rule_id[:300], f.title[:300],
                        f.description, f.severity, f.category, f.cwe, f.file_path, f.start_line,
                        f.end_line, f.url, f.evidence, f.package_name, f.installed_version, f.fixed_version,
                    )
                    for f in findings
                ],
            )

    def findings_for_triage(self, scan_id: str, limit: int) -> list[dict[str, Any]]:
        with self.conn() as c:
            return c.execute(
                """
                SELECT * FROM findings WHERE scan_id = %s AND ai_verdict IS NULL
                ORDER BY array_position(ARRAY['critical','high','medium','low','info']::severity[], severity),
                         created_at
                LIMIT %s
                """,
                (scan_id, limit),
            ).fetchall()

    def save_triage(self, finding_id: str, result: dict[str, Any]) -> None:
        with self.conn() as c:
            c.execute(
                """
                UPDATE findings SET ai_verdict = %s::ai_verdict, ai_confidence = %s,
                       ai_severity = %s::severity, ai_explanation = %s, ai_fix_diff = %s
                WHERE id = %s
                """,
                (
                    result["verdict"], result.get("confidence"), result.get("severity"),
                    result.get("explanation"), result.get("fix_diff"), finding_id,
                ),
            )

    def audit(self, org_id: str | None, action: str, subject_id: str, metadata: dict | None = None) -> None:
        with self.conn() as c:
            c.execute(
                """INSERT INTO audit_log (org_id, action, subject_type, subject_id, metadata)
                   VALUES (%s, %s, 'scan', %s, %s)""",
                (org_id, action, subject_id, Jsonb(json.loads(json.dumps(metadata or {}, default=str)))),
            )
