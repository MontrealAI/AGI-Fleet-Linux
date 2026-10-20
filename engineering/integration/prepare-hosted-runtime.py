#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Prepare only observed toolcache inputs on disposable hosted qualification VMs."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile


def require(value, message):
    if not value:
        raise RuntimeError(message)


def prepare_file(file, maximum, *, mutable_root=None, executable=False, expected=None):
    require(file.is_absolute() and file.resolve(strict=True) == file, "Physical runtime file required")
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid in (0, os.getuid()), "Trusted regular runtime file required")
        require(before.st_size <= maximum and not before.st_mode & 0o7000, "Runtime file bound or special mode")
        if executable:
            require(before.st_size > 0 and before.st_mode & 0o111, "Executable runtime file required")
        changed = bool(before.st_mode & 0o022)
        if changed:
            require(mutable_root is not None and file.is_relative_to(mutable_root), "Writable input outside hosted toolcache")
            require(before.st_uid == os.getuid() and before.st_nlink == 1, "Exclusive current-owned toolcache input required")
            os.fchmod(fd, stat.S_IMODE(before.st_mode) & ~0o022)
        digest = hashlib.sha256()
        length = 0
        while length <= before.st_size:
            chunk = os.read(fd, min(65536, before.st_size + 1 - length))
            if not chunk:
                break
            length += len(chunk)
            digest.update(chunk)
        after = os.fstat(fd)
        require(length == before.st_size, "Runtime file changed length")
        require(all(getattr(before, key) == getattr(after, key) for key in
                    ("st_dev", "st_ino", "st_uid", "st_size", "st_mtime_ns", "st_nlink")), "Runtime file identity changed")
        require(stat.S_IMODE(after.st_mode) == stat.S_IMODE(before.st_mode) & ~0o022, "Unexpected runtime mode")
        visible = file.lstat()
        require((visible.st_dev, visible.st_ino) == (after.st_dev, after.st_ino), "Runtime pathname changed")
        actual = digest.hexdigest()
        require(expected is None or actual == expected, "Probed runtime bytes changed")
        return {"file": str(file), "bytes": length, "sha256": actual,
                "beforeMode": oct(stat.S_IMODE(before.st_mode)), "afterMode": oct(stat.S_IMODE(after.st_mode)),
                "changed": changed, "ownerAndIdentityUnchanged": True}
    finally:
        os.close(fd)


def main():
    require(os.environ.get("GITHUB_ACTIONS") == "true" and
            os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted" and
            os.environ.get("GITHUB_REPOSITORY") == "MontrealAI/AGI-Fleet-Linux",
            "Disposable hosted Fleet qualification only")
    require(sys.platform == "linux" and sys.version_info[:2] == (3, 12), "Qualified Linux/Python required")
    require(len(sys.argv) == 3, "Application and Alpha source roots required")
    application, alpha_root = (Path(value) for value in sys.argv[1:])
    require(all(value.is_absolute() and value.resolve(strict=True) == value for value in
                (application, alpha_root)), "Physical installed application/source roots required")
    toolcache = Path(os.environ["RUNNER_TOOL_CACHE"]).resolve(strict=True)
    architecture = {"X64": "x64", "ARM64": "arm64"}.get(os.environ.get("RUNNER_ARCH"))
    require(architecture is not None, "Qualified runner architecture required")
    python_root = Path(os.environ["pythonLocation"]).resolve(strict=True)
    require(python_root.parent.parent == toolcache / "Python" and
            python_root.parent.name.startswith("3.12.") and python_root.name == architecture,
            "Official hosted Python prefix required")
    python = Path(sys.executable).resolve(strict=True)
    require(python.is_relative_to(python_root), "Hosted physical interpreter required")
    node_root = toolcache / "node" / "24.21.0" / architecture
    node = Path(shutil.which("node") or "").resolve(strict=True)
    require(node.is_relative_to(node_root) and node_root.resolve(strict=True) == node_root,
            "Pinned hosted Node prefix required")
    records = [prepare_file(node, 128 * 1024 * 1024, mutable_root=node_root, executable=True),
               prepare_file(python, 128 * 1024 * 1024, mutable_root=python_root, executable=True)]
    repository = Path(__file__).resolve().parents[2]
    source = json.loads((repository / "engineering/transformation/source-pins.json").read_text())["computer"]
    launcher = application / "local-runtime/computer/launcher.py"
    require(launcher.resolve(strict=True) == launcher, "Installed physical launcher required")
    cache = Path(tempfile.mkdtemp(prefix="fleet-hosted-probe-cache-"))
    os.chmod(cache, 0o700)
    probe = subprocess.run(
        [str(python), "-I", "-S", "-B", "-X", "pycache_prefix=" + str(cache), str(launcher), "probe"],
        input=json.dumps({"profile": {"alphaRoot": str(alpha_root),
                                     "source": {"commit": source["commit"], "tree": source["tree"]}}}),
        text=True, capture_output=True, timeout=15, check=True)
    require(len(probe.stdout.encode()) <= 2_100_000, "Bounded probe response required")
    files = json.loads(probe.stdout)["files"]
    require(isinstance(files, dict) and 0 < len(files) <= 2048, "Bounded probed runtime closure required")
    for name, expected in sorted(files.items()):
        require(isinstance(name, str) and isinstance(expected, str) and len(expected) == 64 and
                all(char in "0123456789abcdef" for char in expected), "Probed runtime digest required")
        file = Path(name)
        records.append(prepare_file(file, 32_000_000,
                                    mutable_root=python_root if file.is_relative_to(python_root) else None,
                                    expected=expected))
    print(json.dumps({"schema": "agi-fleet/hosted-toolcache-permission-preparation/v1",
                      "scope": "Disposable hosted Node and exactly probed Python runtime files only",
                      "source": {"commit": source["commit"], "tree": source["tree"]},
                      "runtimeGuardsUnchanged": True, "records": records}, indent=2))


if __name__ == "__main__":
    main()
