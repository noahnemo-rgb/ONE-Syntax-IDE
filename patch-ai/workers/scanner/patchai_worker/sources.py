"""Fetches and safely extracts source code. Archives are untrusted input."""

from __future__ import annotations

import io
import os
import stat
import tarfile
import time
import zipfile
from pathlib import Path, PurePosixPath

import httpx
import jwt

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "vendor"}
MAX_COMPRESSION_RATIO = 200


class SourceError(Exception):
    pass


def _safe_member_path(dest: Path, name: str) -> Path | None:
    """Returns the extraction path, or None to skip. Raises on traversal attempts."""
    posix = PurePosixPath(name.replace("\\", "/"))
    if posix.is_absolute() or any(part == ".." for part in posix.parts):
        raise SourceError(f"archive entry escapes the extraction directory: {name!r}")
    parts = [p for p in posix.parts if p not in ("", ".")]
    if not parts or any(p in SKIP_DIRS for p in parts):
        return None
    target = (dest / Path(*parts)).resolve()
    if not str(target).startswith(str(dest.resolve()) + os.sep):
        raise SourceError(f"archive entry escapes the extraction directory: {name!r}")
    return target


def extract_zip(data: bytes, dest: Path, *, max_bytes: int, max_files: int) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    total = 0
    files = 0
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise SourceError("the upload is not a valid zip archive") from exc
    with archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            mode = (info.external_attr >> 16) & 0o170000
            if mode and not stat.S_ISREG(mode):
                continue  # symlinks, devices, fifos
            target = _safe_member_path(dest, info.filename)
            if target is None:
                continue
            if info.compress_size and info.file_size / max(info.compress_size, 1) > MAX_COMPRESSION_RATIO:
                raise SourceError(f"suspicious compression ratio for {info.filename!r}")
            total += info.file_size
            files += 1
            if total > max_bytes or files > max_files:
                raise SourceError("the archive is too large to scan")
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as src, open(target, "wb") as out:
                written = 0
                while chunk := src.read(1 << 16):
                    written += len(chunk)
                    if written > info.file_size:
                        raise SourceError(f"{info.filename!r} is larger than its header claims")
                    out.write(chunk)
    return files


def extract_tarball(data: bytes, dest: Path, *, max_bytes: int, max_files: int, strip_components: int = 1) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    total = 0
    files = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tar:
        for member in tar:
            if not member.isreg():
                continue
            parts = PurePosixPath(member.name).parts[strip_components:]
            if not parts:
                continue
            target = _safe_member_path(dest, "/".join(parts))
            if target is None:
                continue
            total += member.size
            files += 1
            if total > max_bytes or files > max_files:
                raise SourceError("the repository is too large to scan")
            fh = tar.extractfile(member)
            if fh is None:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with fh, open(target, "wb") as out:
                while chunk := fh.read(1 << 16):
                    out.write(chunk)
    return files


def github_installation_token(app_id: str, private_key: str, installation_id: int) -> str:
    now = int(time.time())
    app_jwt = jwt.encode({"iat": now - 60, "exp": now + 540, "iss": app_id}, private_key, algorithm="RS256")
    res = httpx.post(
        f"https://api.github.com/app/installations/{installation_id}/access_tokens",
        headers={
            "authorization": f"Bearer {app_jwt}",
            "accept": "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
        },
        json={"permissions": {"contents": "read"}},
        timeout=20,
    )
    if res.status_code != 201:
        raise SourceError(f"GitHub refused an installation token ({res.status_code})")
    return res.json()["token"]


def fetch_github_repo(
    *, app_id: str, private_key: str, installation_id: int, full_name: str, ref: str | None, max_bytes: int
) -> tuple[bytes, str]:
    """Downloads a repository tarball. Returns (bytes, commit sha)."""
    token = github_installation_token(app_id, private_key, installation_id)
    headers = {
        "authorization": f"Bearer {token}",
        "accept": "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
    }
    with httpx.Client(headers=headers, timeout=60, follow_redirects=True) as client:
        ref_name = ref or client.get(f"https://api.github.com/repos/{full_name}").json()["default_branch"]
        commit = client.get(f"https://api.github.com/repos/{full_name}/commits/{ref_name}")
        if commit.status_code != 200:
            raise SourceError(f"could not resolve {full_name}@{ref_name} ({commit.status_code})")
        sha = commit.json()["sha"]
        buf = io.BytesIO()
        with client.stream("GET", f"https://api.github.com/repos/{full_name}/tarball/{sha}") as res:
            if res.status_code != 200:
                raise SourceError(f"downloading {full_name} failed ({res.status_code})")
            for chunk in res.iter_bytes():
                buf.write(chunk)
                if buf.tell() > max_bytes:
                    raise SourceError("the repository archive is too large to scan")
        return buf.getvalue(), sha
