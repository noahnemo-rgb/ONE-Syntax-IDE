"""Data retention: deletes customer data once it is no longer needed.

The audit log and attestations are kept; they are the record of who
authorized which scans and are protected by database triggers.
"""

from __future__ import annotations

from collections.abc import Callable

from .db import Database

# Archives that were never scanned (e.g. the scan was rejected) are still removed after a day.
UPLOAD_MAX_AGE_HOURS = 24


def run(db: Database, log: Callable[[str], None] = print) -> dict[str, int]:
    with db.conn() as c:
        uploads = c.execute(
            """UPDATE uploads SET data = NULL
               WHERE data IS NOT NULL AND created_at < now() - make_interval(hours => %s)""",
            (UPLOAD_MAX_AGE_HOURS,),
        ).rowcount
        scans = c.execute(
            """
            DELETE FROM scans s USING orgs o
            WHERE s.org_id = o.id
              AND s.status IN ('succeeded', 'failed', 'cancelled')
              AND s.created_at < now() - make_interval(days => o.retention_days)
            """
        ).rowcount
        abandoned = c.execute(
            """DELETE FROM uploads u
               WHERE u.data IS NULL AND u.created_at < now() - interval '30 days'
                 AND NOT EXISTS (SELECT 1 FROM scans s WHERE s.upload_id = u.id)"""
        ).rowcount
    result = {"upload_bytes_deleted": uploads, "scans_deleted": scans, "upload_rows_deleted": abandoned}
    if any(result.values()):
        log(f"retention: {result}")
    return result
