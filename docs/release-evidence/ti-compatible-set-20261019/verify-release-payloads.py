#!/usr/bin/env python3
"""Observe public Alpha release bytes and an existing normal Linux installation.

Read-only verifier: never imports Alpha, installs packages, signs, or changes releases.
A successful receipt covers actual wheel payload files, not every tracked source file.
"""
from __future__ import annotations

import argparse
import base64
import csv
import email.parser
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import stat
import subprocess
import sys
import time
import tomllib
import urllib.parse
import urllib.request
import zipfile

REPO = "MontrealAI/AGI-Alpha-Agent-v0"
HELPER = "docs/release-evidence/ti-compatible-set-20261019/verify-release-payloads.py"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
LIMIT = 64 * 1024 * 1024
MEMBER_LIMIT = 16 * 1024 * 1024
EXECUTABLE_LIMIT = 128 * 1024 * 1024
TOTAL_LIMIT = 128 * 1024 * 1024
LEGACY_MODES = frozenset((
    "alpha_factory_v1/demos/alpha_agi_business_v1/scripts/setup_config.py",
    "alpha_factory_v1/demos/alpha_agi_insight_v0/official_demo.py",
    "alpha_factory_v1/demos/alpha_agi_insight_v1/tools/export_tree.py",
))
HOSTS = frozenset(("api.github.com", "github.com", "release-assets.githubusercontent.com",
                  "objects.githubusercontent.com", "github-releases.githubusercontent.com"))

def require(value, code):
    if not value:
        raise ValueError(code)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")

def sha(data):
    return hashlib.sha256(data).hexdigest()

def blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def relative(name):
    require(isinstance(name, str) and name and "\\" not in name
            and not any(ord(c) < 32 or ord(c) == 127 for c in name), "UNSAFE_NAME")
    path = PurePosixPath(name)
    require(not path.is_absolute() and all(p not in ("", ".", "..") for p in name.split("/")),
            "UNSAFE_NAME")
    return path

def regular_bytes(path, cap=MEMBER_LIMIT):
    path = Path(path)
    for parent in reversed(path.absolute().parents):
        require(not parent.is_symlink(), "LINKED_PARENT")
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and 0 <= before.st_size <= cap, "FILE_BOUND")
        chunks, remaining = [], before.st_size + 1
        while remaining:
            data = os.read(fd, min(65536, remaining))
            if not data:
                break
            chunks.append(data)
            remaining -= len(data)
        data = b"".join(chunks)
        after = os.fstat(fd)
        fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")
        require(len(data) == before.st_size and all(getattr(before, f) == getattr(after, f)
                for f in fields), "FILE_CHANGED")
        return data, stat.S_IMODE(before.st_mode)
    finally:
        os.close(fd)

def runtime_identity():
    data, mode = regular_bytes(Path(sys.executable).resolve(strict=True), EXECUTABLE_LIMIT)
    require(mode & 0o111, "PYTHON_EXECUTABLE_MODE")
    return {"pythonVersion": sys.version.split()[0], "platform": sys.platform,
            "architecture": os.uname().machine, "executableBytes": len(data),
            "executableSha256": sha(data), "executableMode": format(mode, "04o"),
            "boundary": "OWNER_TRUSTED_INTERPRETER_STDLIB_TLS_GIT"}

def git(root, *args, cap=LIMIT):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull})
    process = subprocess.Popen(["git", "--no-replace-objects", "-c", "core.fsmonitor=false",
        "-c", "core.hooksPath=" + os.devnull, "-C", str(root), *args],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 30
    reader = selectors.DefaultSelector()
    try:
        os.set_blocking(process.stdout.fileno(), False)
        reader.register(process.stdout, selectors.EVENT_READ)
        chunks, received = [], 0
        while True:
            remaining = deadline - time.monotonic()
            require(remaining > 0, "GIT_DEADLINE")
            if not reader.select(min(remaining, 0.25)):
                continue
            try:
                chunk = os.read(process.stdout.fileno(), min(65536, cap + 1 - received))
            except BlockingIOError:
                continue
            if not chunk:
                break
            received += len(chunk)
            require(received <= cap, "GIT_BOUND")
            chunks.append(chunk)
        remaining = deadline - time.monotonic()
        require(remaining > 0 and process.wait(timeout=remaining) == 0, "GIT_READ")
        return b"".join(chunks)
    finally:
        # Closing our read end is bounded even if some other process retains a writer.
        # This is a Git read deadline, not a claim of descendant containment.
        reader.close()
        process.stdout.close()
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)

def tree(root, commit):
    require(HEX40.fullmatch(commit), "COMMIT_REQUIRED")
    require(git(root, "rev-parse", "--verify", commit + "^{commit}", cap=128).strip().decode() == commit,
            "COMMIT_CHANGED")
    rows = {}
    for raw in git(root, "ls-tree", "-rz", "--full-tree", commit).split(b"\0"):
        if not raw:
            continue
        header, name = raw.split(b"\t", 1)
        mode, kind, identity = header.decode("ascii").split()
        name = name.decode("utf-8")
        relative(name)
        require(name not in rows, "DUPLICATE_GIT_PATH")
        rows[name] = (mode, kind, identity)
    return rows

def git_bytes(root, rows, name):
    require(name in rows and rows[name][0] in ("100644", "100755") and rows[name][1] == "blob",
            "GIT_REGULAR_FILE_REQUIRED")
    data = git(root, "cat-file", "blob", rows[name][2], cap=MEMBER_LIMIT)
    require(blob_sha(data) == rows[name][2], "GIT_BLOB_CHANGED")
    return data

class PublicRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, url):
        parsed = urllib.parse.urlsplit(url)
        require(parsed.scheme == "https" and parsed.hostname in HOSTS
                and parsed.username is None and parsed.password is None, "PUBLIC_REDIRECT")
        return super().redirect_request(request, fp, code, msg, headers, url)

def public_get(url, cap, accept="application/vnd.github+json"):
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == "https" and parsed.hostname in HOSTS
            and parsed.username is None and parsed.password is None, "PUBLIC_URL")
    # Public endpoints only. No credential/header is forwarded to asset redirects.
    request = urllib.request.Request(url, headers={"Accept": accept,
        "User-Agent": "alpha-public-release-payload-observer", "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.build_opener(PublicRedirects()).open(request, timeout=60) as response:
        require(response.status == 200, "PUBLIC_HTTP")
        data = response.read(cap + 1)
        require(len(data) <= cap, "DOWNLOAD_BOUND")
        return data

def api(path):
    raw = public_get("https://api.github.com/repos/" + REPO + "/" + path, 8 * 1024 * 1024)
    return json.loads(raw), {"bytes": len(raw), "sha256": sha(raw)}

def authenticate(contract):
    require(set(contract) == {"schema", "repository", "release", "assets", "attestationEvidence", "verifier"}, "INPUT_KEYS")
    require(contract.get("schema") == "alpha-release-payload-input/v1"
            and contract.get("repository") == REPO, "INPUT_SCHEMA")
    release = contract["release"]
    require(set(release) == {"id", "tag", "commit", "tree", "version"}, "RELEASE_KEYS")
    require(type(release["id"]) is int and release["id"] > 0
            and HEX40.fullmatch(release["commit"]) and HEX40.fullmatch(release["tree"])
            and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", release["version"])
            and release["tag"] == "v" + release["version"], "FINAL_RELEASE_IDENTITY")
    actual, release_raw = api("releases/" + str(release["id"]))
    require(actual["id"] == release["id"] and actual["tag_name"] == release["tag"]
            and actual["draft"] is False and actual["published_at"]
            and actual["prerelease"] is False and actual.get("immutable") is True, "IMMUTABLE_PUBLIC_RELEASE_REQUIRED")
    release_raw["observedImmutable"] = actual["immutable"]
    ref, ref_raw = api("git/ref/tags/" + urllib.parse.quote(release["tag"], safe=""))
    target = ref["object"]
    tag_objects = [ref_raw]
    for _ in range(8):
        if target["type"] == "commit":
            break
        require(target["type"] == "tag" and HEX40.fullmatch(target["sha"]), "TAG_TYPE")
        annotated, identity = api("git/tags/" + target["sha"])
        tag_objects.append(identity)
        target = annotated["object"]
    require(target["type"] == "commit" and target["sha"] == release["commit"], "TAG_COMMIT")
    commit, commit_raw = api("git/commits/" + release["commit"])
    require(commit["sha"] == release["commit"] and commit["tree"]["sha"] == release["tree"],
            "RELEASE_TREE")
    declared = contract["assets"]
    require(set(declared) == {"wheel", "requirements", "checksums"}, "ASSET_ROLES")
    names = {"wheel": "alpha_factory_v1-" + release["version"] + "-py3-none-any.whl",
             "requirements": "requirements-agent.lock", "checksums": "SHA256SUMS"}
    assets, ids = {}, set()
    for role, expected in declared.items():
        require(set(expected) == {"id", "name", "bytes", "sha256"}, "ASSET_KEYS")
        require(type(expected["id"]) is int and expected["id"] > 0 and expected["id"] not in ids
                and expected["name"] == names[role] and HEX64.fullmatch(expected["sha256"])
                and type(expected["bytes"]) is int and 0 < expected["bytes"] <= LIMIT, "ASSET_INPUT")
        ids.add(expected["id"])
        matches = [x for x in actual["assets"] if x["id"] == expected["id"]]
        require(len(matches) == 1, "ASSET_ID")
        value = matches[0]
        require(value["name"] == expected["name"] and value["size"] == expected["bytes"]
                and value["digest"] == "sha256:" + expected["sha256"], "ASSET_METADATA")
        prefix = "https://github.com/" + REPO + "/releases/download/" + release["tag"] + "/"
        require(value["browser_download_url"] == prefix + urllib.parse.quote(value["name"]), "ASSET_URL")
        assets[role] = value
    attestation = contract.get("attestationEvidence")
    require(isinstance(attestation, dict) and set(attestation) == {"classification", "sourceCommit", "wheelSha256", "publicUrl"}
            and attestation.get("sourceCommit") == release["commit"]
            and attestation.get("wheelSha256") == declared["wheel"]["sha256"]
            and attestation.get("classification") == "EXTERNAL_PUBLISHER_VERIFICATION_REFERENCE"
            and isinstance(attestation.get("publicUrl"), str)
            and attestation["publicUrl"].startswith("https://github.com/" + REPO + "/"), "ATTESTATION_REFERENCE")
    return assets, {"release": release_raw, "tagObjects": tag_objects, "commit": commit_raw}

def verifier_custody(contract, root, input_path, input_raw, context):
    identity = contract["verifier"]
    require(set(identity) == {"commit", "gitBlob", "sha256", "workflowGitBlob"}
            and HEX40.fullmatch(identity["commit"]) and HEX40.fullmatch(identity["gitBlob"])
            and HEX40.fullmatch(identity["workflowGitBlob"]) and HEX64.fullmatch(identity["sha256"]), "VERIFIER_IDENTITY")
    root = Path(root).absolute()
    source_rows = tree(root, identity["commit"])
    retained = git_bytes(root, source_rows, HELPER)
    actual, _ = regular_bytes(Path(__file__).absolute())
    require(retained == actual and blob_sha(actual) == identity["gitBlob"]
            and sha(actual) == identity["sha256"], "IMMUTABLE_VERIFIER_BYTES")
    workflow = ".github/workflows/verify-alpha-release-payloads.yml"
    require(source_rows[workflow][2] == identity["workflowGitBlob"], "VERIFIER_WORKFLOW")
    current_rows = tree(root, context["GITHUB_SHA"])
    require(git_bytes(root, current_rows, HELPER) == retained
            and current_rows[workflow] == source_rows[workflow], "PRODUCER_SOURCE_CHANGED")
    input_name = Path(input_path).absolute().relative_to(root).as_posix()
    require(input_name == "docs/release-evidence/ti-compatible-set-20261019/release-input.json"
            and git_bytes(root, current_rows, input_name) == input_raw, "IMMUTABLE_INPUT_BYTES")
    require(git(root, "merge-base", identity["commit"], context["GITHUB_SHA"], cap=128).strip().decode()
            == identity["commit"], "VERIFIER_ANCESTRY")
    return {**identity, "path": HELPER, "inputCommit": context["GITHUB_SHA"],
            "inputGitBlob": current_rows[input_name][2]}

def release_files(contract, assets, folder, download):
    folder = Path(folder)
    if download:
        folder.mkdir(mode=0o700, parents=False, exist_ok=False)
    require(folder.is_dir() and not folder.is_symlink(), "RELEASE_DIRECTORY")
    values, records = {}, {}
    for role in ("wheel", "requirements", "checksums"):
        expected = contract["assets"][role]
        path = folder / expected["name"]
        if download:
            data = public_get(assets[role]["browser_download_url"], expected["bytes"], "application/octet-stream")
            with path.open("xb") as output:
                output.write(data)
        data, mode = regular_bytes(path, LIMIT)
        require(len(data) == expected["bytes"] and sha(data) == expected["sha256"], "ASSET_BYTES")
        values[role] = data
        records[role] = {**expected, "physicalDownloadMode": format(mode, "04o"),
                         "serverDigest": assets[role]["digest"], "actualBytesVerified": True}
    checksums = {}
    for line in values["checksums"].decode("utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64}) [ *]([^/\\]+)", line)
        require(match and match[2] not in checksums, "CHECKSUM_MANIFEST")
        checksums[match[2]] = match[1]
    for role in ("wheel", "requirements"):
        expected = contract["assets"][role]
        require(checksums.get(expected["name"]) == expected["sha256"], "CHECKSUM_COVERAGE")
    return values, records

def parse_record(raw, names=None, self_name=None):
    entries = {}
    for row in csv.reader(io.StringIO(raw.decode("utf-8"), newline="")):
        require(len(entries) < 8192, "RECORD_ROW_BOUND")
        require(len(row) == 3 and row[0] not in entries, "RECORD_ROWS")
        name, digest, size = row
        require("\\" not in name and not PurePosixPath(name).is_absolute()
                and not any(ord(c) < 32 for c in name), "RECORD_PATH")
        require((not digest and not size) or
                (re.fullmatch(r"sha256=[A-Za-z0-9_-]{43}", digest) and re.fullmatch(r"0|[1-9][0-9]*", size)),
                "RECORD_FIELDS")
        entries[name] = (digest, size)
    if names is not None:
        require(set(entries) == set(names) and entries[self_name] == ("", ""), "WHEEL_RECORD_COVERAGE")
    return entries

def check_record_entry(entry, data, required=True):
    digest, size = entry
    if not digest:
        require(not required, "RECORD_HASH_MISSING")
        return False
    encoded = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii")
    require(digest == "sha256=" + encoded and size == str(len(data)), "RECORD_BYTES")
    return True

def wheel_files(data, version):
    with zipfile.ZipFile(io.BytesIO(data)) as wheel:
        infos = wheel.infolist()
        require(0 < len(infos) <= 4096 and sum(x.file_size for x in infos) <= TOTAL_LIMIT, "WHEEL_BOUND")
        values, modes = {}, {}
        for info in infos:
            relative(info.filename)
            require(info.filename not in values and not info.is_dir() and info.file_size <= MEMBER_LIMIT
                    and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG), "WHEEL_MEMBER")
            mode = stat.S_IMODE(info.external_attr >> 16)
            require(mode in (0o644, 0o755), "WHEEL_MODE")
            with wheel.open(info) as stream:
                value = stream.read(info.file_size + 1)
            require(len(value) == info.file_size, "WHEEL_MEMBER_SIZE")
            values[info.filename], modes[info.filename] = value, mode
    dist = "alpha_factory_v1-" + version + ".dist-info"
    required = [dist + "/" + n for n in ("RECORD", "METADATA", "WHEEL")]
    require(all(n in values for n in required), "DIST_INFO")
    metadata = email.parser.BytesParser().parsebytes(values[dist + "/METADATA"])
    require(re.sub(r"[-_.]+", "-", metadata["Name"]).lower() == "alpha-factory-v1"
            and metadata["Version"] == version, "WHEEL_METADATA")
    wheel_meta = email.parser.BytesParser().parsebytes(values[dist + "/WHEEL"])
    require(wheel_meta["Wheel-Version"] == "1.0" and wheel_meta["Root-Is-Purelib"] == "true"
            and "py3-none-any" in wheel_meta.get_all("Tag", []), "SUPPORTED_PURE_WHEEL")
    entries = parse_record(values[dist + "/RECORD"], values, dist + "/RECORD")
    for name, value in values.items():
        if name != dist + "/RECORD":
            check_record_entry(entries[name], value)
    return values, modes, entries, dist

def payload_map(source_root, commit, expected_tree, values, modes, dist):
    rows = tree(source_root, commit)
    require(git(source_root, "rev-parse", commit + "^{tree}", cap=128).strip().decode() == expected_tree,
            "SOURCE_TREE")
    project = tomllib.loads(git_bytes(source_root, rows, "pyproject.toml").decode("utf-8"))
    require(project["project"]["version"] == email.parser.BytesParser().parsebytes(values[dist + "/METADATA"])["Version"],
            "SOURCE_VERSION")
    includes = project["tool"]["setuptools"]["packages"]["find"]["include"]
    require(set(includes) == {"alpha_factory_v1*", "af_requests*", "openai_agents*"}, "PACKAGE_NAMESPACE_PROFILE")
    roots = {name[:-1] for name in includes}
    payload, generated = [], []
    for name, value in sorted(values.items()):
        if name.startswith(dist + "/"):
            generated.append({"name": name, "bytes": len(value), "sha256": sha(value),
                              "mode": format(modes[name], "04o")})
            if name.endswith("/LICENSE"):
                require(value == git_bytes(source_root, rows, "LICENSE"), "LICENSE_SOURCE")
            continue
        require(name.split("/", 1)[0] in roots, "UNRECOGNIZED_WHEEL_PAYLOAD")
        original = git_bytes(source_root, rows, name)
        require(value == original, "WHEEL_GIT_BYTES")
        git_mode = int(rows[name][0][-3:], 8)
        exception = name in LEGACY_MODES and git_mode == 0o755 and modes[name] == 0o644
        require(git_mode == modes[name] or exception, "WHEEL_GIT_MODE")
        payload.append({"name": name, "bytes": len(value), "sha256": sha(value), "gitBlob": rows[name][2],
            "gitMode": rows[name][0], "wheelMode": format(modes[name], "04o"), "legacyModeException": exception})
    require(payload, "PAYLOAD_EMPTY")
    return payload, generated, project

def installation(venv, site, payload, values, modes, dist, project, observation_raw, installer_identity, contract, context):
    venv, site = Path(venv).absolute(), Path(site).absolute()
    require(not venv.is_symlink() and not site.is_symlink() and site.is_relative_to(venv)
            and site.name == "site-packages" and (venv / "pyvenv.cfg").is_file(), "NORMAL_VENV_LOCATION")
    expected_site = venv / "lib" / ("python" + str(sys.version_info.major) + "." + str(sys.version_info.minor)) / "site-packages"
    require(site == expected_site and sys.platform == "linux", "SUPPORTED_LINUX_INSTALL_LAYOUT")
    config, _ = regular_bytes(venv / "pyvenv.cfg", 65536)
    executable, executable_mode = regular_bytes((venv / "bin/python").resolve(strict=True), EXECUTABLE_LIMIT)
    host_runtime = runtime_identity()
    require(sha(executable) == host_runtime["executableSha256"], "NORMAL_VENV_INTERPRETER_BYTES")
    observed = json.loads(observation_raw)
    require(set(observed) == {"schema", "producer", "installer", "wheelSha256", "requirementsSha256", "profile", "exitCode", "elapsedMilliseconds"}
            and observed["schema"] == "alpha-normal-install-observation/v1"
            and observed["producer"] == context and observed["installer"] == installer_identity
            and observed["wheelSha256"] == contract["assets"]["wheel"]["sha256"]
            and observed["requirementsSha256"] == contract["assets"]["requirements"]["sha256"]
            and observed["profile"] == "UNCHANGED_INSTALL_AGENT_HASH_LOCKED_DEPS_WHEEL_PIPCHECK_CLI"
            and observed["exitCode"] == 0 and type(observed["elapsedMilliseconds"]) in (int, float)
            and 0 < observed["elapsedMilliseconds"] < 3600000, "NORMAL_INSTALL_OBSERVATION")
    record_name = dist + "/RECORD"
    raw, _ = regular_bytes(site / record_name)
    installed = parse_record(raw)
    require(installed.get(record_name) == ("", ""), "INSTALLED_RECORD_SELF")
    immutable_metadata = {name for name in values if name.startswith(dist + "/") and name != record_name}
    require(immutable_metadata.issubset(installed), "INSTALLED_METADATA_RECORD_COVERAGE")
    coverage, extra = [], []
    scripts = set(project["project"]["scripts"])
    for item in payload:
        name = item["name"]
        require(name in installed, "INSTALLED_PAYLOAD_RECORD")
        data, mode = regular_bytes(site / name)
        require(len(data) == item["bytes"] and sha(data) == item["sha256"] and mode == modes[name],
                "INSTALLED_PAYLOAD_BYTES_MODE")
        item["physicalMode"] = format(mode, "04o")
        item["installedRecordHashPresent"] = check_record_entry(installed[name], data, required=False)
        coverage.append(name)
    generated_bytes = 0
    for name, entry in sorted(installed.items()):
        if name in coverage or name == record_name:
            continue
        parts = PurePosixPath(name).parts
        candidate = site.joinpath(*parts)
        if name.startswith(dist + "/"):
            relative(name)
            kind = "WHEEL_METADATA" if name in values else "PIP_METADATA"
            require(name in values or name in {dist + "/INSTALLER", dist + "/REQUESTED", dist + "/direct_url.json"},
                    "UNKNOWN_INSTALL_METADATA")
        elif "__pycache__" in parts and name.endswith(".pyc") and parts[0] in ("alpha_factory_v1", "af_requests", "openai_agents"):
            relative(name)
            kind = "OBSERVED_UNVERIFIED_RECORDED_BYTECODE"
        else:
            require(candidate.resolve().parent == (venv / "bin").resolve()
                    and candidate.name in scripts, "UNSUPPORTED_INSTALLED_RECORD_PATH")
            kind = "GENERATED_ENTRYPOINT"
        data, mode = regular_bytes(candidate)
        generated_bytes += len(data)
        require(generated_bytes <= TOTAL_LIMIT, "INSTALLED_GENERATED_BYTES_BOUND")
        hash_present = check_record_entry(entry, data, required=False)
        if name in values:
            require(data == values[name] and mode == modes[name], "INSTALLED_METADATA_CHANGED")
        if name == dist + "/direct_url.json":
            origin = json.loads(data)
            archive = origin.get("archive_info", {})
            require(archive.get("hashes", {}).get("sha256") == sha(values["__wheel_bytes__"])
                    and archive.get("hash", "sha256=" + sha(values["__wheel_bytes__"]))
                    == "sha256=" + sha(values["__wheel_bytes__"]), "INSTALL_ORIGIN_WHEEL")
        extra.append({"name": name, "kind": kind, "bytes": len(data), "sha256": sha(data),
                      "mode": format(mode, "04o"), "recordHashPresent": hash_present})
    metadata_count = 0
    for parent, directories, files in os.walk(site / dist, followlinks=False):
        require(not Path(parent).is_symlink() and all(not (Path(parent) / name).is_symlink()
                for name in directories), "LINKED_METADATA_DIRECTORY")
        for filename in files:
            path = Path(parent) / filename
            name = path.relative_to(site).as_posix()
            metadata_count += 1
            require(metadata_count <= 128 and name in installed
                    and (name == record_name or name in immutable_metadata
                         or name in {dist + "/INSTALLER", dist + "/REQUESTED", dist + "/direct_url.json"}),
                    "UNRECORDED_INSTALL_METADATA")
            regular_bytes(path)
    require(metadata_count >= len(immutable_metadata) + 1, "PHYSICAL_METADATA_COVERAGE")
    expected = {x["name"] for x in payload}
    unrecorded = []
    physical_count, physical_bytes = 0, 0
    for root in ("alpha_factory_v1", "af_requests", "openai_agents"):
        folder = site / root
        if not folder.exists():
            require(not any(n.startswith(root + "/") for n in expected), "PAYLOAD_ROOT_MISSING")
            continue
        for parent, directories, files in os.walk(folder, followlinks=False):
            require(not Path(parent).is_symlink() and all(not (Path(parent) / n).is_symlink()
                    for n in directories), "LINKED_INSTALL_DIRECTORY")
            for filename in files:
                path = Path(parent) / filename
                physical_count += 1
                require(physical_count <= 8192, "PHYSICAL_TREE_COUNT")
                name = path.relative_to(site).as_posix()
                if name in expected or name in installed:
                    continue
                require("__pycache__" in path.parts and name.endswith(".pyc"), "UNRECOGNIZED_PHYSICAL_PAYLOAD")
                data, mode = regular_bytes(path)
                physical_bytes += len(data)
                require(physical_bytes <= TOTAL_LIMIT, "OPTIONAL_BYTECODE_BOUND")
                unrecorded.append({"name": name, "bytes": len(data), "sha256": sha(data),
                                   "mode": format(mode, "04o"), "kind": "OBSERVED_UNVERIFIED_UNRECORDED_BYTECODE"})
    return {"classification": "OBSERVED_EXISTING_NORMAL_INSTALL_FILES_NOT_TARGET_CODE_EXECUTION",
            "normalInstallObservation": observed, "venvConfigSha256": sha(config),
            "pythonExecutable": {"sha256": sha(executable), "bytes": len(executable), "mode": format(executable_mode, "04o")},
            "payloadCount": len(coverage), "record": {
                "sha256": sha(raw), "bytes": len(raw), "rows": len(installed),
                "rawPreservedAs": "installed-RECORD.csv", "payloadRowsCompared": len(coverage)},
            "generatedAndMetadata": extra, "optionalUnrecordedBytecode": sorted(unrecorded, key=lambda x: x["name"])}, raw

def emit(data):
    require(len(data) <= 4 * 1024 * 1024, "RECEIPT_BOUND")
    chunks = [base64.b64encode(data[i:i + 6000]).decode("ascii") for i in range(0, len(data), 6000)]
    print("ALPHA_PAYLOAD_RECEIPT_BEGIN " + json.dumps({"schema": "alpha-release-payload-receipt/v1",
        "bytes": len(data), "sha256": sha(data), "chunks": len(chunks)}, sort_keys=True, separators=(",", ":")))
    for index, value in enumerate(chunks):
        print("ALPHA_PAYLOAD_RECEIPT_PART " + str(index + 1) + "/" + str(len(chunks)) + " " + value)
    print("ALPHA_PAYLOAD_RECEIPT_END " + sha(data))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--release-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--no-log", action="store_true")
    parser.add_argument("--verifier-root", required=True)
    parser.add_argument("--normal-install-observation")
    parser.add_argument("--venv")
    parser.add_argument("--site-packages")
    args = parser.parse_args()
    started = time.monotonic()
    contract_raw, _ = regular_bytes(args.contract, 1024 * 1024)
    contract = json.loads(contract_raw)
    context = {key: os.environ.get(key) for key in ("GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB")}
    require(context["GITHUB_REPOSITORY"] == "MontrealAI/AGI-Fleet-Linux"
            and HEX40.fullmatch(context["GITHUB_SHA"] or "")
            and re.fullmatch(r"[1-9][0-9]*", context["GITHUB_RUN_ID"] or "")
            and re.fullmatch(r"[1-9][0-9]*", context["GITHUB_RUN_ATTEMPT"] or "")
            and context["GITHUB_JOB"], "HOSTED_PRODUCER_CONTEXT")
    custody = verifier_custody(contract, args.verifier_root, args.contract, contract_raw, context)
    assets, api_inputs = authenticate(contract)
    values, asset_records = release_files(contract, assets, args.release_dir, args.download)
    wheel, modes, records, dist = wheel_files(values["wheel"], contract["release"]["version"])
    payload, generated, project = payload_map(args.source_root, contract["release"]["commit"],
        contract["release"]["tree"], wheel, modes, dist)
    source_rows = tree(args.source_root, contract["release"]["commit"])
    installer_raw = git_bytes(args.source_root, source_rows, "scripts/install_agent.py")
    lock_raw = git_bytes(args.source_root, source_rows, "requirements-agent.lock")
    require(values["requirements"] == lock_raw, "RELEASE_LOCK_SOURCE")
    installer_identity = {"sourceCommit": contract["release"]["commit"],
        "gitBlob": source_rows["scripts/install_agent.py"][2], "sha256": sha(installer_raw)}
    if args.download:
        with (Path(args.release_dir) / "normal-install-agent.py").open("xb") as stream:
            stream.write(installer_raw)
    result = {"schema": "alpha-release-payload-receipt/v1", "scope": "ALPHA_FILE_BINDING_ONLY",
        "producer": context, "verifier": custody, "runtime": runtime_identity(),
        "installer": installer_identity,
        "input": {"bytes": len(contract_raw), "sha256": sha(contract_raw), "contract": contract},
        "publicApiInputs": api_inputs, "releaseAssets": asset_records,
        "attestation": {"classification": "EXTERNAL_REFERENCE_NOT_CRYPTOGRAPHICALLY_REVERIFIED",
                        "reference": contract["attestationEvidence"]},
        "wheel": {"members": len(wheel), "record": {"sha256": sha(wheel[dist + "/RECORD"]),
            "bytes": len(wheel[dist + "/RECORD"]), "rows": len(records), "selfRowEmpty": True,
            "rawPreservedAs": "wheel-RECORD.csv"}, "payloadCount": len(payload),
            "pythonPayloadCount": sum(x["name"].endswith(".py") for x in payload),
            "payloads": payload, "generatedMetadata": generated,
            "allActualPayloadsGitCompared": True, "allTrackedSourceRequiredInWheel": False},
        "installation": None, "normalInstallerExecutedByThisHelper": False,
        "targetPackageImported": False, "modelOrNativeAcceptance": False,
        "onChainAction": False, "wholeReleaseQualification": False}
    installed_raw = None
    require(bool(args.venv) == bool(args.site_packages) == bool(args.normal_install_observation), "INSTALL_ARGUMENTS")
    if args.venv:
        wheel["__wheel_bytes__"] = values["wheel"]
        observation_raw, _ = regular_bytes(args.normal_install_observation, 65536)
        result["installation"], installed_raw = installation(args.venv, args.site_packages, payload, wheel, modes, dist, project,
            observation_raw, installer_identity, contract, context)
    result["elapsedMilliseconds"] = round((time.monotonic() - started) * 1000, 3)
    output = Path(args.output)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name, data in (("wheel-RECORD.csv", wheel[dist + "/RECORD"]), ("input-contract.json", contract_raw)):
        with (output / name).open("xb") as stream:
            stream.write(data)
    if installed_raw is not None:
        with (output / "installed-RECORD.csv").open("xb") as stream:
            stream.write(installed_raw)
    receipt = canonical(result)
    with (output / "receipt.json").open("xb") as stream:
        stream.write(receipt)
    if not args.no_log:
        emit(receipt)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never print raw URLs, local paths, API bodies or target package data on failure.
        print("ALPHA_RELEASE_PAYLOAD_VERIFICATION_FAILED", file=sys.stderr)
        raise SystemExit(1)
