# SPDX-License-Identifier: Apache-2.0
"""Tiny inert artifact-shaped data. Never a browser or installed acceptance."""
import json
from pathlib import Path
import zipfile


def prepare(module, base: Path, alpha):
    raw = lambda value: json.dumps(value).encode()
    prefix = module.PREFIX
    source_map = {name: row["sha256"] for name, row in alpha["files"].items()
                  if name.startswith("examples/")}
    catalog = {"sourceHash": alpha["sourceHash"], "sources": source_map}
    page = b"<!doctype html><title>Inert source page</title>\n"
    workspace = {"missionId": "inert-original-mission", "revision": 1, "events": [{"digest": "a" * 64}]}
    files = {"source.json": raw({"commit": alpha["commit"], "source": catalog, "trackedDiff": ""}),
             "exact-checkout.json": raw({"commit": alpha["commit"], "tree": alpha["tree"], "source": catalog, "files": source_map}),
             prefix + "served/sources.json": raw(catalog), prefix + "served/index.html": page,
             prefix + "fleet-browser-workspace.json": raw(workspace), prefix + "jobs-browser-workspace.json": raw(workspace)}
    requests = {}
    for route, filename, currency in (("manager-usdc", "fleet-browser-request.json", "USDC6"),
                                      ("jobs-agialpha", "jobs-browser-request.json", "AGIALPHA18")):
        files[prefix + filename] = raw({"missionId": workspace["missionId"],
            "commission": {"id": "inert-alternative", "branch": route, "route": route, "currency": currency,
                           "capBaseUnits": "0", "status": "DRAFT_NOT_SUBMITTED"}})
        requests[route] = {"file": filename, "sha256": module.release.sha(files[prefix + filename]), "currency": currency}
    journal = {"schema": "actual-browser-native-request-exports/v1", "missionId": workspace["missionId"],
        "campaignDigest": "c" * 64, "sourceHash": alpha["sourceHash"], "pageSha256": module.release.sha(page),
        "workspace": {"file": "fleet-browser-workspace.json", "sha256": module.release.sha(raw(workspace)),
            "jobsFile": "jobs-browser-workspace.json", "jobsSha256": module.release.sha(raw(workspace)),
            "revision": 1, "eventPrefix": ["a" * 64], "head": "a" * 64}, "requests": requests}
    files[prefix + "browser-native-requests.json"] = raw(journal)
    files[prefix + "fleet-native/native-proof.json"] = raw({"schema": "actual-browser-fleet-native-return/v1",
        "alphaCommit": alpha["commit"], "alphaTree": alpha["tree"], "sourceHash": alpha["sourceHash"],
        "missionId": workspace["missionId"], "campaignDigest": "c" * 64,
        "workspaceSha256": journal["workspace"]["sha256"], "requestSha256": requests["manager-usdc"]["sha256"]})
    files[prefix + "journey.json"] = raw({"passed": True, "pageErrors": [], "source": catalog,
        "pageSha256": module.release.sha(page)})
    archive = base / "alpha-original.zip"
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as saved:
        for name, value in files.items():
            saved.writestr(name, value)
    binding = {"acceptedCommit": alpha["commit"], "acceptedTree": alpha["tree"], "checkoutCommit": alpha["commit"],
        "checkoutTree": alpha["tree"], "checkoutParents": [], "headSha": alpha["commit"], "baseSha": None,
        "runId": 10, "runAttempt": 2, "workflowId": 30, "workflowPath": module.WORKFLOW, "event": "push",
        "artifactId": 40, "artifactName": "successor-capability-" + alpha["commit"],
        "artifactSha256": module.release.sha(archive.read_bytes()), "artifactBytes": archive.stat().st_size,
        "sourceHash": alpha["sourceHash"], "pageSha256": module.release.sha(page),
        "members": {name: {"bytes": len(value), "sha256": module.release.sha(value)} for name, value in files.items()}}
    metadata = {"run": {"id": 10, "run_attempt": 2, "head_sha": alpha["commit"], "event": "push", "head_branch": "main", "workflow_id": 30,
        "path": module.WORKFLOW, "repository": {"full_name": module.REPOSITORY},
        "head_repository": {"full_name": module.REPOSITORY}, "status": "completed", "conclusion": "success",
        "display_title": "Original inert run", "ancillary": {"enabled": True, "labels": ["one", "two"]}},
        "job": {"id": 50, "name": "capability", "run_id": 10, "head_sha": alpha["commit"], "status": "completed", "conclusion": "success", "started_at": "2026-10-22T00:00:00Z",
            "completed_at": "2026-10-22T00:02:00Z", "steps": [{"name": name, "status": "completed", "conclusion": "success"} for name in
                ("Bind retained evidence to exact source", "Saved future-task protocol, docket and real-task boundary acceptance",
                 "Retain exact-source screenshots and journey evidence")]},
        "artifact": {"id": 40, "name": binding["artifactName"], "expired": False, "size_in_bytes": binding["artifactBytes"],
            "digest": "sha256:" + binding["artifactSha256"], "workflow_run": {"id": 10, "head_sha": alpha["commit"]},
            "created_at": "2026-10-22T00:01:00Z"},
        "acceptedCommit": {"sha": alpha["commit"], "tree": {"sha": alpha["tree"]}, "parents": [],
            "message": "Original inert Git commit", "verification": {"verified": False, "reason": "unsigned"}},
        "checkoutCommit": {"sha": alpha["commit"], "tree": {"sha": alpha["tree"]}, "parents": [],
            "message": "Original inert Git commit", "verification": {"verified": False, "reason": "unsigned"}}}
    custody = {"schema": "successor/discovery-browser-artifact-custody/v1", "repository": module.REPOSITORY,
        "workflowPath": module.WORKFLOW, "producer": {"runId": 10, "runAttempt": 2, "workflowId": 30,
            "event": "push", "headBranch": "main", "headCommit": alpha["commit"], "checkoutCommit": alpha["commit"],
            "checkoutTree": alpha["tree"], "checkoutParents": []},
        "artifact": {"id": 40, "name": binding["artifactName"], "digest": "sha256:" + binding["artifactSha256"],
            "sizeInBytes": binding["artifactBytes"]}, "sourceHash": alpha["sourceHash"], "pageSha256": module.release.sha(page),
        "catalogSha256": alpha["files"]["docs/successor/capabilities/sources.json"]["sha256"],
        "inventory": binding["members"], "members": binding["members"]}
    custody_raw = raw(custody)
    snapshots = {'run': metadata['run'], 'jobs': {'total_count': 1, 'jobs': [metadata['job']]},
                 'artifacts': {'total_count': 1, 'artifacts': [metadata['artifact']]},
                 'checkout-commit': metadata['checkoutCommit'], 'public-commit': metadata['acceptedCommit']}
    metadata_files = {'metadata/' + name + '.json': raw(value) for name, value in snapshots.items()}
    for name, value in {**files, **metadata_files, "CUSTODY.json": custody_raw}.items():
        target = base / "input" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value)
    return {"schema": "agi-fleet/discovery-alpha-input-profile/v1", "qualification": "FROZEN_AUTHENTICATED_INPUT",
            "transport": {"repository": module.REPOSITORY, "commit": "e" * 40, "tree": "f" * 40,
                "path": "discovery-input", "custodySha256": module.release.sha(custody_raw), "custodyBytes": len(custody_raw),
                "custodyGitBlob": module.hashlib.sha1(b"blob " + str(len(custody_raw)).encode() + b"\0" + custody_raw).hexdigest()},
            "authority": "none"}
