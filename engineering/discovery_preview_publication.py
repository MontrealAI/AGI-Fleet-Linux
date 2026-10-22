# SPDX-License-Identifier: Apache-2.0
"""Publish only the separately qualified immutable Discovery finite preview.

The existing Dedicated Fleet and Local Skills publishers are not modified.
Network calls run only from explicit CLI entry points; tests use inert API data.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

import discovery_release as release
import discovery_installed_qualification as qualification
import discovery_alpha_input as original_input

ROOT = release.ROOT
REPOSITORY = "MontrealAI/AGI-Fleet-Linux"
VERSION = release.VERSION
TAG = "v" + VERSION
TITLE = "Discovery installed finite review — " + VERSION
WORKFLOW = ".github/workflows/publish-discovery-preview.yml"
CONFIRMATION = "PUBLISH_" + VERSION
REVIEW_SCHEMA = "agi-fleet/discovery-preview-review/v1"
REVIEW_MARKER = "<!-- " + REVIEW_SCHEMA + " -->\n"
COMPONENTS = {"installed-package", "owned-source-boundary", "two-runtime-native-return", "same-history-docket",
              "artifact-custody", "publication", "inherited-gates"}
LIMIT = 450_000_000
ARTIFACT_JOBS = {
    "discovery-publication-source": "Authorize reviewed Discovery source",
    "discovery-installed-candidate": "Discovery installed review / Discovery saved candidate",
    "discovery-installed-native-fleet-linux-x64": "Discovery installed review / Discovery installed native (fleet-linux-x64)",
    "discovery-installed-native-alpha-compatible-linux-x64": "Discovery installed review / Discovery installed native (alpha-compatible-linux-x64)",
    "discovery-installed-audit": "Discovery installed review / Discovery raw custody audit",
    "next-publication": "Inherited full Fleet / audit",
}
CRITICAL_STEPS = {
    "Authorize reviewed Discovery source": ("Authenticate source and source-specific review before qualification",),
    "Discovery installed review / Discovery saved candidate": ("Require the frozen reviewed source profile",
        "Preserve ordinary repository and engineering gates", "Build one saved inactive candidate"),
    "Discovery installed review / Discovery raw custody audit": ("Bind exact source, saved bytes, runtime observations and workflow identity",),
    "Inherited full Fleet / audit": ("Independently audit source-bound results",),
    "Inherited full Fleet / Required release qualification": ("Reject missing, failed, cancelled or skipped qualification children",),
}


def require(value, message):
    if not value:
        raise ValueError(message)


def strict_json(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, "Duplicate publication JSON key")
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def instant(value):
    require(isinstance(value, str), "Missing artifact/job timestamp")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(result.tzinfo is not None, "Timestamp must include its timezone")
    return result


def identity(path):
    require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size < LIMIT, "Unsafe publication asset")
    with path.open("rb") as stream:
        return {"name": path.name, "bytes": path.stat().st_size, "sha256": hashlib.file_digest(stream, "sha256").hexdigest()}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


class GitHub:
    def __init__(self, token):
        require(isinstance(token, str) and token, "Existing workflow token is required")
        self.token = token

    def request(self, path, *, method="GET", data=None, upload=False, accept="application/vnd.github+json"):
        require(path.startswith("/") and not path.startswith("//"), "Relative GitHub API path required")
        host = "https://uploads.github.com" if upload else "https://api.github.com"
        request = urllib.request.Request(host + "/repos/" + REPOSITORY + path, data=data, method=method,
            headers={"Authorization": "Bearer " + self.token, "Accept": accept,
                     "Content-Type": "application/octet-stream" if upload else "application/json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "AGI-Fleet-Discovery-preview"})
        return urllib.request.build_opener(NoRedirect).open(request, timeout=120)

    def api(self, path, *, method="GET", data=None, upload=False):
        with self.request(path, method=method, data=data, upload=upload) as response:
            return strict_json(response.read(8_000_001))

    def download(self, path, output, expected):
        require(type(expected["bytes"]) is int and 0 < expected["bytes"] < LIMIT
                and re.fullmatch("[0-9a-f]{64}", expected["sha256"]), "Invalid download identity")
        try:
            response = self.request(path, accept="application/octet-stream")
        except urllib.error.HTTPError as error:
            if error.code != 302:
                raise ValueError("GitHub byte download failed; signed location withheld") from None
            location = error.headers.get("Location", "")
            parsed = urllib.parse.urlsplit(location)
            require(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password,
                    "Unsupported byte-download redirect")
            # A signed storage URL receives no authorization header and is never logged.
            try:
                response = urllib.request.build_opener(NoRedirect).open(
                    urllib.request.Request(location, headers={"User-Agent": "AGI-Fleet-Discovery-preview"}), timeout=120)
            except (urllib.error.URLError, OSError):
                raise ValueError("Storage byte download failed; signed location withheld") from None
        count, observed = 0, hashlib.sha256()
        with response, output.open("xb") as stream:
            while True:
                chunk = response.read(min(1_000_000, expected["bytes"] - count + 1))
                if not chunk:
                    break
                count += len(chunk)
                require(count <= expected["bytes"], "Download exceeds declared byte bound")
                observed.update(chunk)
                stream.write(chunk)
        require(count == expected["bytes"] and observed.hexdigest() == expected["sha256"], "Downloaded bytes differ")


def paginated(api, path, field=None):
    items = []
    for page in range(1, 21):
        result = api(path + ("&" if "?" in path else "?") + f"per_page=100&page={page}")
        batch = result[field] if field else result
        require(isinstance(batch, list), "GitHub collection differs")
        items.extend(batch)
        if len(batch) < 100:
            return items
    raise ValueError("GitHub collection exceeds publication bound")


def review_record(comment, pull, source, tree, number):
    require(comment.get("issue_url") == f"https://api.github.com/repos/{REPOSITORY}/issues/{number}"
            and comment.get("author_association") in ("OWNER", "MEMBER", "COLLABORATOR"), "Review comment custody differs")
    body = comment.get("body", "")
    require(isinstance(body, str) and len(body.encode()) < 100_000 and body.startswith(REVIEW_MARKER),
            "A case-specific structured technical review is required")
    record = strict_json(body[len(REVIEW_MARKER):])
    require(set(record) == {"schema", "repository", "version", "reviewedCommit", "reviewedTree", "pullRequest",
            "reviewer", "ownerAuthorization", "reviewedComponents", "unresolvedFindings", "findingDispositions",
            "organizationalIndependence", "economicApproval"}, "Technical review fields differ")
    require(record["schema"] == REVIEW_SCHEMA and record["repository"] == REPOSITORY and record["version"] == VERSION
            and record["reviewedCommit"] == source and record["reviewedTree"] == tree and record["pullRequest"] == number,
            "Technical review belongs to another exact source")
    reviewer = record["reviewer"]
    require(set(reviewer) == {"role", "identity", "accountArrangement"}
            and reviewer["role"] in ("independent-technical-review-agent", "owner-authorized-technical-reviewer")
            and isinstance(reviewer["identity"], str) and 0 < len(reviewer["identity"]) <= 256,
            "Reviewer role/identity must be recorded truthfully")
    # This implements CONTRIBUTING's permitted arrangement, not a fabricated APPROVE.
    require(reviewer["accountArrangement"] == "owner-authorized-shared-account"
            and comment.get("user", {}).get("login", "").lower() == REPOSITORY.split("/")[0].lower(),
            "This publication arrangement requires the owner-authorized shared-account record")
    authority = record["ownerAuthorization"]
    require(set(authority) == {"basis", "reference"} and authority["basis"] == "explicit-public-implementation-mandate"
            and isinstance(authority["reference"], str) and 0 < len(authority["reference"]) <= 1000,
            "Existing owner authorization must be recorded for this review")
    require(isinstance(record["reviewedComponents"], list) and len(record["reviewedComponents"]) == len(COMPONENTS)
            and set(record["reviewedComponents"]) == COMPONENTS and record["unresolvedFindings"] == []
            and record["organizationalIndependence"] is False and record["economicApproval"] is False,
            "Review scope, findings or authority claims differ")
    require(isinstance(record["findingDispositions"], list) and len(record["findingDispositions"]) <= 256,
            "Bounded case-specific finding dispositions are required")
    for finding in record["findingDispositions"]:
        require(set(finding) == {"id", "disposition", "evidence"} and finding["disposition"] in ("resolved", "not-a-finding")
                and all(isinstance(finding[key], str) and finding[key] for key in finding), "Unresolved technical finding")
    require(pull.get("merged") is True and pull.get("merge_commit_sha") == source and pull.get("base", {}).get("ref") == "main",
            "Source must already be the normally merged reviewed PR; this publisher never overrides merge rules")
    return {"commentId": comment["id"], "commentURL": comment["html_url"], "bodySha256": digest(body.encode()),
            "record": record, "githubReviewState": "COMMENT technical record; not APPROVE or account separation"}


def authorize(api, source, number, comment_id, confirmation, *, root=ROOT, environment=None):
    env = os.environ if environment is None else environment
    require(confirmation == CONFIRMATION and re.fullmatch("[0-9a-f]{40}", source or "")
            and type(number) is int and number > 0 and type(comment_id) is int and comment_id > 0, "Explicit version/source/review selection required")
    require(env.get("GITHUB_REPOSITORY") == REPOSITORY and env.get("GITHUB_SHA") == source
            and env.get("GITHUB_REF") == "refs/heads/main" and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and env.get("GITHUB_WORKFLOW_REF") == REPOSITORY + "/" + WORKFLOW + "@refs/heads/main"
            and re.fullmatch("[1-9][0-9]*", env.get("GITHUB_RUN_ID", ""))
            and re.fullmatch("[1-9][0-9]*", env.get("GITHUB_RUN_ATTEMPT", "")), "Authorized exact-main workflow required")
    commit, tree = release.clean_git_root(root)
    require(commit == source and api("/git/ref/heads/main")["object"]["sha"] == source, "Current main/source lease differs")
    require(api("/git/commits/" + source)["tree"]["sha"] == tree, "Public source tree differs from checkout")
    profile = release.load_profile(root / "discovery-lab/release/profile.json")
    require(profile.get("publication") == "HELD" and profile.get("organizationalIndependence") is False,
            "Source profile cannot self-qualify publication")
    pull = api(f"/pulls/{number}")
    comment = api(f"/issues/comments/{comment_id}")
    review = review_record(comment, pull, source, tree, number)
    return {"schema": "agi-fleet/discovery-preview-publication-authorization/v1", "source": {"repository": REPOSITORY,
            "commit": source, "tree": tree}, "version": VERSION, "tag": TAG, "review": review,
            "workflow": {key: env[key] for key in ("GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT",
                         "GITHUB_EVENT_NAME", "GITHUB_WORKFLOW_REF")},
            "profileSha256": digest((root / "discovery-lab/release/profile.json").read_bytes()),
            "authority": "software-preview-publication-only; no wallet/provider/settlement authority"}


def safe_extract(archive, destination):
    require(not destination.exists(), "Artifact extraction output must be absent")
    with zipfile.ZipFile(archive) as saved:
        files, names, members = {}, set(), []
        require(len(saved.infolist()) <= 20_000 and sum(row.file_size for row in saved.infolist()) < LIMIT,
                "Artifact expansion exceeds bound")
        for item in saved.infolist():
            name = release.safe_name(item.filename.rstrip("/"))
            require(name not in names, "Artifact contains duplicate member")
            names.add(name)
            if item.is_dir():
                require(item.file_size == 0 and saved.read(item) == b"", "Artifact directory contains data")
                members.append({"path": name + "/", "bytes": 0, "sha256": digest(b"")})
                continue
            require(name not in files and (item.external_attr >> 16) & 0o170000 in (0, stat.S_IFREG),
                    "Artifact contains duplicate or nonregular member")
            files[name] = saved.read(item)  # Bounded size and ZIP CRC are checked before any write.
            members.append({"path": name, "bytes": len(files[name]), "sha256": digest(files[name])})
        release.nonconflicting_names(set(files))
    destination.mkdir(mode=0o700)
    for name, data in files.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return sorted(members, key=lambda row: row["path"])


def require_job(jobs, name, source, run_id):
    matches = [job for job in jobs if job.get("name") == name]
    require(len(matches) == 1, "Missing or duplicated qualification job: " + name)
    job = matches[0]
    require(job.get("run_id") == int(run_id) and job.get("head_sha") == source
            and job.get("status") == "completed" and job.get("conclusion") == "success", "Unqualified exact-source job: " + name)
    steps = CRITICAL_STEPS.get(name, ())
    if name.startswith("Discovery installed review / Discovery installed native ("):
        steps = ("Verify and install the same saved archive without starting services",
                 "Run the actual extracted reviewer and return both alternatives to one mission",
                 "Preserve the separate constructed native regression history")
    for expected in steps:
        matches = [step for step in job.get("steps", []) if step.get("name") == expected]
        require(len(matches) == 1 and matches[0].get("status") == "completed" and matches[0].get("conclusion") == "success",
                "Missing/skipped/failed required step: " + expected)
    return job


def workflow_jobs(api, authorization):
    source, context = authorization["source"]["commit"], authorization["workflow"]
    run_id, attempt = context["GITHUB_RUN_ID"], context["GITHUB_RUN_ATTEMPT"]
    run = api("/actions/runs/" + run_id)
    definition = api("/actions/workflows/" + WORKFLOW.rsplit("/", 1)[1])
    require(run.get("head_sha") == source and run.get("head_branch") == "main" and run.get("event") == "workflow_dispatch"
            and run.get("run_attempt") == int(attempt) and run.get("workflow_id") == definition["id"]
            and run.get("path") == WORKFLOW, "Publication workflow source/attempt differs")
    jobs = paginated(api, f"/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs")
    for name in ARTIFACT_JOBS.values():
        require_job(jobs, name, source, run_id)
    require_job(jobs, "Inherited full Fleet / Required release qualification", source, run_id)
    inherited = [row for row in jobs if row.get("name", "").startswith("Inherited full Fleet / ")]
    groups = {"build": 0, "native": 0, "integration": 0, "profile": 0, "browser": 0, "audit": 0, "aggregate": 0}
    for job in inherited:
        leaf = job["name"].removeprefix("Inherited full Fleet / ")
        if leaf == "publish":
            require(job.get("conclusion") == "skipped", "Historical publisher must remain disabled")
            continue
        require_job(jobs, job["name"], source, run_id)
        key = ("native" if leaf.startswith("native (") else "integration" if leaf.startswith("integration (")
               else "profile" if leaf.startswith("Saved-archive Manager 1.17 contract profile (")
               else "browser" if leaf == "Saved-archive SUCCESSOR browser execution"
               else "aggregate" if leaf == "Required release qualification" else leaf)
        require(key in groups, "Unexpected inherited qualification job")
        groups[key] += 1
    require(groups == {"build": 1, "native": 2, "integration": 2, "profile": 2, "browser": 1, "audit": 1, "aggregate": 1},
            "All unchanged Fleet qualification groups must complete")
    return run, jobs


def download_artifacts(transport, authorization, output, jobs):
    context = authorization["workflow"]
    run_id = context["GITHUB_RUN_ID"]
    artifacts = paginated(transport.api, f"/actions/runs/{run_id}/artifacts", "artifacts")
    records = []
    for name, job_name in ARTIFACT_JOBS.items():
        matches = [row for row in artifacts if row.get("name") == name]
        require(len(matches) == 1, "Missing or ambiguous original workflow artifact: " + name)
        row = matches[0]
        job = require_job(jobs, job_name, authorization["source"]["commit"], run_id)
        require(type(row.get("id")) is int and row["id"] > 0 and row.get("expired") is False
                and row.get("workflow_run", {}).get("id") == int(run_id)
                and row.get("workflow_run", {}).get("head_sha") == authorization["source"]["commit"]
                and instant(job["started_at"]) <= instant(row.get("created_at")) <= instant(job["completed_at"])
                and re.fullmatch("sha256:[0-9a-f]{64}", row.get("digest", "")), "Artifact source/job/attempt custody differs")
        expected = {"bytes": row["size_in_bytes"], "sha256": row["digest"][7:]}
        archive = output / (name + ".zip")
        transport.download(f'/actions/artifacts/{row["id"]}/zip', archive, expected)
        members = safe_extract(archive, output / name)
        records.append({"name": name, "id": row["id"], **expected, "producerJob": job_name,
                        "producerJobId": job["id"], "createdAt": row["created_at"], "members": members})
    return records


def inherited_audit(folder, source, run_id):
    spec = importlib.util.spec_from_file_location("discovery_inherited_publisher", ROOT / "engineering/publish-next-release.py")
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)
    manifest = strict_json((folder / "Release-Manifest-v1.1.4.json").read_bytes())
    require(str(manifest.get("workflowRun")) == run_id and manifest.get("workflowCommit") == source,
            "Inherited saved-archive audit belongs to another source/run")
    publisher.validate(manifest, manifest["audit"], source)
    evidence = manifest["evidence"]
    require(identity(folder / evidence["name"]) == evidence, "Inherited evidence bytes differ")
    return manifest


def verify_source_archive(archive, source, *, root=ROOT):
    """Stream CRC and Git blob checks; never extract or execute source members."""
    entries = {}
    for row in release.git(root, "ls-tree", "-r", "-z", source).split("\0"):
        if not row:
            continue
        meta, name = row.split("\t", 1)
        mode, kind, oid = meta.split()
        require(kind == "blob" and mode in ("100644", "100755", "120000"), "Unsupported exact review source type")
        entries[name] = (mode, oid)
    with zipfile.ZipFile(archive) as saved:
        require(saved.comment == source.encode() and len(saved.infolist()) <= 20_000
                and sum(item.file_size for item in saved.infolist()) < 1_500_000_000, "Review source archive identity/expansion differs")
        files = [item for item in saved.infolist() if not item.is_dir()]
        require(len({item.filename for item in saved.infolist()}) == len(saved.infolist()), "Duplicate review source ZIP member")
        require(len(files) == len(entries) and {item.filename for item in files} == set(entries), "Review source archive membership differs")
        expected_directories = {str(parent) for name in entries for parent in PurePosixPath(name).parents if str(parent) != "."}
        directories = [item for item in saved.infolist() if item.is_dir()]
        require({item.filename.rstrip("/") for item in directories} == expected_directories,
                "Review source archive directory membership differs")
        for item in directories:
            require(item.file_size == 0 and saved.read(item) == b"", "Review source directory contains data")
        for item in files:
            mode, oid = entries[item.filename]
            observed_mode = item.external_attr >> 16
            # Git emits DOS-style zero mode for ordinary 100644 ZIP members, and
            # Unix attributes for executable files/symlinks. Preserve that distinction.
            ordinary = mode == "100644" and item.create_system == 0 and observed_mode == 0
            unix = (stat.S_ISLNK(observed_mode) if mode == "120000" else stat.S_ISREG(observed_mode))
            require(ordinary or unix and bool(observed_mode & 0o111) == (mode != "100644"), "Review source archive mode differs")
            state = hashlib.sha1(b"blob " + str(item.file_size).encode() + b"\0")
            with saved.open(item) as stream:
                while chunk := stream.read(1_000_000):
                    state.update(chunk)
            require(state.hexdigest() == oid, "Review source archive bytes differ from actual Git tree")
    return {"commit": source, "files": len(entries), "gitBlobsMatched": True, "zipCRCChecked": True}


def validate_downloads(raw, authorization):
    source_folder = raw / "discovery-publication-source"
    require(strict_json((source_folder / "authorization.json").read_bytes()) == authorization, "Review/source custody changed during qualification")
    source_receipt = strict_json((source_folder / "source-receipt.json").read_bytes())
    require(source_receipt["source"] == authorization["source"] and source_receipt["workflow"] == authorization["workflow"]
            and identity(source_folder / "source.zip") == source_receipt["archive"],
            "Exact review source archive differs")
    verify_source_archive(source_folder / "source.zip", authorization["source"]["commit"])
    candidate_root = raw / "discovery-installed-candidate"
    candidate = candidate_root / "candidate"
    profile = (ROOT / "discovery-lab/release/profile.json").read_bytes()
    expected = qualification.provenance(candidate, authorization["source"], profile)
    reports = [raw / ("discovery-installed-native-" + selected) for selected in qualification.PROFILES]
    observed = qualification.audit(candidate, reports, profile, expected)
    retained = strict_json((raw / "discovery-installed-audit/discovery-installed-audit.json").read_bytes())
    require(observed == retained, "Retained native custody audit differs from downloaded raw bytes")
    fleet = inherited_audit(raw / "next-publication", authorization["source"]["commit"], authorization["workflow"]["GITHUB_RUN_ID"])
    return observed, fleet, source_receipt


def notes(manifest, assets):
    source = manifest["source"]["commit"]
    text = ("# Discovery installed finite review — " + VERSION + "\n\n"
        "A bounded Linux x64 local-review preview with an exact Alpha source capsule. "
        "Both pinned Node runtimes consume the same saved archive and return actual receipts into one mission history. "
        "Node itself remains a separately obtained hash-pinned prerequisite.\n\n"
        "Aperçu Linux x64 de vérification locale bornée. Les deux runtimes Node épinglés vérifient la même archive. "
        "Aucun service, paiement, portefeuille ou travail externe ne démarre.\n\n"
        "Remote execution is unprovisioned; settlement is disconnected; physical/live-provider acceptance is NOT_RUN. "
        "Production qualification, organizational independence and economic approval remain false. "
        "The source-specific shared-account technical COMMENT is not an APPROVE or a separate institution. "
        "All inherited saved-archive Fleet gates were rechecked; existing Dedicated Fleet and Local Skills releases are unchanged.\n\n"
        f"[Instructions](https://github.com/{REPOSITORY}/blob/{source}/discovery-lab/release/README.md) · "
        f"[Source review]({manifest['authorization']['review']['commentURL']}) · "
        f"[Qualification](https://github.com/{REPOSITORY}/actions/runs/{manifest['workflow']['GITHUB_RUN_ID']})\n\n"
        "| Asset | Bytes | SHA-256 |\n| --- | ---: | --- |\n")
    return text + "".join(f"| {row['name']} | {row['bytes']} | `{row['sha256']}` |\n" for row in assets)


def maybe(api, path):
    try:
        return api(path)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        return None


def publish_assets(transport, source, assets, body, *, before_publish=None):
    api = transport.api
    require(api("/git/ref/heads/main")["object"]["sha"] == source, "Main/source lease differs before publication")
    tag = maybe(api, "/git/ref/tags/" + TAG)
    if tag is None:
        tag = api("/git/refs", method="POST", data=json.dumps({"ref": "refs/tags/" + TAG, "sha": source}).encode())
    require(tag["object"]["type"] == "commit" and tag["object"]["sha"] == source, "Tag differs; replacement is forbidden")
    remote = maybe(api, "/releases/tags/" + TAG)
    if remote is None:
        remote = api("/releases", method="POST", data=json.dumps({"tag_name": TAG, "target_commitish": source,
            "name": TITLE, "body": body, "draft": True, "prerelease": True}).encode())
    require(remote.get("prerelease") is True and remote.get("target_commitish") == source and remote.get("body") == body,
            "Existing preview identity/notes differ; replacement is forbidden")
    expected = {file.name: identity(file) for file in assets}
    require(len(expected) == len(assets), "Duplicate publication asset")
    existing = {row["name"]: row for row in remote["assets"]}
    require(len(existing) == len(remote["assets"]) and set(existing) <= set(expected), "Unexpected existing release assets")
    for file in assets:
        if file.name in existing:
            row = existing[file.name]
            require(row["size"] == expected[file.name]["bytes"] and row.get("digest") == "sha256:" + expected[file.name]["sha256"],
                    "Existing asset differs; replacement is forbidden")
        else:
            require(remote["draft"] is True, "Cannot add assets to an already published preview")
            api(f'/releases/{remote["id"]}/assets?name=' + urllib.parse.quote(file.name, safe=""), method="POST", data=file.read_bytes(), upload=True)
    with tempfile.TemporaryDirectory(prefix="discovery-public-byte-check-", dir=os.environ.get("RUNNER_TEMP")) as temporary:
        verified = []
        for phase in ("draft", "published"):
            observed = api(f'/releases/{remote["id"]}')
            entries = {row["name"]: row for row in observed["assets"]}
            require(len(entries) == len(observed["assets"]) and set(entries) == set(expected) and observed.get("body") == body,
                    "Remote preview membership/notes differ")
            folder = Path(temporary) / phase
            folder.mkdir()
            for name, wanted in expected.items():
                entry = entries[name]
                require(entry["size"] == wanted["bytes"] and entry.get("digest") == "sha256:" + wanted["sha256"], "Remote asset metadata differs")
                transport.download(f'/releases/assets/{entry["id"]}', folder / name, wanted)
                require(identity(folder / name) == wanted, "Public downloaded asset bytes differ")
                verified.append({"phase": phase, "assetId": entry["id"], **wanted})
            tag = api("/git/ref/tags/" + TAG)
            require(tag["object"]["type"] == "commit" and tag["object"]["sha"] == source, "Tag changed during publication")
            require(api("/git/ref/heads/main")["object"]["sha"] == source, "Main/source lease advanced during publication")
            if phase == "draft" and observed["draft"]:
                if before_publish is not None:
                    before_publish()
                api(f'/releases/{remote["id"]}', method="PATCH", data=json.dumps({"draft": False, "prerelease": True,
                    "make_latest": "false", "body": body}).encode())
            if phase == "published":
                require(observed["draft"] is False and observed["prerelease"] is True, "Published preview classification differs")
    return {"releaseId": remote["id"], "tag": TAG, "source": source, "downloadedAssets": verified,
            "productionQualified": False, "organizationalIndependence": False}


def prepare_source(transport, source, number, comment_id, confirmation, output):
    authorization = authorize(transport.api, source, number, comment_id, confirmation)
    require(not output.exists(), "Source evidence output must be absent")
    output.mkdir(mode=0o700)
    archive = output / "source.zip"
    subprocess.run(["git", "archive", "--format=zip", "--output=" + str(archive), source], cwd=ROOT,
                   env=release.git_environment(), check=True)
    write(output / "source-receipt.json", {"schema": "agi-fleet/discovery-preview-review-source/v1",
          "source": authorization["source"], "archive": identity(archive), "workflow": authorization["workflow"]})
    write(output / "authorization.json", authorization)
    return authorization


def publish(transport, source, number, comment_id, confirmation, output):
    authorization = authorize(transport.api, source, number, comment_id, confirmation)
    run, jobs = workflow_jobs(transport.api, authorization)
    require(not output.exists(), "Publication output must be absent")
    output.mkdir(mode=0o700)
    raw = output / "original-artifacts"
    raw.mkdir()
    custody = download_artifacts(transport, authorization, raw, jobs)
    observed, fleet, source_receipt = validate_downloads(raw, authorization)
    # Reauthenticate the public immutable packet and original Alpha metadata.
    # No Fleet-scoped token is assumed to download an Alpha Actions artifact.
    alpha_transport = original_input.ReadOnlyGitHub()
    config = release.regular_bytes(ROOT, "discovery-lab/release/mission-input.json")[0]
    binding, metadata = original_input.fetch_capture(alpha_transport.api, alpha_transport.raw, config,
        release.load_profile()["alpha"], output / "alpha-reverified")
    require(binding == observed["alphaInput"], "Original Alpha input changed before publication")
    write(output / "artifact-custody.json", custody)
    write(output / "workflow-run.json", run)
    write(output / "workflow-jobs.json", jobs)
    assets_folder = output / "assets"
    assets_folder.mkdir()
    candidate = raw / "discovery-installed-candidate/candidate" / (release.PREFIX + ".zip")
    archive = assets_folder / candidate.name
    shutil.copyfile(candidate, archive)
    source_archive = assets_folder / ("Discovery-Source-" + VERSION + ".zip")
    shutil.copyfile(raw / "discovery-publication-source/source.zip", source_archive)
    evidence = assets_folder / ("Discovery-Evidence-" + VERSION + ".zip")
    with zipfile.ZipFile(evidence, "x", zipfile.ZIP_DEFLATED, compresslevel=9) as saved:
        for file in sorted(raw.glob("*.zip")):
            if file.name == "discovery-publication-source.zip":
                continue  # Original source archive is a separately authenticated public asset.
            saved.write(file, "original-artifacts/" + file.name)
        for file in (output / "artifact-custody.json", output / "workflow-run.json", output / "workflow-jobs.json"):
            saved.write(file, file.name)
        saved.writestr("authorization.json", json.dumps(authorization, indent=2))
    manifest = {"schema": "agi-fleet/discovery-published-preview/v1", "version": VERSION, "tag": TAG,
        "status": "qualified-bounded-local-preview", "source": authorization["source"], "workflow": authorization["workflow"],
        "authorization": authorization, "candidate": identity(archive), "reviewSource": identity(source_archive),
        "reviewSourceReceipt": source_receipt, "evidence": identity(evidence), "artifactCustody": custody,
        "installedNativeAudit": observed, "inheritedFleetAudit": fleet["audit"],
        "physicalQualification": "NOT_RUN", "remoteExecution": "unprovisioned", "settlement": "not-connected",
        "authority": "none", "productionQualified": False, "organizationalIndependence": False, "economicApproval": False}
    manifest_file = assets_folder / ("Discovery-Qualification-" + VERSION + ".json")
    write(manifest_file, manifest)
    files = [archive, source_archive, evidence, manifest_file]
    checksums = assets_folder / ("Discovery-SHA256SUMS-" + VERSION + ".txt")
    checksums.write_text("".join(identity(file)["sha256"] + "  " + file.name + "\n" for file in files))
    files.append(checksums)
    body = notes(manifest, [identity(file) for file in files])
    (output / "release-notes.md").write_text(body)
    require(authorize(transport.api, source, number, comment_id, confirmation) == authorization,
            "Review/source authorization changed before public mutation")
    def publication_lease():
        require(authorize(transport.api, source, number, comment_id, confirmation) == authorization,
                "Review/source authorization changed before draft publication")
        require(original_input.same_json(original_input.authenticated_metadata(alpha_transport.api, binding), metadata),
                "Alpha input custody changed before draft publication")
        workflow_jobs(transport.api, authorization)
    result = publish_assets(transport, source, files, body, before_publish=publication_lease)
    write(output / "published-byte-verification.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("authorize", "publish"))
    parser.add_argument("--source", required=True)
    parser.add_argument("--review-pr", required=True, type=int)
    parser.add_argument("--review-comment", required=True, type=int)
    parser.add_argument("--confirm", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    transport = GitHub(os.environ.get("GH_TOKEN"))
    function = prepare_source if args.command == "authorize" else publish
    result = function(transport, args.source, args.review_pr, args.review_comment, args.confirm, args.output)
    print(json.dumps({"status": "AUTHORIZED_SOURCE" if args.command == "authorize" else "PUBLISHED",
                      "source": args.source, "tag": TAG, "productionQualified": False}))
