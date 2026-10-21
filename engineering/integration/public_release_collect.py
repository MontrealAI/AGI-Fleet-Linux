"""Independent read-only semantic collection of the actual consumer artifacts.

Downloads the original artifact ZIPs once, checks GitHub digests, and calls the
unchanged semantic collector with independently derived producer identities.
It never starts service/native/browser/model work.
"""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import runpy
import subprocess
globals().update({key: value for key, value in runpy.run_path(
    str(Path(__file__).with_name("public_release_install.py"))).items() if not key.startswith("__")})

def unpack_artifact(archive, destination):
    require(not destination.exists(), "new artifact extraction directory")
    destination.mkdir(mode=0o700)
    entries = inspect_zip(archive)
    with zipfile.ZipFile(archive) as source:
        for name, info in entries.items():
            require(name.startswith(("computer-evidence/", "local-host-evidence/", "public-package-evidence/")),
                    "unexpected public artifact prefix")
            mode = info.external_attr >> 16
            require(not stat.S_ISLNK(mode) and (mode == 0 or stat.S_ISREG(mode) or mode & 0o170000 == 0),
                    "nonregular public evidence member")
            save(destination / name, source.read(info))
    return entries

def collect(bundle, work, artifacts, output):
    value, producer, authenticated = run("verify", bundle)
    require((work / "source-packages.json").is_file(), "independently materialized source packages required")
    checksums(bundle, value)
    public_manifests(bundle, value)
    repository = "/repos/" + REPOSITORIES["fleet"]
    jobs = pages(repository + "/actions/runs/" + producer["workflowRun"] + "/attempts/1/jobs", "jobs")
    remote = pages(repository + "/actions/runs/" + producer["workflowRun"] + "/artifacts", "artifacts")
    artifacts.mkdir(mode=0o700)
    results = {}
    source_packages = strict_json((work / "source-packages.json").read_bytes())
    for arch in ("x64", "arm64"):
        producers = [job for job in jobs
            if job["name"].endswith("Final public package service and two disposable payment routes (" + arch + ")")]
        require(len(producers) == 1 and producers[0]["status"] == "completed"
                and producers[0]["conclusion"] == "success", "both genuine native producer jobs required")
        runner = "ubuntu-24.04" if arch == "x64" else "ubuntu-24.04-arm"
        require(runner in producers[0]["labels"] and producers[0]["runner_id"] > 0, "actual expected hosted runner")
        name = "final-public-package-journey-" + arch
        selected = [item for item in remote if item["name"] == name]
        require(len(selected) == 1, "one original artifact per architecture")
        artifact = selected[0]
        require(artifact["expired"] is False and artifact["workflow_run"]["id"] == int(producer["workflowRun"])
                and artifact["workflow_run"]["head_sha"] == producer["commit"]
                and "refs/heads/" + artifact["workflow_run"]["head_branch"] == producer["ref"]
                and re.fullmatch("sha256:[a-f0-9]{64}", artifact["digest"] or ""), "authentic original artifact producer")
        archive = artifacts / (str(artifact["id"]) + ".zip")
        download("https://api.github.com" + repository + "/actions/artifacts/" + str(artifact["id"]) + "/zip",
                 archive, artifact["size_in_bytes"], artifact["digest"][7:])
        folder = artifacts / arch
        entries = unpack_artifact(archive, folder)
        evidence = folder / "computer-evidence"
        original = strict_json((evidence / "compatibility-evidence.json").read_bytes())
        allowed = {"computer-evidence/" + row["name"] for row in original["artifacts"]} | {
            "computer-evidence/compatibility-evidence.json",
            "local-host-evidence/computer-journey.json",
            "public-package-evidence/public-package-proof.json"}
        require(set(entries) == allowed, "public upload inventory differs from original collector plus explicit package proof")
        actual_archive, expected_archive = fleet_archive(bundle, value, work, arch)
        expected_context = {"repository": producer["repository"], "commit": producer["commit"],
            "workflowRun": producer["workflowRun"], "workflowAttempt": producer["workflowAttempt"],
            "architecture": arch, "archiveSHA256": digest(actual_archive)}
        require(expected_context["archiveSHA256"] == expected_archive["sha256"], "independent actual archive digest")
        subprocess.run(["node", str(ROOT / "engineering/integration/verify-evidence.mjs"),
            str(evidence), str(ROOT / ".integration-alpha"), str(ROOT / ".integration-jobs"),
            str(ROOT / ".integration-manager"), "--read-only", "--expected-context",
            json.dumps(expected_context, separators=(",", ":"))], check=True, timeout=180)
        proof = strict_json((folder / "public-package-evidence/public-package-proof.json").read_bytes())
        require(proof["producer"] == producer and proof["consumerSource"] == value["consumerSource"]
                and proof["releaseInputs"] == value, "package proof execution or release binding")
        require(proof["sourcePackages"]["packages"] == source_packages["packages"], "independent actual package-to-Git materialization differs")
        require(proof["installation"]["innerArchive"] == expected_archive
                and proof["installation"]["package"] == strict_json((work / "manifests.json").read_bytes())["fleet"]["packages"][arch]["extractedInventory"],
                "normal installed inventory differs from original exact package")
        require(proof["jobsSourceTransition"] == strict_json((work / "independent-jobs-source-transition.json").read_bytes()),
                "existing Jobs source transition did not independently reproduce")
        require(proof["wheel"]["asset"] == value["repositories"]["alpha"]["assets"]["wheel"]
                and proof["wheel"]["wheelExecutionClaim"] == "INSTALLED_CLI_PHASE_ONLY"
                and proof["sourcePackages"]["nativeExecution"] == "ACTUAL_RELEASED_SOURCE_PACKAGE_NOT_INSTALLED_WHEEL",
                "wheel and native source-package claims differ")
        wheel_records = {entry["path"]: entry for entry in proof["wheel"]["payload"]}
        require(len(wheel_records) == len(proof["wheel"]["payload"]), "duplicate wheel observation")
        with zipfile.ZipFile(selected_file(bundle, value, "alpha", "wheel")) as wheel:
            members = inspect_zip(selected_file(bundle, value, "alpha", "wheel"))
            selected_members = {name for name in members if ".dist-info/" not in name}
            require(set(wheel_records) == selected_members, "installed wheel observation inventory")
            for name in selected_members:
                raw = wheel.read(name)
                observed = wheel_records[name]
                require(observed["sha256"] == sha(raw) and observed["bytes"] == len(raw), "installed wheel observation bytes")
                if name.endswith(".py"):
                    require(git(ROOT / ".integration-alpha", "show",
                        value["repositories"]["alpha"]["released"]["commit"] + ":" + name, binary=True) == raw,
                        "independent wheel Python Git binding")
                    mode = git(ROOT / ".integration-alpha", "ls-tree",
                        value["repositories"]["alpha"]["released"]["commit"], "--", name).split()[0]
                    require(observed["installedMode"] == (0o755 if mode == "100755" else 0o644),
                            "installed wheel Python Git mode")
        results[arch] = {"job": producers[0], "artifact": artifact,
            "downloadedArchiveSHA256": digest(archive), "expectedContext": expected_context,
            "originalSemanticCollector": "PASS_READ_ONLY_REPLAY_NOT_NEW_EXECUTION",
            "publicPackageProofSHA256": digest(folder / "public-package-evidence/public-package-proof.json")}
    save(output, encoded({"schema": "agi-fleet/independent-public-package-collection/v1",
         "producer": producer, "consumerSource": value["consumerSource"], "architectures": results,
         "sourceQualification": "ORIGINAL_RELEASE_QUALIFICATION_REMAINS_REQUIRED",
         "nativeExecutedByCollector": False, "productionQualified": False,
         "independentEconomicReview": False, "providerRequests": 0, "humanMinutes": None, "deviceCost": None}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    collect(args.bundle.absolute(), args.work.absolute(), args.artifacts.absolute(), args.output.absolute())
