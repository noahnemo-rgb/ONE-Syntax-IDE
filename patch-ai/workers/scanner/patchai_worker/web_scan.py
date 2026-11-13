"""Live-target scans. Implemented in the live-targets milestone."""

from __future__ import annotations


class TargetError(Exception):
    pass


def run(ctx, db, config, sandbox, workdir):
    raise TargetError("live-target scanning is not enabled on this worker yet")
