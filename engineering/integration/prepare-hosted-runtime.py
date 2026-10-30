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


def prepare_prefix(root):
    records = []
    directories = 0
    total = 0

    def walk_error(error):
        raise error

    for current, children, names in os.walk(root, followlinks=False, onerror=walk_error):
        directory = Path(current)
        require(directory.resolve(strict=True) == directory, "Physical toolcache directory required")
        directories += 1
        require(directories <= 8192, "Bounded toolcache directory count required")
        children[:] = [name for name in children if not (directory / name).is_symlink()]
        for name in sorted(names):
            file = directory / name
            # Official interpreter aliases are links; their physical targets are
            # visited independently. Never follow a link while changing modes.
            if file.is_symlink():
                continue
            require(len(records) < 100_000, "Bounded toolcache file count required")
            record = prepare_file(file, 128 * 1024 * 1024, mutable_root=root)
            total += record["bytes"]
            require(total <= 2 * 1024 * 1024 * 1024, "Bounded toolcache byte count required")
            records.append(record)
    require(records, "Nonempty hosted Python prefix required")
    return records


def main():
    require(os.environ.get("GITHUB_ACTIONS") == "true" and
            os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted" and
            os.environ.get("GITHUB_REPOSITORY") == "MontrealAI/AGI-Fleet-Linux",
            "Disposable hosted Fleet qualification only")
    require(sys.platform == "linux" and sys.version_info[:2] == (3, 12), "Qualified Linux/Python required")
    system_python = Path(sys.executable).resolve(strict=True)
    require(system_python == Path("/usr/bin/python3.12") and system_python.stat().st_uid == 0,
            "Trusted system interpreter required before toolcache preparation")
    prepare_file(system_python, 128 * 1024 * 1024, executable=True)
    early = sys.argv[1:] == ["--prepare-only"]
    require(early or len(sys.argv) == 3, "Early preparation or application/source roots required")
    toolcache = Path(os.environ["RUNNER_TOOL_CACHE"]).resolve(strict=True)
    architecture = {"X64": "x64", "ARM64": "arm64"}.get(os.environ.get("RUNNER_ARCH"))
    require(architecture is not None, "Qualified runner architecture required")
    python_root = Path(os.environ["pythonLocation"]).resolve(strict=True)
    require(python_root.parent.parent == toolcache / "Python" and
            python_root.parent.name.startswith("3.12.") and python_root.name == architecture,
            "Official hosted Python prefix required")
    python = python_root / "bin/python3.12"
    require(python.resolve(strict=True) == python, "Physical hosted interpreter required")
    node_root = toolcache / "node" / "24.21.0" / architecture
    node = Path(shutil.which("node") or "").resolve(strict=True)
    require(node.is_relative_to(node_root) and node_root.resolve(strict=True) == node_root,
            "Pinned hosted Node prefix required")
    records = [prepare_file(node, 128 * 1024 * 1024, mutable_root=node_root, executable=True)]
    # Enumerate and protect candidate files using only the trusted system Python.
    # This helper executes no candidate interpreter, module or probe while preparing.
    records.extend(prepare_prefix(python_root))
    prepare_file(python, 128 * 1024 * 1024, executable=True)
    result = {"schema": "agi-fleet/hosted-toolcache-permission-preparation/v1",
              "scope": "Disposable official hosted Node/Python cache only",
              "phase": "before-project-python" if early else "before-installed-probe",
              "runtimeGuardsUnchanged": True, "records": records}
    if early:
        print(json.dumps(result, indent=2))
        return
    application, alpha_root = (Path(value) for value in sys.argv[1:])
    require(all(value.is_absolute() and value.resolve(strict=True) == value for value in
                (application, alpha_root)), "Physical installed application/source roots required")
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
    closure = []
    for name, expected in sorted(files.items()):
        require(isinstance(name, str) and isinstance(expected, str) and len(expected) == 64 and
                all(char in "0123456789abcdef" for char in expected), "Probed runtime digest required")
        # Every returned file must already be protected. This pass cannot repair
        # a writable file or let the probe select new mutable inputs.
        closure.append(prepare_file(Path(name), 32_000_000, expected=expected))
    result.update({"source": {"commit": source["commit"], "tree": source["tree"]},
                   "probedClosure": closure})
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
