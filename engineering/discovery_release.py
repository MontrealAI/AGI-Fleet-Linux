# SPDX-License-Identifier: Apache-2.0
"""Build and install the separate, inert Discovery local-review package.

The published Dedicated Fleet and Local Skills builders remain unchanged.
The fixed source profile must be frozen before this entry point can build.
"""
from __future__ import annotations

import argparse
import configparser
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "discovery-lab/release/profile.json"
VERSION = "0.1.0-discovery-preview.1"
PREFIX = "agi-fleet-discovery-" + VERSION
MANIFEST = "discovery-installed-manifest.json"
MAX_MEMBER = 2_000_000
MAX_TOTAL = 16_000_000
FLEET_FILES = (
    "discovery-lab/contract.mjs",
    "discovery-lab/receiver.mjs",
    "discovery-lab/release/installed-review.mjs",
    "discovery-lab/release/qualify-installed.mjs",
    "discovery-lab/release/module-closure.mjs",
    "discovery-lab/release/profile.json",
    "discovery-lab/release/mission-input.json",
    "discovery-lab/release/README.md",
    "discovery-lab/release/PUBLICATION.md",
    "discovery-lab/release/LICENSE-APACHE-2.0.txt",
    "discovery-lab/release/NOTICE.md",
    "LICENSE",
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_name(value: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Unsafe package member")
    path = PurePosixPath(value)
    if str(path) != value or not path.parts or path.is_absolute() or ".." in path.parts:
        raise ValueError("Unsafe package member")
    return value


def nonconflicting_names(names: set[str]) -> None:
    """Require regular-file paths that can all coexist before creating output."""
    for name in names:
        for parent in PurePosixPath(name).parents:
            if str(parent) in names:
                raise ValueError("Package file paths conflict")


def git_environment() -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_OPTIONAL_LOCKS="0", GIT_PAGER="cat",
               GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1", GIT_ALLOW_PROTOCOL="",
               GIT_PROTOCOL_FROM_USER="0", GIT_TERMINAL_PROMPT="0")
    return env


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(root), "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
         "-c", "protocol.allow=never", *args],
        env=git_environment(), text=True, stderr=subprocess.PIPE,
    ).strip()


def clean_git_root(root: Path) -> tuple[str, str]:
    """Reject local Git execution hooks before any status operation."""
    root = root.resolve(strict=True)
    metadata = root / ".git"
    if metadata.is_symlink() or not (metadata.is_dir() or metadata.is_file()):
        raise ValueError("An actual Git worktree root with local metadata is required")
    audit_worktree_config(metadata)
    # rev-parse does not refresh the index or invoke attribute filters.
    if Path(git(root, "rev-parse", "--show-toplevel")).resolve() != root:
        raise ValueError("An actual Git worktree root is required")
    for scope in ("--local", "--worktree"):
        config = git(root, "config", scope, "--includes", "--null", "--list")
        for item in config.split("\0"):
            key = item.split("\n", 1)[0].lower()
            if key.startswith(("filter.", "include.", "includeif.", "alias.")) or key in {
                "core.fsmonitor", "core.attributesfile", "core.sshcommand", "diff.external", "extensions.partialclone",
            } or key.startswith("diff.") and key.endswith((".command", ".textconv")):
                raise ValueError("Unsafe local Git execution/configuration")
            if key.startswith("remote.") and key.endswith((".promisor", ".partialclonefilter")):
                raise ValueError("Partial clone metadata is outside the offline source profile")
    if git(root, "status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Source checkout must be unchanged")
    return git(root, "rev-parse", "HEAD"), git(root, "rev-parse", "HEAD^{tree}")


def metadata_text(path: Path, limit: int = 64_000) -> str:
    """Read bounded regular Git metadata without asking Git to interpret it."""
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ValueError("Unsafe local Git metadata")
        data = os.read(descriptor, limit + 1)
        after = os.fstat(descriptor)
        if len(data) != before.st_size or any(getattr(before, key) != getattr(after, key)
                for key in ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")):
            raise ValueError("Unsafe local Git metadata capture")
        return data.decode("utf-8", errors="strict")
    finally:
        os.close(descriptor)


def audit_worktree_config(metadata: Path) -> None:
    """Prove worktree config is inactive before the first Git subprocess."""
    gitdir = metadata
    if metadata.is_file():
        pointer = metadata_text(metadata, 4096)
        if not pointer.startswith("gitdir: ") or len(pointer.splitlines()) != 1:
            raise ValueError("Unsafe local Git directory pointer")
        target = Path(pointer.removeprefix("gitdir: ").strip())
        gitdir = (metadata.parent / target).resolve(strict=True)
    common = gitdir
    common_file = gitdir / "commondir"
    if common_file.exists():
        pointer = metadata_text(common_file, 4096)
        if len(pointer.splitlines()) != 1 or not pointer.strip():
            raise ValueError("Unsafe local Git common directory pointer")
        common = (gitdir / pointer.strip()).resolve(strict=True)
    parser = configparser.RawConfigParser(allow_no_value=True, strict=True)
    try:
        parser.read_string(metadata_text(common / "config"))
    except (configparser.Error, UnicodeError) as error:
        raise ValueError("Unsafe local Git main configuration") from error
    if len([section for section in parser.sections() if section.lower().split()[0] == "gc"]) > 1:
        raise ValueError("Unsafe local Git duplicate garbage-collection configuration")
    for section in parser.sections():
        base = section.lower().split()[0]
        if base in {"include", "includeif"}:
            raise ValueError("Unsafe local Git included configuration")
        if base == "gc" and (section.lower() != "gc" or set(parser.options(section)) != {"auto"}
                             or parser.get(section, "auto") != "0"):
            raise ValueError("Unsafe local Git garbage-collection configuration")
        if section.lower() == "extensions" and any(not re.fullmatch(r"[a-z][a-z0-9-]*", key)
                                                    for key in parser.options(section)):
            raise ValueError("Unsafe local Git worktree configuration syntax")
        if section.lower() == "extensions" and parser.has_option(section, "worktreeconfig"):
            value = parser.get(section, "worktreeconfig")
            if value is None or value.strip().lower() not in {"false", "no", "off", "0", '"false"', '"no"', '"off"', '"0"'}:
                raise ValueError("Unsafe local Git worktree configuration activation")
    # checkout@v4/v5 on newer Git can leave this ignored file after disabling the
    # extension. No global/system/GIT environment can activate it in git_environment.
    worktree = gitdir / "config.worktree"
    if worktree.exists() or worktree.is_symlink():
        metadata_text(worktree)  # Require bounded regular bytes; do not load it as active config.


def load_profile(path: Path = PROFILE) -> dict:
    profile = json.loads(regular_bytes(path.parent, path.name)[0])
    if profile.get("schema") != "agi-fleet/discovery-installed-profile/v1" or profile.get("version") != VERSION:
        raise ValueError("Unsupported installed profile")
    if profile.get("qualification") != "FROZEN_SOURCE_PROFILE" or not isinstance(profile.get("alpha"), dict):
        raise ValueError("Final reviewed Alpha source pin is not frozen; package build is held")
    if profile.get("authority") != "none" or profile.get("productionQualified") is not False:
        raise ValueError("Installed finite profile cannot grant authority or production qualification")
    return profile


def regular_bytes(root: Path, name: str) -> tuple[bytes, int]:
    safe_name(name)
    path = root / name
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Package source must be a contained regular file: " + name)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_MEMBER:
            raise ValueError("Package source must be a bounded regular file")
        captured = bytearray()
        while len(captured) < MAX_MEMBER + 1:
            chunk = os.read(descriptor, MAX_MEMBER + 1 - len(captured))
            if not chunk:
                break
            captured.extend(chunk)
        if len(captured) > MAX_MEMBER or len(captured) != before.st_size:
            raise ValueError("Package source changed beyond its captured size or input bound")
        after = os.fstat(descriptor)
        if any(getattr(before, key) != getattr(after, key)
               for key in ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")):
            raise ValueError("Package source changed during its owned capture")
        return bytes(captured), 0o755 if before.st_mode & 0o111 else 0o644
    finally:
        os.close(descriptor)


def verify_alpha(root: Path, alpha: dict, parser_source: bytes) -> dict[str, tuple[bytes, int]]:
    commit, tree = clean_git_root(root)
    if (commit, tree) != (alpha["commit"], alpha["tree"]):
        raise ValueError("Wrong Alpha source identity")
    entries = {}
    for name, binding in alpha["files"].items():
        data, mode = regular_bytes(root, name)
        raw_blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if (sha(data) != binding["sha256"] or raw_blob != binding["gitBlob"]
                or git(root, "rev-parse", "HEAD:" + name) != raw_blob):
            raise ValueError("Alpha source differs from frozen profile: " + name)
        git_mode = git(root, "ls-tree", "HEAD", "--", name).split()[0]
        if git_mode != binding["mode"] or git_mode != ("100755" if mode == 0o755 else "100644"):
            raise ValueError("Alpha source mode differs from frozen profile: " + name)
        entries["alpha/" + name] = (data, mode)
    catalog = json.loads(entries["alpha/docs/successor/capabilities/sources.json"][0])
    encoded = json.dumps(catalog["sources"], sort_keys=True, separators=(",", ":")).encode()
    if sha(encoded) != alpha["sourceHash"] or catalog["sourceHash"] != alpha["sourceHash"]:
        raise ValueError("Alpha catalog identity differs")
    if set(catalog["sources"]) - set(alpha["files"]):
        raise ValueError("Alpha catalog source closure is incomplete")
    for name, digest in catalog["sources"].items():
        if sha(entries["alpha/" + name][0]) != digest:
            raise ValueError("Alpha catalog does not reproduce installed bytes")
    node = shutil.which("node")
    if not node:
        raise ValueError("Node is required for parse-only module dependency inspection")
    parser_input = [{"name": name.removeprefix("alpha/"), "source": data.decode()}
                    for name, (data, _) in entries.items() if name.endswith(".mjs")]
    env = {**os.environ, "NODE_OPTIONS": "", "NODE_PATH": ""}
    parsed = subprocess.run([node, "--no-warnings", "--max-old-space-size=128", "--experimental-vm-modules",
                             "--input-type=module", "--eval", parser_source.decode(), "--", "--parse-module-map"],
                            input=json.dumps(parser_input).encode(), capture_output=True, timeout=5, env=env, check=True)
    if len(parsed.stdout) > 1_000_000 or len(parsed.stderr) > 1_000_000:
        raise ValueError("Module parser output exceeds bound")
    imports = {item["name"]: item["requests"] for item in json.loads(parsed.stdout)}
    seen = set()

    def visit(name: str) -> None:
        if name in seen:
            return
        seen.add(name)
        if "alpha/" + name not in entries:
            raise ValueError("Missing fixed Alpha import: " + name)
        if name not in imports:
            raise ValueError("Missing parsed fixed module: " + name)
        for specifier in imports[name]:
            if not specifier.startswith(("./", "../")):
                raise ValueError("Only fixed local Alpha imports are admitted")
            next_path = (root / PurePosixPath(name).parent / specifier).resolve()
            if not next_path.is_relative_to(root.resolve()):
                raise ValueError("Alpha import escapes root")
            visit(next_path.relative_to(root).as_posix())

    for name in ("workspace.mjs", "discovery-lab-history.mjs", "discovery-lab-inspector.mjs"):
        visit("examples/successor-capability/" + name)
    return entries


def freeze_source(alpha_root: Path, expected_commit: str, *, root: Path = ROOT) -> dict:
    """Freeze reviewed source only; no installed or publication qualification."""
    if not re.fullmatch(r"[0-9a-f]{40}", expected_commit):
        raise ValueError("An exact reviewed Alpha commit is required")
    clean_git_root(root)
    profile_path = root / "discovery-lab/release/profile.json"
    profile = json.loads(regular_bytes(root, "discovery-lab/release/profile.json")[0])
    if (profile.get("schema") != "agi-fleet/discovery-installed-profile/v1"
            or profile.get("version") != VERSION or profile.get("qualification") != "PENDING_FINAL_ALPHA_PIN"
            or profile.get("alpha") is not None or profile.get("authority") != "none"
            or profile.get("productionQualified") is not False):
        raise ValueError("Only the unchanged pending source profile can be frozen")
    commit, tree = clean_git_root(alpha_root)
    if commit != expected_commit:
        raise ValueError("Reviewed Alpha source identity differs")
    catalog_name = "docs/successor/capabilities/sources.json"
    catalog = json.loads(regular_bytes(alpha_root, catalog_name)[0])
    names = set(catalog["sources"]) | {catalog_name, "docs/successor/capabilities/index.html",
                                      "examples/successor-capability/discovery-lab-inspector.mjs", "LICENSE"}
    if len(names) > 256:
        raise ValueError("Alpha source profile exceeds member bound")
    bindings = {}
    for name in sorted(names):
        data, mode = regular_bytes(alpha_root, name)
        blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        bindings[name] = {"sha256": sha(data), "gitBlob": blob, "mode": "100755" if mode == 0o755 else "100644"}
    shared = bindings["examples/successor-capability/discovery-lab-contract.mjs"]["sha256"]
    if sha(regular_bytes(root, "discovery-lab/contract.mjs")[0]) != shared:
        raise ValueError("Fleet and Alpha shared contracts differ")
    if regular_bytes(alpha_root, "LICENSE")[0] != regular_bytes(root, "discovery-lab/release/LICENSE-APACHE-2.0.txt")[0]:
        raise ValueError("Alpha license differs from the enclosed Apache text")
    alpha = {"commit": commit, "tree": tree, "sourceHash": catalog["sourceHash"],
             "sharedContractSha256": shared, "files": bindings}
    # The bounded parser checks every static form. verify_alpha additionally binds
    # each captured file/mode to unreplaced local Git before the profile is written.
    verify_alpha(alpha_root, alpha, regular_bytes(root, "discovery-lab/release/module-closure.mjs")[0])
    profile.update(qualification="FROZEN_SOURCE_PROFILE", alpha=alpha)
    profile_path.write_text(json.dumps(profile, indent=2) + "\n")
    return {"commit": commit, "tree": tree, "sourceHash": alpha["sourceHash"], "files": len(bindings),
            "qualification": "source-profile-only; saved-native-and-release-gates-pending"}


def build(output: Path, alpha_root: Path, *, root: Path = ROOT, mission_input: Path | None = None) -> dict:
    profile = load_profile(root / "discovery-lab/release/profile.json")
    commit, tree = clean_git_root(root)
    output = output.resolve()
    if output.exists() or output.is_relative_to(root.resolve()) or output.is_relative_to(alpha_root.resolve()):
        raise ValueError("Use an absent output directory outside both source checkouts")
    entries = {name: regular_bytes(root, name) for name in FLEET_FILES}
    for name, (data, mode) in entries.items():
        blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if git(root, "rev-parse", "HEAD:" + name) != blob:
            raise ValueError("Fleet package file is not the committed source: " + name)
        record = git(root, "ls-tree", "HEAD", "--", name).split()
        if not record or record[0] != ("100755" if mode == 0o755 else "100644"):
            raise ValueError("Fleet package executable mode differs from Git")
    entries.update(verify_alpha(alpha_root, profile["alpha"], entries["discovery-lab/release/module-closure.mjs"][0]))
    if entries["alpha/LICENSE"][0] != entries["discovery-lab/release/LICENSE-APACHE-2.0.txt"][0]:
        raise ValueError("Alpha license differs from the enclosed Apache text")
    shared = profile["alpha"]["sharedContractSha256"]
    if (sha(entries["discovery-lab/contract.mjs"][0]) != shared
            or sha(entries["alpha/examples/successor-capability/discovery-lab-contract.mjs"][0]) != shared):
        raise ValueError("Fleet and Alpha shared contracts differ from the frozen profile")
    import discovery_alpha_input as original_input
    original_input.profile(entries["discovery-lab/release/mission-input.json"][0], profile["alpha"])
    if mission_input is None:
        raise ValueError("One authenticated original Alpha mission capture is required")
    entries.update(original_input.captured_entries(mission_input, entries["discovery-lab/release/mission-input.json"][0], profile["alpha"]))
    records = [{"path": name, "bytes": len(data), "sha256": sha(data), "mode": mode}
               for name, (data, mode) in sorted(entries.items())]
    if sum(row["bytes"] for row in records) > MAX_TOTAL:
        raise ValueError("Package exceeds total bound")
    manifest = {"schema": "agi-fleet/discovery-installed-package/v1", "version": VERSION,
                "source": {"repository": "MontrealAI/AGI-Fleet-Linux", "commit": commit, "tree": tree},
                "profileSha256": sha(entries["discovery-lab/release/profile.json"][0]), "files": records,
                "qualification": "unqualified-saved-candidate", "authority": "none",
                "remoteExecution": "unprovisioned", "productionQualified": False}
    entries[MANIFEST] = ((json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode(), 0o644)
    output.mkdir(mode=0o700)
    archive = output / (PREFIX + ".zip")
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as z:
        for name, (data, mode) in sorted(entries.items()):
            info = zipfile.ZipInfo(PREFIX + "/" + name, date_time=(2026, 10, 22, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    receipt = {"schema": "agi-fleet/discovery-package-receipt/v1", "archive": archive.name,
               "bytes": archive.stat().st_size, "sha256": sha(archive.read_bytes()),
               "manifestSha256": sha(entries[MANIFEST][0]), "source": manifest["source"],
               "qualification": "unqualified-saved-candidate", "operatorService": False, "authority": "none"}
    (output / "package-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


def install(archive: Path, destination: Path, expected_sha256: str) -> dict:
    """Verify every saved byte before extracting into a new inactive directory."""
    if archive.stat().st_size > MAX_TOTAL + 1_000_000 or sha(archive.read_bytes()) != expected_sha256:
        raise ValueError("Archive differs from the independently obtained checksum")
    destination = destination.resolve()
    if destination.exists():
        raise ValueError("Installation destination must be absent")
    entries = {}
    with zipfile.ZipFile(archive) as z:
        infos = z.infolist()
        if (len(infos) > 256 or any(info.file_size > MAX_MEMBER for info in infos)
                or sum(info.file_size for info in infos) > MAX_TOTAL):
            raise ValueError("Invalid or oversized archive")
        if len({info.filename for info in infos}) != len(infos):
            raise ValueError("Duplicate package member")
        for info in infos:
            name = safe_name(info.filename)
            if not name.startswith(PREFIX + "/"):
                raise ValueError("Wrong package root")
            relative = safe_name(name.removeprefix(PREFIX + "/"))
            mode = info.external_attr >> 16
            if relative in entries or stat.S_IFMT(mode) != stat.S_IFREG or info.file_size > MAX_MEMBER:
                raise ValueError("Duplicate, linked or oversized package member")
            entries[relative] = (z.read(info), stat.S_IMODE(mode))
    if sum(len(data) for data, _ in entries.values()) > MAX_TOTAL:
        raise ValueError("Package exceeds total bound")
    nonconflicting_names(set(entries))
    manifest = json.loads(entries.pop(MANIFEST)[0])
    if manifest.get("schema") != "agi-fleet/discovery-installed-package/v1" or manifest.get("version") != VERSION:
        raise ValueError("Unsupported package manifest")
    if (manifest.get("authority") != "none" or manifest.get("productionQualified") is not False
            or manifest.get("remoteExecution") != "unprovisioned"):
        raise ValueError("Installed package cannot claim authority or production qualification")
    records = manifest["files"]
    if len({row["path"] for row in records}) != len(records) or set(entries) != {row["path"] for row in records}:
        raise ValueError("Package membership differs from manifest")
    for row in records:
        data, mode = entries[row["path"]]
        if mode not in {0o644, 0o755} or (len(data), sha(data), mode) != (row["bytes"], row["sha256"], row["mode"]):
            raise ValueError("Package bytes or executable mode differ")
    if sha(entries["discovery-lab/release/profile.json"][0]) != manifest["profileSha256"]:
        raise ValueError("Installed profile differs")
    destination.mkdir(mode=0o700)
    for name, (data, mode) in entries.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        target.chmod(mode)
    (destination / MANIFEST).write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    return {"installed": str(destination), "files": len(records), "startedServices": 0,
            "authority": "none", "remoteExecution": "unprovisioned", "qualification": "bytes-verified-only"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    package = commands.add_parser("build")
    package.add_argument("--alpha-root", type=Path, required=True)
    package.add_argument("--output", type=Path, required=True)
    package.add_argument("--mission-input", type=Path, required=True)
    freeze = commands.add_parser("freeze-source")
    freeze.add_argument("--alpha-root", type=Path, required=True)
    freeze.add_argument("--expected-commit", required=True)
    unpack = commands.add_parser("install")
    unpack.add_argument("--archive", type=Path, required=True)
    unpack.add_argument("--destination", type=Path, required=True)
    unpack.add_argument("--sha256", required=True)
    args = parser.parse_args()
    if args.command == "freeze-source":
        result = freeze_source(args.alpha_root, args.expected_commit)
    elif args.command == "build":
        result = build(args.output, args.alpha_root, mission_input=args.mission_input)
    else:
        result = install(args.archive, args.destination, args.sha256)
    print(json.dumps(result))
