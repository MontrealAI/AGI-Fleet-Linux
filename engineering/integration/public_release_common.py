"""Shared bounded custody primitives for the additive public-package consumer.

This module does not qualify a source release. Original release publishers,
source/native gates and independent reviews remain prerequisites.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORIES = {
    "alpha": "MontrealAI/AGI-Alpha-Agent-v0",
    "fleet": "MontrealAI/AGI-Fleet-Linux",
    "jobs": "MontrealAI/AGIJobsv0",
    "manager": "MontrealAI/AGIJobManager",
}
MAX_ASSET = 450_000_000
MAX_EXPANDED = 2_000_000_000
MAX_MEMBERS = 25_000
REF = re.compile(r"refs/heads/qualification/ti-public-packages-([a-f0-9]{40})-([a-f0-9]{64})")

def require(value, message):
    if not value:
        raise ValueError("PUBLIC_PACKAGE: " + message)

def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result

def strict_json(raw):
    require(len(raw) <= 16_000_000, "JSON byte limit")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON")))

def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def save(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("xb") as output:
        output.write(raw)
    path.chmod(0o600)

def digest(file, maximum=MAX_ASSET):
    file = Path(file)
    before = file.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum,
            "bounded physical regular artifact required")
    attributes = ("st_dev", "st_ino", "st_mode", "st_nlink", "st_size",
                  "st_uid", "st_gid", "st_mtime_ns", "st_ctime_ns")
    descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(descriptor)
        require(stat.S_ISREG(opened.st_mode) and opened.st_nlink == 1 and opened.st_size <= maximum
                and all(getattr(before, name) == getattr(opened, name) for name in attributes),
                "artifact changed before descriptor read")
        h, count = hashlib.sha256(), 0
        while True:
            block = os.read(descriptor, min(65536, maximum + 1 - count))
            if not block:
                break
            count += len(block)
            require(count <= maximum, "artifact exceeded bounded read")
            h.update(block)
        after = os.fstat(descriptor)
        require(count == opened.st_size
                and all(getattr(opened, name) == getattr(after, name) for name in attributes),
                "artifact changed during descriptor read")
        return h.hexdigest()
    finally:
        os.close(descriptor)

class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        require(parsed.scheme == "https" and (parsed.hostname in {
            "api.github.com", "github.com", "release-assets.githubusercontent.com",
            "objects.githubusercontent.com", "nodejs.org"
        } or (parsed.hostname or "").endswith(".blob.core.windows.net")), "unexpected artifact redirect origin")
        result = super().redirect_request(request, fp, code, msg, headers, newurl)
        if result is not None and parsed.hostname != urllib.parse.urlsplit(request.full_url).hostname:
            result.remove_header("Authorization")
        return result

OPENER = urllib.request.build_opener(PublicRedirect())

def response(url, *, binary=False):
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == "https" and parsed.hostname in {
        "api.github.com", "github.com", "nodejs.org"
    }, "fixed initial public origin required")
    headers = {"User-Agent": "agi-fleet-final-public-package-consumer",
               "Accept": "application/octet-stream" if binary else "application/vnd.github+json"}
    if parsed.hostname == "api.github.com":
        headers["X-GitHub-Api-Version"] = "2022-11-28"
        token = os.environ.get("GH_TOKEN")
        if token:
            headers["Authorization"] = "Bearer " + token
    return OPENER.open(urllib.request.Request(url, headers=headers), timeout=60)

def api(resource):
    require(resource.startswith("/repos/MontrealAI/") and not any(c in resource for c in "\r\n"),
            "canonical public repository API resource required")
    with response("https://api.github.com" + resource) as stream:
        raw = stream.read(4_000_001)
    require(len(raw) <= 4_000_000, "API JSON limit")
    return strict_json(raw)

def pages(resource, key=None):
    output = []
    separator = "&" if "?" in resource else "?"
    for page in range(1, 101):
        value = api(resource + separator + "per_page=100&page=" + str(page))
        rows = value[key] if key else value
        require(isinstance(rows, list), "API page array required")
        output.extend(rows)
        if len(rows) < 100:
            return output
    raise ValueError("PUBLIC_PACKAGE: API pagination bound")

def download(url, destination, expected_bytes, expected_sha):
    require(type(expected_bytes) is int and 0 < expected_bytes < MAX_ASSET, "asset size bound")
    require(re.fullmatch("[a-f0-9]{64}", expected_sha or ""), "asset SHA256 required")
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), "new asset destination required")
    h = hashlib.sha256()
    count = 0
    with response(url, binary=True) as stream, destination.open("xb") as output:
        for block in iter(lambda: stream.read(65536), b""):
            count += len(block)
            require(count <= expected_bytes, "download exceeded authenticated size")
            h.update(block)
            output.write(block)
    destination.chmod(0o600)
    require(count == expected_bytes and h.hexdigest() == expected_sha, "download bytes differ")
    return {"bytes": count, "sha256": h.hexdigest()}

def git(root, *args, binary=False):
    environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8",
                   "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null",
                   "GIT_CONFIG_NOSYSTEM": "1", "GIT_NO_REPLACE_OBJECTS": "1",
                   "GIT_NO_LAZY_FETCH": "1", "GIT_TERMINAL_PROMPT": "0",
                   "GIT_OPTIONAL_LOCKS": "0"}
    raw = subprocess.check_output(
        ["/usr/bin/git", "--no-replace-objects", "-c", "core.fsmonitor=false",
         "-c", "core.hooksPath=/dev/null", "-C", str(root), *args],
        env=environment, timeout=120)
    require(len(raw) <= MAX_ASSET, "Git output bound")
    return raw if binary else raw.decode("utf-8").strip()

def tree_files(root, commit):
    result = {}
    for row in git(root, "ls-tree", "-r", "-z", commit, binary=True).split(b"\0"):
        if not row:
            continue
        header, raw_name = row.split(b"\t", 1)
        mode, kind, oid = header.decode("ascii").split(" ")
        name = raw_name.decode("utf-8")
        require(kind == "blob" and mode in {"100644", "100755", "120000"},
                "unsupported source tree entry")
        safe_relative(name)
        result[name] = {"mode": mode, "blob": oid}
    require(0 < len(result) <= MAX_MEMBERS, "source tree entry bound")
    return result

def safe_relative(name):
    require(isinstance(name, str) and name and "\0" not in name and "\\" not in name,
            "canonical archive member required")
    value = PurePosixPath(name)
    require(not value.is_absolute() and value.as_posix() == name
            and all(part not in {"", ".", "..", ".git"} for part in value.parts),
            "archive member escapes source")
    return value

def inspect_zip(archive):
    result = {}
    with zipfile.ZipFile(archive) as source:
        require(len(source.infolist()) <= MAX_MEMBERS, "archive entry bound")
        expanded = 0
        for info in source.infolist():
            name = info.filename.rstrip("/") if info.is_dir() else info.filename
            safe_relative(name)
            require(info.filename not in result, "duplicate archive member")
            require(not info.flag_bits & 1, "encrypted member unsupported")
            expanded += info.file_size
            require(info.file_size < MAX_ASSET and expanded < MAX_EXPANDED, "expanded archive bound")
            if info.is_dir():
                continue
            result[info.filename] = info
        # Duplicate directory entries also fail, independently of regular members.
        names = [info.filename for info in source.infolist()]
        require(len(set(names)) == len(names), "duplicate archive path")
    return result

def verify_input_blob(raw, blob_sha, raw_sha, declared_size):
    require(len(raw) == declared_size and declared_size <= 65_536
            and git_blob(raw) == blob_sha and sha(raw) == raw_sha,
            "raw input and Git blob digests")
    return {"gitBlob": blob_sha, "sha256": raw_sha, "bytes": declared_size}

def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()

def source_members(entries, prefix, tracked):
    selected = {name[len(prefix):]: info for name, info in entries.items() if name.startswith(prefix)}
    require(set(selected) == set(tracked), "release source omits or adds Git-tracked files")
    return selected

def source_member_identity(raw, info, expected, role, name):
    require(git_blob(raw) == expected["blob"], "released source differs from Git object")
    declared = info.external_attr >> 16
    if expected["mode"] == "120000":
        require(role == "manager" and name == "hardhat/contracts" and raw == b"../contracts",
                "unreviewed source symlink")
        require(stat.S_ISLNK(declared), "source symlink mode absent")
        effective = stat.S_IFLNK | 0o777
    else:
        require(expected["mode"] in {"100644", "100755"}, "ordinary source mode required")
        effective = stat.S_IFREG | (0o755 if expected["mode"] == "100755" else 0o644)
        require(declared == 0 or declared == effective, "declared source mode differs")
    return declared or None, effective

def genuine_source(repository, identity, archive, prefix, destination, role):
    """Install archive source files; Git supplies provenance, never missing source."""
    require(repository == REPOSITORIES[role] and role != "fleet", "source repository role")
    destination = Path(destination).absolute()
    require(not destination.exists() and destination.parent.resolve() == destination.parent,
            "new physical standalone source destination")
    subprocess.run(
        ["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "clone",
         "--no-hardlinks", "--no-checkout", "--", "https://github.com/" + repository + ".git",
         str(destination)], check=True, timeout=600,
        env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "GIT_CONFIG_NOSYSTEM": "1",
             "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null",
             "GIT_TERMINAL_PROMPT": "0"})
    metadata = destination / ".git"
    require(metadata.is_dir() and not metadata.is_symlink()
            and not (metadata / "shallow").exists()
            and not (metadata / "objects/info/alternates").exists(),
            "complete independent genuine Git metadata required")
    commit, tree = identity["commit"], identity["tree"]
    require(git(destination, "rev-parse", commit + "^{commit}") == commit
            and git(destination, "rev-parse", commit + "^{tree}") == tree, "released Git identity")
    tracked = tree_files(destination, commit)
    entries = inspect_zip(archive)
    selected = source_members(entries, prefix, tracked)
    require(all(not (destination / name).exists() for name in tracked), "source worktree must be absent")
    # Detach HEAD and populate only the authentic index. No checkout writes source.
    git(destination, "update-ref", "--no-deref", "HEAD", commit)
    git(destination, "read-tree", commit)
    observations = []
    with zipfile.ZipFile(archive) as source:
        for name, expected in sorted(tracked.items()):
            info = selected[name]
            raw = source.read(info)
            declared, effective = source_member_identity(raw, info, expected, role, name)
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            if expected["mode"] == "120000":
                target.symlink_to("../contracts", target_is_directory=True)
            else:
                with target.open("xb") as output:
                    output.write(raw)
                target.chmod(stat.S_IMODE(effective))
            observations.append({"path": name, "gitBlob": expected["blob"], "sha256": sha(raw),
                                 "bytes": len(raw), "archiveMode": declared or None,
                                 "installedMode": effective})
    require(git(destination, "status", "--porcelain", "--untracked-files=all") == "",
            "materialized release source is not an exact clean Git tree")
    return {"repository": repository, "commit": commit, "tree": tree,
            "source": "ACTUAL_PUBLIC_SOURCE_PACKAGE_BYTES",
            "git": "GENUINE_CLONED_OBJECTS_AND_INDEX_NO_CHECKOUT_SOURCE_FILLING",
            "files": observations}
