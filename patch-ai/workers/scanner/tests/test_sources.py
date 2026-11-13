import io
import tarfile
import zipfile

import pytest

from patchai_worker.sources import SourceError, extract_tarball, extract_zip


def make_zip(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_extracts_regular_files_and_skips_vendor_dirs(tmp_path):
    data = make_zip({"app/main.py": "print(1)", "node_modules/x/index.js": "x", ".git/config": "x"})
    assert extract_zip(data, tmp_path, max_bytes=10_000, max_files=10) == 1
    assert (tmp_path / "app" / "main.py").read_text() == "print(1)"
    assert not (tmp_path / "node_modules").exists()


@pytest.mark.parametrize("name", ["../evil.py", "/etc/passwd", "a/../../evil.py", "..\\evil.py"])
def test_zip_slip_is_rejected(tmp_path, name):
    with pytest.raises(SourceError):
        extract_zip(make_zip({name: "x"}), tmp_path, max_bytes=10_000, max_files=10)


def test_zip_symlinks_are_skipped(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        info = zipfile.ZipInfo("link")
        info.external_attr = (0o120777 << 16)
        zf.writestr(info, "/etc/passwd")
        zf.writestr("ok.txt", "fine")
    assert extract_zip(buf.getvalue(), tmp_path, max_bytes=10_000, max_files=10) == 1
    assert not (tmp_path / "link").exists()


def test_zip_bomb_ratio_is_rejected(tmp_path):
    with pytest.raises(SourceError):
        extract_zip(make_zip({"bomb.txt": "0" * 5_000_000}), tmp_path, max_bytes=100_000_000, max_files=10)


def test_size_and_file_limits(tmp_path):
    with pytest.raises(SourceError):
        extract_zip(make_zip({"a.txt": "x" * 100, "b.txt": "y" * 100}), tmp_path, max_bytes=150, max_files=10)
    with pytest.raises(SourceError):
        extract_zip(make_zip({f"f{i}.txt": "x" for i in range(5)}), tmp_path / "2", max_bytes=10_000, max_files=3)


def test_invalid_zip(tmp_path):
    with pytest.raises(SourceError):
        extract_zip(b"not a zip", tmp_path, max_bytes=100, max_files=10)


def make_tar(members):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data, kind in members:
            info = tarfile.TarInfo(name)
            if kind == "symlink":
                info.type = tarfile.SYMTYPE
                info.linkname = data
                tar.addfile(info)
            else:
                raw = data.encode()
                info.size = len(raw)
                tar.addfile(info, io.BytesIO(raw))
    return buf.getvalue()


def test_github_tarball_strips_top_dir_and_ignores_links(tmp_path):
    data = make_tar([
        ("owner-repo-abc123/src/app.py", "print(1)", "file"),
        ("owner-repo-abc123/link", "/etc/passwd", "symlink"),
    ])
    assert extract_tarball(data, tmp_path, max_bytes=10_000, max_files=10) == 1
    assert (tmp_path / "src" / "app.py").exists()
    assert not (tmp_path / "link").exists()


def test_tar_traversal_is_rejected(tmp_path):
    data = make_tar([("top/../../evil.py", "x", "file")])
    with pytest.raises(SourceError):
        extract_tarball(data, tmp_path, max_bytes=10_000, max_files=10)
