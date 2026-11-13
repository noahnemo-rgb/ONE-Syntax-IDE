import uuid

import psycopg
import pytest

from patchai_worker import retention
from patchai_worker.db import Database
from patchai_worker.models import Finding


@pytest.fixture
def db(database_url):
    database = Database(database_url)
    with psycopg.connect(database_url, autocommit=True) as c:
        org_id = c.execute(
            "INSERT INTO orgs (name, slug) VALUES ('Queue test', %s) RETURNING id", (f"qt-{uuid.uuid4().hex[:8]}",)
        ).fetchone()[0]
        repo_id = c.execute(
            "INSERT INTO repos (org_id, source, name) VALUES (%s, 'upload', 'r') RETURNING id", (org_id,)
        ).fetchone()[0]
        # Earlier scans from other tests or the dev app must not be claimed here.
        c.execute("UPDATE scans SET status = 'cancelled' WHERE status IN ('queued', 'running')")
    database.org_id, database.repo_id = str(org_id), str(repo_id)
    yield database
    with psycopg.connect(database_url, autocommit=True) as c:
        c.execute("DELETE FROM orgs WHERE id = %s", (org_id,))


def enqueue(db, kind="code"):
    with db.conn() as c:
        return str(
            c.execute(
                "INSERT INTO scans (org_id, kind, repo_id) VALUES (%s, %s, %s) RETURNING id",
                (db.org_id, kind, db.repo_id),
            ).fetchone()["id"]
        )


def test_each_scan_is_claimed_once(db):
    a, b = enqueue(db), enqueue(db)
    first = db.claim_scan("w1", ("code",))
    second = db.claim_scan("w2", ("code",))
    assert {str(first["id"]), str(second["id"])} == {a, b}
    assert db.claim_scan("w3", ("code",)) is None


def test_worker_only_claims_its_kinds(db):
    enqueue(db, "web")
    assert db.claim_scan("w1", ("code",)) is None
    assert db.claim_scan("w1", ("web",))["kind"] == "web"


def test_cancellation_is_seen_by_heartbeat_and_not_overwritten(db):
    scan_id = enqueue(db)
    db.claim_scan("w1", ("code",))
    with db.conn() as c:
        c.execute("UPDATE scans SET status = 'cancelled' WHERE id = %s", (scan_id,))
    assert db.heartbeat(scan_id, "w1") == "cancelled"
    db.finish_scan(scan_id, "succeeded", summary={"total": 0})
    with db.conn() as c:
        assert c.execute("SELECT status FROM scans WHERE id = %s", (scan_id,)).fetchone()["status"] == "cancelled"


def test_stale_scans_are_requeued_then_failed(db):
    scan_id = enqueue(db)
    db.claim_scan("w1", ("code",))
    with db.conn() as c:
        c.execute("UPDATE scans SET locked_at = now() - interval '1 hour' WHERE id = %s", (scan_id,))
    db.recover_stale()
    with db.conn() as c:
        assert c.execute("SELECT status FROM scans WHERE id = %s", (scan_id,)).fetchone()["status"] == "queued"
    db.claim_scan("w1", ("code",))
    with db.conn() as c:
        c.execute("UPDATE scans SET locked_at = now() - interval '1 hour' WHERE id = %s", (scan_id,))
    db.recover_stale()
    with db.conn() as c:
        row = c.execute("SELECT status, error FROM scans WHERE id = %s", (scan_id,)).fetchone()
    assert row["status"] == "failed" and "abandoned" in row["error"]


def test_findings_insert_is_idempotent(db):
    scan_id = enqueue(db)
    f = Finding(tool="opengrep", rule_id="r", title="t", severity="high", category="sast", cwe="CWE-89",
                file_path="a.py", start_line=1)
    db.insert_findings(scan_id, db.org_id, [f])
    db.insert_findings(scan_id, db.org_id, [f])
    with db.conn() as c:
        assert c.execute("SELECT count(*) AS n FROM findings WHERE scan_id = %s", (scan_id,)).fetchone()["n"] == 1


def test_audit_log_is_append_only(db):
    db.audit(db.org_id, "test.event", "x")
    with pytest.raises(psycopg.errors.RaiseException):
        with db.conn() as c:
            c.execute("DELETE FROM audit_log WHERE action = 'test.event'")


def test_retention_deletes_old_scans_and_archive_bytes(db):
    scan_id = enqueue(db)
    with db.conn() as c:
        c.execute("UPDATE orgs SET retention_days = 7 WHERE id = %s", (db.org_id,))
        c.execute(
            "UPDATE scans SET status = 'succeeded', created_at = now() - interval '8 days' WHERE id = %s", (scan_id,)
        )
        upload_id = c.execute(
            """INSERT INTO uploads (org_id, repo_id, filename, size_bytes, sha256, data, created_at)
               VALUES (%s, %s, 'a.zip', 3, 'x', 'abc', now() - interval '2 days') RETURNING id""",
            (db.org_id, db.repo_id),
        ).fetchone()["id"]
    result = retention.run(db, log=lambda _: None)
    assert result["scans_deleted"] >= 1 and result["upload_bytes_deleted"] >= 1
    with db.conn() as c:
        assert c.execute("SELECT 1 FROM scans WHERE id = %s", (scan_id,)).fetchone() is None
        assert c.execute("SELECT data FROM uploads WHERE id = %s", (upload_id,)).fetchone()["data"] is None
