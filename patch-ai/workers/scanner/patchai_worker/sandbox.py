"""Runs scanner tools in isolation.

Docker mode (production): each tool gets a fresh container with a read-only
root, all capabilities dropped, an unprivileged user, CPU/memory/pid limits and
either no network at all (code scans) or only the internal egress network,
whose sole exit is the egress guard proxy (live-target scans).

Local mode (development/CI): tools run as host processes. Code scans are
wrapped in `unshare -rn`, a new network namespace with no interfaces, when the
kernel allows unprivileged user namespaces.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from .config import Config


class Cancelled(Exception):
    pass


@dataclass
class Mounts:
    src: Path | None = None
    out: Path | None = None
    vulndb: Path | None = None
    rules: Path | None = None

    def container_paths(self) -> dict[str, str]:
        return {"src": "/src", "out": "/out", "vulndb": "/vulndb", "rules": "/rules"}

    def host_paths(self) -> dict[str, str]:
        return {k: str(v) for k, v in vars(self).items() if v is not None}


@dataclass
class ToolResult:
    exit_code: int
    stderr_tail: str
    duration: float


_unshare_ok: bool | None = None


def unshare_available() -> bool:
    global _unshare_ok
    if _unshare_ok is None:
        try:
            _unshare_ok = (
                shutil.which("unshare") is not None
                and subprocess.run(["unshare", "-rn", "true"], capture_output=True, timeout=5).returncode == 0
            )
        except (OSError, subprocess.TimeoutExpired):
            _unshare_ok = False
    return _unshare_ok


class Sandbox:
    def __init__(self, config: Config):
        self.config = config

    @property
    def root(self) -> str:
        """Where the source tree appears to tools, so parsers can make paths relative."""
        return "/src" if self.config.sandbox == "docker" else ""

    def paths(self, mounts: Mounts) -> dict[str, str]:
        return mounts.container_paths() if self.config.sandbox == "docker" else mounts.host_paths()

    def run(
        self,
        name: str,
        argv_template: Sequence[str],
        mounts: Mounts,
        *,
        network: str = "none",
        image: str | None = None,
        env: dict[str, str] | None = None,
        timeout: int | None = None,
        should_stop: Callable[[], bool] = lambda: False,
        log: Callable[[str], None] = lambda _: None,
        user: str | None = "65534:65534",
        out_mount: str = "/out",
        extra_tmpfs: Sequence[str] = (),
    ) -> ToolResult:
        """Runs one tool. `argv_template` may reference {src}, {out}, {vulndb} and {rules}.

        `user=None` keeps the image's own (non-root) user, and `out_mount` moves
        the writable output directory, for images such as ZAP that expect them.
        """
        paths = self.paths(mounts)
        if self.config.sandbox == "docker":
            paths["out"] = out_mount
        argv = [part.format(**paths) for part in argv_template]
        timeout = timeout or self.config.tool_timeout
        env = env or {}

        if self.config.sandbox == "docker":
            container = f"patchai-{name}-{uuid.uuid4().hex[:10]}"
            cmd = [
                "docker", "run", "--rm", "--name", container,
                "--network", "none" if network == "none" else self.config.egress_network,
                "--read-only", "--tmpfs", "/tmp:rw,size=1g",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--pids-limit", "512", "--memory", "2g", "--cpus", "1.5",
            ]
            if user:
                cmd += ["--user", user]
            for path in extra_tmpfs:
                cmd += ["--tmpfs", path]
            for key, host in mounts.host_paths().items():
                target = out_mount if key == "out" else f"/{key}"
                mode = "rw" if key == "out" else "ro"
                cmd += ["-v", f"{host}:{target}:{mode}"]
            for k, v in env.items():
                cmd += ["-e", f"{k}={v}"]
            cmd += [image or self.config.scanner_image, *argv]
            kill = lambda: subprocess.run(["docker", "kill", container], capture_output=True)  # noqa: E731
        else:
            cmd = list(argv)
            if network == "none":
                if unshare_available():
                    cmd = ["unshare", "-rn", *cmd]
                else:
                    log(f"[{name}] warning: no network namespace available; running without network isolation")
            kill = None

        log(f"[{name}] running")
        started = time.monotonic()
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env={**os.environ, **env} if self.config.sandbox != "docker" else None,
            start_new_session=True,
        )
        stderr_chunks: list[bytes] = []
        reader = threading.Thread(target=lambda: stderr_chunks.append(proc.stderr.read()), daemon=True)
        reader.start()
        try:
            while proc.poll() is None:
                if should_stop():
                    self._terminate(proc, kill)
                    raise Cancelled(f"{name} stopped: scan cancelled or platform kill switch engaged")
                if time.monotonic() - started > timeout:
                    self._terminate(proc, kill)
                    raise TimeoutError(f"{name} exceeded its {timeout}s time limit")
                time.sleep(0.5)
        finally:
            reader.join(timeout=5)
        stderr = b"".join(stderr_chunks).decode("utf-8", "replace")
        duration = time.monotonic() - started
        log(f"[{name}] finished with exit code {proc.returncode} in {duration:.1f}s")
        return ToolResult(proc.returncode, stderr[-2000:], duration)

    @staticmethod
    def _terminate(proc: subprocess.Popen, kill: Callable[[], object] | None) -> None:
        if kill:
            kill()
        try:
            os.killpg(proc.pid, 15)
            proc.wait(timeout=10)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, 9)
            except ProcessLookupError:
                pass
