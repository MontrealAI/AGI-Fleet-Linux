# SPDX-License-Identifier: Apache-2.0
"""Bind the new installed profile's saved bytes and two native job observations."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import zipfile

import discovery_release as release
import discovery_alpha_input as original_input

PROFILES = ("fleet-linux-x64", "alpha-compatible-linux-x64")
DOCKET_PATHS = {"00_manifest.md", "01_claims_matrix.md", "02_environment.md", "03_benchmark_tasks/spec.json",
                "04_baselines/comparison.json", "05_agialpha_runs/run.json", "06_proof_bundles/capability.json",
                "07_replay_logs/replay.json", "08_cost_ledgers/costs.json", "09_safety_ledgers/safety.json",
                "10_validator_reports/review.json", "11_alpha_wu_calibration/status.json", "12_summary_tables/outcome.json"}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def document(path: Path) -> dict:
    return json.loads(path.read_bytes())


def candidate_bytes(candidate: Path) -> tuple[dict, bytes, dict, bytes]:
    receipt = document(candidate / "package-receipt.json")
    if receipt.get("archive") != release.PREFIX + ".zip":
        raise ValueError("Wrong candidate archive name")
    archive = (candidate / receipt["archive"]).read_bytes()
    if len(archive) != receipt["bytes"] or digest(archive) != receipt["sha256"]:
        raise ValueError("Candidate bytes differ from package receipt")
    with zipfile.ZipFile(candidate / receipt["archive"]) as saved:
        manifest_bytes = saved.read(release.PREFIX + "/" + release.MANIFEST)
        profile_bytes = saved.read(release.PREFIX + "/discovery-lab/release/profile.json")
    if digest(manifest_bytes) != receipt["manifestSha256"]:
        raise ValueError("Candidate manifest differs from receipt")
    return receipt, profile_bytes, json.loads(manifest_bytes), manifest_bytes


def provenance(candidate: Path, source: dict, profile_bytes: bytes) -> dict:
    receipt, _, _, _ = candidate_bytes(candidate)
    workflow = {key: os.environ[key] for key in ("GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_RUN_ID",
                "GITHUB_RUN_ATTEMPT", "GITHUB_EVENT_NAME", "GITHUB_WORKFLOW_REF")}
    if workflow["GITHUB_REPOSITORY"] != source["repository"] or workflow["GITHUB_SHA"] != source["commit"]:
        raise ValueError("Workflow and exact source differ")
    return {"schema": "agi-fleet/discovery-installed-hosted-provenance/v1", "source": source, "workflow": workflow,
            "candidateSha256": receipt["sha256"], "receiptSha256": digest((candidate / "package-receipt.json").read_bytes()),
            "profileSha256": digest(profile_bytes)}


def audit_native_evidence(evidence: Path, native: dict, initial_raw: bytes, requests: dict,
                          campaign_digest: str, receiver_source: dict, profile: dict, manifest_digest: str,
                          *, sequential_workspace: bool = False) -> None:
    """Audit each lane's own raw history and two returns without merging missions."""
    initial = json.loads(initial_raw)
    selected = native["profile"]
    final = document(evidence / "workspace.json")
    if ((evidence / "initial-workspace.json").read_bytes() != initial_raw
            or native.get("missionId") != initial["missionId"] or final.get("missionId") != initial["missionId"] or final.get("revision") != initial["revision"] + 2
            or final.get("events", [])[:-2] != initial["events"]
            or len(final["events"]) != len(initial["events"]) + 2
            or final["events"][-2]["previous"] != initial["events"][-1]["digest"]
            or final["events"][-1]["previous"] != final["events"][-2]["digest"]
            or native.get("historyHead") != final["events"][-1]["digest"]
            or [row["kind"] for row in final["events"][-2:]] != ["lab-evidence-attached", "lab-evidence-attached"]):
        raise ValueError("Native history does not preserve its original mission prefix")
    if digest((evidence / "docket.json").read_bytes()) != native["docketSha256"]:
        raise ValueError("Native docket differs from retained bytes")
    docket = document(evidence / "docket.json")
    if set(docket["files"]) != DOCKET_PATHS or json.loads(docket["files"]["05_agialpha_runs/run.json"])["workspace"] != final:
        raise ValueError("Native 13-file docket does not contain the same continued mission")
    if [(row["currency"], row["route"]) for row in native["cases"]] != [("USDC", "manager-usdc"), ("AGIALPHA", "jobs-agialpha")]:
        raise ValueError("Both alternative routes are required")
    if len({row["receiptId"] for row in native["cases"]}) != 2:
        raise ValueError("Native observations must retain their two distinct request identities")
    for index, row in enumerate(native["cases"]):
        prefix = row["currency"].lower()
        wrapper = document(evidence / (prefix + "-return.json"))
        envelope = json.loads(wrapper["raw"])
        raw_receipt = json.loads(envelope["receiptRaw"])
        observation = document(evidence / (prefix + "-installed-observation.json"))
        request = (evidence / (prefix + "-request.json")).read_bytes()
        original_request = requests[row["currency"]]
        workspace_sha256 = digest(initial_raw)
        if sequential_workspace and index:
            # The preserved constructed harness reviews its second draft after
            # attaching the first return. Reconstruct that lane's own prefix;
            # original UI acceptance always uses the unchanged original bytes.
            intermediate = {**initial, "events": final["events"][:-1], "revision": initial["revision"] + 1}
            workspace_sha256 = digest(json.dumps(intermediate, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode())
        if (request != original_request or json.loads(request).get("missionId") != initial["missionId"]
                or digest(request) != row["requestSha256"] or envelope["original"].encode() != request
                or envelope["schema"] != "agi-fleet/discovery-review-return/v1" or wrapper["source"] != receiver_source
                or digest(json.dumps(wrapper, ensure_ascii=False, separators=(",", ":")).encode()) != row["returnSha256"]
                or digest(envelope["receiptRaw"].encode()) != row["receiptSha256"]
                or raw_receipt.get("state") != "accepted-local-review" or raw_receipt.get("authority") != "none"
                or raw_receipt.get("remoteExecution") != "unprovisioned" or raw_receipt.get("organizationalIndependence") is not False
                or observation["runtimeProfile"] != selected or observation["runtime"] != profile["runtimeProfiles"][selected]
                or observation["manifestSha256"] != manifest_digest
                or observation.get("workspaceSha256") != workspace_sha256
                or observation["requestSha256"] != row["requestSha256"]
                or observation["receiptSha256"] != row["receiptSha256"]
                or observation["state"] != "accepted-local-review" or row["state"] != "accepted-local-review"):
            raise ValueError("Native observation bytes or pinned runtime differ")
        event = final["events"][-2 + index]
        payload = event.get("payload", {})
        if (set(payload) != {"kind", "campaignDigest", "record", "recordDigest"}
                or payload["kind"] != "receiver-receipt" or payload["campaignDigest"] != campaign_digest
                or payload["record"] != wrapper
                or payload["recordDigest"] != digest(json.dumps(wrapper, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode())):
            raise ValueError("Continued history does not contain its actual native return")


def audit(candidate: Path, reports: list[Path], profile_bytes: bytes, expected: dict) -> dict:
    receipt, saved_profile, manifest, manifest_bytes = candidate_bytes(candidate)
    profile = json.loads(profile_bytes)
    if (profile["qualification"] != "FROZEN_SOURCE_PROFILE" or saved_profile != profile_bytes
            or manifest["profileSha256"] != digest(profile_bytes) or receipt["source"] != expected["source"]
            or manifest["source"] != expected["source"] or document(candidate.parent / "provenance.json") != expected):
        raise ValueError("Candidate source/profile/provenance differs")
    if len(reports) != len(PROFILES):
        raise ValueError("Both separately pinned runtime observations are required")
    alpha = {key: profile["alpha"][key] for key in ("commit", "tree", "sourceHash")}
    members = {row["path"]: row for row in manifest["files"]}
    with zipfile.ZipFile(candidate / receipt["archive"]) as saved:
        input_profile = saved.read(release.PREFIX + "/discovery-lab/release/mission-input.json")
        transport = original_input.profile(input_profile)
        custody_raw = saved.read(release.PREFIX + "/mission-input/CUSTODY.json")
        custody = original_input.document(custody_raw)
        binding = original_input.binding(custody, profile["alpha"])
        metadata = {name: saved.read(release.PREFIX + "/mission-input/" + name) for name in original_input.METADATA}
        inputs = {name: saved.read(release.PREFIX + "/mission-input/" + name) for name in original_input.MEMBERS}
    if digest(custody_raw) != transport["custodySha256"] or len(custody_raw) != transport["custodyBytes"]:
        raise ValueError("Candidate original Alpha custody differs")
    original_input.retained_metadata(metadata, binding)
    original_input.validate_members(inputs, binding, profile["alpha"])
    initial_raw = inputs[original_input.PREFIX + "fleet-browser-workspace.json"]
    initial = json.loads(initial_raw)
    journal = json.loads(inputs[original_input.PREFIX + "browser-native-requests.json"])
    receiver_source = {**expected["source"], "adapterSha256": members["discovery-lab/receiver.mjs"]["sha256"],
                       "contractSha256": members["discovery-lab/contract.mjs"]["sha256"]}
    seen = set()
    for folder in reports:
        native = document(folder / "installed-native/qualification.json")
        selected = native["profile"]
        if selected not in PROFILES or selected in seen:
            raise ValueError("Missing or duplicate runtime profile")
        seen.add(selected)
        if (document(folder / "provenance.json") != expected or native["fleetSource"] != expected["source"]
                or native["alpha"] != alpha or native["manifestSha256"] != digest(manifest_bytes)
                or native["passed"] != 2 or native["total"] != 2
                or native.get("inputKind") != "authenticated-alpha-ui-artifact"
                or native.get("inputCustodySha256") != digest(custody_raw)
                or native.get("inputWorkspaceSha256") != digest(initial_raw)
                or native.get("missionId") != initial["missionId"]
                or native.get("inputEventPrefix") != journal["workspace"]["eventPrefix"]
                or native.get("inputHistoryHead") != journal["workspace"]["head"]
                or native.get("inputRevision") != initial["revision"]
                or any(native.get(key) is not True for key in ("sameHistory", "duplicateRefused", "reopenedDocketByteIdentical"))
                or native.get("authority") != "none" or native.get("remoteExecution") != "unprovisioned"
                or native.get("organizationalIndependence") is not False or native.get("totalComplete") is not False):
            raise ValueError("Native report does not qualify this bounded saved candidate")
        evidence = folder / "installed-native"
        constructed_folder = folder / "constructed-fixture"
        constructed = document(constructed_folder / "qualification.json")
        if (constructed.get("inputKind") != "constructed-regression-fixture" or constructed.get("profile") != selected
                or constructed.get("fleetSource") != expected["source"] or constructed.get("alpha") != alpha
                or constructed.get("manifestSha256") != digest(manifest_bytes) or constructed.get("passed") != 2
                or constructed.get("total") != 2 or constructed.get("missionId") == initial["missionId"]
                or constructed.get("authority") != "none" or constructed.get("remoteExecution") != "unprovisioned"
                or constructed.get("organizationalIndependence") is not False or constructed.get("totalComplete") is not False
                or any(constructed.get(key) is not True for key in ("sameHistory", "duplicateRefused", "reopenedDocketByteIdentical"))
                or digest((constructed_folder / "docket.json").read_bytes()) != constructed.get("docketSha256")):
            raise ValueError("Separate constructed native regression is missing or mixed with the original mission")
        audit_native_evidence(evidence, native, initial_raw,
            {"USDC": inputs[original_input.PREFIX + "fleet-browser-request.json"],
             "AGIALPHA": inputs[original_input.PREFIX + "jobs-browser-request.json"]},
            journal["campaignDigest"], receiver_source, profile, digest(manifest_bytes))
        constructed_initial_raw = (constructed_folder / "initial-workspace.json").read_bytes()
        constructed_initial = json.loads(constructed_initial_raw)
        audit_native_evidence(constructed_folder, constructed, constructed_initial_raw,
            {currency: (constructed_folder / (currency.lower() + "-request.json")).read_bytes()
             for currency in ("USDC", "AGIALPHA")},
            constructed_initial["events"][-1]["digest"], receiver_source, profile, digest(manifest_bytes),
            sequential_workspace=True)
    return {"schema": "agi-fleet/discovery-installed-hosted-audit/v1", "source": expected["source"],
            "workflow": expected["workflow"], "candidateSha256": receipt["sha256"], "profiles": sorted(seen),
            "nativeCases": 4, "scope": "same-saved-archive-and-original-alpha-ui-mission-two-local-native-runtime-observations",
            "alphaInput": binding, "alphaInputTransport": transport,
            "inputCustodySha256": digest(custody_raw), "missionId": initial["missionId"],
            "inputWorkspaceSha256": digest(initial_raw),
            "constructedRegressionCases": 4, "constructedHistories": "separate; never original UI acceptance",
            "browser": "NOT_RUN_BY_THIS_LANE", "legacyReleaseGates": "SEPARATE_UNCHANGED_REQUIREMENTS",
            "eligibleOwnerReview": "NOT_ESTABLISHED_BY_THIS_LANE", "publication": "HELD",
            "authority": "none", "productionQualified": False, "organizationalIndependence": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("provenance", "audit"))
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--reports", nargs="*", type=Path)
    args = parser.parse_args()
    commit, tree = release.clean_git_root(release.ROOT)
    source = {"repository": "MontrealAI/AGI-Fleet-Linux", "commit": commit, "tree": tree}
    raw_profile = release.regular_bytes(release.ROOT, "discovery-lab/release/profile.json")[0]
    expected = provenance(args.candidate, source, raw_profile)
    result = expected if args.command == "provenance" else audit(args.candidate, args.reports or [], raw_profile, expected)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
