"""Materialize authenticated released packages and observe normal installation.

No checked-out source file may fill an omission in a released source archive.
Native execution is explicitly from the released SOURCE package; the installed
wheel has its own separate CLI observation.
"""
from __future__ import annotations
import argparse
import csv
import io
import os
from pathlib import Path
import platform
import re
import runpy
import subprocess
import sys
import sysconfig
import zipfile
globals().update({key: value for key, value in runpy.run_path(
    str(Path(__file__).with_name("public_release_assets.py"))).items() if not key.startswith("__")})

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = "agi-fleet-local-0.1.0-alpha.7.zip"

def selected_file(bundle, value, role, asset_role):
    return bundle / role / value["repositories"][role]["assets"][asset_role]["name"]

def checksums(bundle, value):
    for role, repository in value["repositories"].items():
        table = {}
        for line in selected_file(bundle, value, role, "checksums").read_text().splitlines():
            match = re.fullmatch(r"([a-f0-9]{64}) [ *]([A-Za-z0-9][A-Za-z0-9._-]{0,179})", line)
            require(match is not None and match[2] not in table, "canonical checksum entry")
            table[match[2]] = match[1]
        for name, asset in repository["assets"].items():
            if name != "checksums":
                require(table.get(asset["name"]) == asset["sha256"], "selected asset absent from public checksums")

def manager_inventory(bundle, value):
    manifest_raw = selected_file(bundle, value, "manager", "manifest").read_bytes()
    manifest = strict_json(manifest_raw)
    repository = value["repositories"]["manager"]
    require(manifest["repository"] == repository["repository"] and manifest["tag"] == repository["tag"]
            and manifest["sourceCommit"] == repository["released"]["commit"]
            and manifest["sourceTree"] == repository["released"]["tree"], "Manager manifest source")
    prefix = "AGIJobManager-" + repository["tag"] + "/"
    archive = selected_file(bundle, value, "manager", "package")
    entries = inspect_zip(archive)
    require(set(entries) == {prefix + name for name in manifest["files"]} | {prefix + "RELEASE_MANIFEST.json"},
            "Manager complete package inventory")
    with zipfile.ZipFile(archive) as source:
        require(source.read(prefix + "RELEASE_MANIFEST.json") == manifest_raw, "Manager embedded manifest")
        for name, expected in manifest["files"].items():
            raw = source.read(prefix + name)
            info = entries[prefix + name]
            require(len(raw) == expected["bytes"] and sha(raw) == expected["sha256"]
                    and info.external_attr >> 16 == expected["mode"], "Manager package member identity")
    return manifest, prefix + "source/"

def public_manifests(bundle, value):
    alpha = strict_json(selected_file(bundle, value, "alpha", "manifest").read_bytes())
    a = value["repositories"]["alpha"]
    require(alpha["repository"] == a["repository"] and alpha["commit"] == a["released"]["commit"]
            and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", alpha["version"]), "Alpha manifest source")
    require(a["assets"]["source"]["name"] == "alpha-agent-v" + alpha["version"] + "-source.zip",
            "Alpha explicit source asset role")
    jobs = strict_json(selected_file(bundle, value, "jobs", "provenance").read_bytes())
    j = value["repositories"]["jobs"]
    require(jobs["repository"] == j["repository"] and jobs["sha"] == j["released"]["commit"]
            and jobs["tree"] == j["released"]["tree"] and jobs["tag"] == j["tag"]
            and jobs["productionApproved"] is False, "Jobs provenance source")
    require(j["assets"]["source"]["name"] == j["tag"] + "-source.zip", "Jobs explicit source asset")
    fleet = strict_json(selected_file(bundle, value, "fleet", "manifest").read_bytes())
    f = value["repositories"]["fleet"]
    require(fleet["schema"] == "agi-fleet/ti-published-source-preview/v1"
            and fleet["status"] == "PASS" and fleet["source"] == f["released"]
            and fleet["version"] == "0.1.0-alpha.7" and fleet["authority"] == "none",
            "Fleet original published TI manifest")
    manager, manager_prefix = manager_inventory(bundle, value)
    return {"alpha": alpha, "jobs": jobs, "fleet": fleet, "manager": manager}, {
        "alpha": "AGI-Alpha-Agent-v" + alpha["version"] + "/",
        "jobs": "AGIJobsv0/", "manager": manager_prefix}

def sources(bundle, work):
    value, producer, authenticated = run("verify", bundle)
    checksums(bundle, value)
    manifests, prefixes = public_manifests(bundle, value)
    require(not work.exists() and work.parent.resolve() == work.parent, "new materialization directory")
    work.mkdir(mode=0o700)
    lock = strict_json((ROOT / "engineering/integration/compatibility-set.json").read_bytes())
    pins = strict_json((ROOT / "engineering/transformation/source-pins.json").read_bytes())
    observations = {}
    for role in ("alpha", "jobs", "manager"):
        released = value["repositories"][role]["released"]
        require(lock[role] == released["commit"] and pins[role]["commit"] == released["commit"]
                and pins[role]["tree"] == released["tree"], "final Fleet pin is not actual released S2")
        archive_role = "package" if role == "manager" else "source"
        observations[role] = genuine_source(
            REPOSITORIES[role], released, selected_file(bundle, value, role, archive_role),
            prefixes[role], ROOT / (".integration-" + role), role)
    require(pins["computer"]["commit"] == value["repositories"]["alpha"]["released"]["commit"]
            and pins["computer"]["tree"] == value["repositories"]["alpha"]["released"]["tree"],
            "Computer pin differs from released Alpha")
    require(manifests["fleet"]["sourcePins"] == pins, "published Fleet source pins differ")
    save(work / "source-packages.json", encoded({"schema": "agi-fleet/materialized-public-source/v1",
         "producer": producer, "sourceContinuity": {k: v["sourceContinuity"] for k, v in value["repositories"].items()},
         "packages": observations, "nativeExecution": "ACTUAL_RELEASED_SOURCE_PACKAGE_NOT_INSTALLED_WHEEL"}))
    save(work / "manifests.json", encoded(manifests))

def fleet_archive(bundle, value, work, arch):
    manifest = strict_json((work / "manifests.json").read_bytes())["fleet"]
    expected = manifest["packages"][arch]["archive"]
    asset_role = "packageX64" if arch == "x64" else "packageArm64"
    public = selected_file(bundle, value, "fleet", asset_role)
    outer = value["repositories"]["fleet"]["assets"][asset_role]
    require({"name": outer["name"], "bytes": outer["bytes"], "sha256": outer["sha256"]}
            in manifest["packageAssets"], "Fleet public package role absent from manifest")
    target = work / "archives" / arch / ARCHIVE
    target.parent.mkdir(parents=True, mode=0o700)
    if manifest["packageMode"] == "IDENTICAL_RAW_ARCHIVES_BOTH_NATIVE_ARCHITECTURES":
        require(public.name == ARCHIVE and expected == {"name": public.name, "bytes": public.stat().st_size,
                                                       "sha256": digest(public)}, "canonical Fleet archive differs")
        save(target, public.read_bytes())
    else:
        require(manifest["packageMode"] == "DISTINCT_RAW_SERIALIZATION_IDENTICAL_SOURCE_MEMBERS_ARCH_LABELLED_CONTAINERS",
                "unsupported Fleet public package mode")
        entries = inspect_zip(public)
        require(set(entries) == {ARCHIVE, "package-receipt.json"}, "Fleet outer container inventory")
        with zipfile.ZipFile(public) as source:
            raw = source.read(ARCHIVE)
            receipt = strict_json(source.read("package-receipt.json"))
        require(receipt == manifest["packages"][arch]["receipt"], "Fleet original inner receipt differs")
        require(expected == {"name": ARCHIVE, "bytes": len(raw), "sha256": sha(raw)}, "Fleet original inner bytes differ")
        save(target, raw)
    return target, expected

def installation(bundle, work, arch):
    value, producer, authenticated = run("verify", bundle)
    require(arch in {"x64", "arm64"}
            and {"x86_64": "x64", "aarch64": "arm64"}.get(platform.machine()) == arch, "actual architecture")
    archive, expected = fleet_archive(bundle, value, work, arch)
    installer = runpy.run_path(str(ROOT / "local-runtime/install.py"))
    manifest, prefix = installer["inspect_archive"](archive, expected["sha256"])
    require(manifest == strict_json((work / "manifests.json").read_bytes())["fleet"]["packages"][arch]["manifest"]
            and manifest["commit"] == producer["commit"], "Fleet tested inner manifest differs")
    node, version = installer["node_pin"]()
    node_file = work / Path(urllib.parse.urlsplit(node["url"]).path).name
    with response(node["url"], binary=True) as stream, node_file.open("xb") as output:
        count = 0
        for block in iter(lambda: stream.read(65536), b""):
            count += len(block); require(count < MAX_ASSET, "Node archive bound"); output.write(block)
    node_file.chmod(0o600)
    require(digest(node_file) == node["sha256"], "original pinned Node archive differs")
    root, state = work / "fleet-installation", work / "fleet-state"
    report = installer["preflight"](archive, expected["sha256"], node_file, root, state)
    require(report["readyForInstallInspection"] is True, "original normal installer preflight refused")
    receipt = installer["install"](archive, expected["sha256"], node_file, root, state)
    folder = root / "versions" / expected["sha256"]
    installer["verify_version"](root, expected["sha256"])
    application, executable = folder / "application", folder / "runtime/node"
    service = runpy.run_path(str(ROOT / "engineering/integration/service-package.py"))
    inventory = service["inventory"](application)
    observation = {"manifestSha256": digest(application / "local-preview-manifest.json"),
                   "inventoryBeforeSha256": inventory, "inventoryAfterSha256": inventory, "unchanged": True}
    require(observation == strict_json((work / "manifests.json").read_bytes())["fleet"]["packages"][arch]["extractedInventory"],
            "normal installed bytes/modes differ from original qualified package inventory")
    save(work / "package-observation.json", encoded(observation))
    save(work / "installation.json", encoded({"schema": "agi-fleet/public-package-normal-installation/v1",
         "producer": producer, "publicAsset": value["repositories"]["fleet"]["assets"]["packageX64" if arch == "x64" else "packageArm64"],
         "innerArchive": expected, "installerReceipt": receipt, "nodePin": node, "application": str(application),
         "node": str(executable), "state": str(state), "package": observation}))
    with open(os.environ["GITHUB_ENV"], "a") as output:
        for key, item in {"FLEET_PUBLIC_APPLICATION": application, "FLEET_PUBLIC_NODE": executable,
                          "FLEET_PUBLIC_ARCHIVE": archive, "PUBLIC_PACKAGE_WORK": work}.items():
            require("\n" not in str(item), "generated path newline")
            output.write(key + "=" + str(item) + "\n")

def wheel(bundle, work):
    value, producer, authenticated = run("verify", bundle)
    archive = selected_file(bundle, value, "alpha", "wheel")
    dependency_lock = ROOT / ".integration-alpha/requirements-agent.lock"
    require(dependency_lock.read_bytes() == git(ROOT / ".integration-alpha", "show",
            value["repositories"]["alpha"]["released"]["commit"] + ":requirements-agent.lock", binary=True),
            "published Alpha dependency lock differs from released Git source")
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", "--no-index", "--no-cache-dir",
                    "--no-compile", "--force-reinstall", str(archive)], check=True)
    subprocess.run([sys.executable, "-m", "pip", "check"], check=True)
    site = Path(sysconfig.get_path("purelib")).resolve(strict=True)
    inspected = []
    with zipfile.ZipFile(archive) as source:
        entries = inspect_zip(archive)
        records = [name for name in entries if name.endswith(".dist-info/RECORD")]
        require(len(records) == 1, "one actual wheel RECORD required")
        rows = list(csv.reader(io.StringIO(source.read(records[0]).decode("utf-8"))))
        record = {}
        for row in rows:
            require(len(row) == 3 and row[0] not in record, "unique wheel RECORD entry")
            record[row[0]] = row[1:]
        require(set(record) == set(entries), "wheel RECORD inventory differs")
        for name in entries:
            if name == records[0]:
                require(record[name] == ["", ""], "wheel RECORD self identity")
                continue
            raw = source.read(name)
            require(record[name] == ["sha256=" + base64.urlsafe_b64encode(hashlib.sha256(raw).digest()).decode().rstrip("="),
                                     str(len(raw))], "wheel RECORD member hash or size differs")
        expected_python = {name[len("alpha_factory_v1/"):] for name in entries
                           if name.startswith("alpha_factory_v1/") and name.endswith(".py")}
        package = site / "alpha_factory_v1"
        require(package.resolve(strict=True) == package, "physical installed Alpha package")
        require({p.relative_to(package).as_posix() for p in package.rglob("*.py")} == expected_python
                and not list(package.rglob("*.pyc")), "unexpected installed Alpha Python or bytecode")
        for name, info in sorted(entries.items()):
            safe_relative(name)
            if ".dist-info/" in name:
                continue
            require(not name.startswith(".") and ".data/" not in name and not name.endswith(".pth"), "unsupported transformed wheel payload")
            raw = source.read(info)
            file = site / name
            require(file.resolve(strict=True) == file and file.is_file()
                    and file.read_bytes() == raw, "physical installed wheel payload differs")
            if name.endswith(".py"):
                require(git(ROOT / ".integration-alpha", "show",
                            value["repositories"]["alpha"]["released"]["commit"] + ":" + name, binary=True) == raw,
                        "installed wheel Python differs from final Git source")
            inspected.append({"path": name, "bytes": len(raw), "sha256": sha(raw),
                              "installedMode": stat.S_IMODE(file.stat().st_mode)})
    require(inspected, "empty installed wheel payload")
    save(work / "wheel-installation.json", encoded({"schema": "agi-fleet/public-alpha-wheel-installation/v1",
         "producer": producer, "asset": value["repositories"]["alpha"]["assets"]["wheel"],
         "sitePackages": str(site), "payload": inspected,
         "dependencyLock": {"path": "requirements-agent.lock", "sha256": digest(dependency_lock)},
         "nativeSourcePackageClaim": "SEPARATE_COMPLETE_GIT_BOUND_SOURCE_PACKAGE",
         "wheelExecutionClaim": "INSTALLED_CLI_PHASE_ONLY"}))

def finish(bundle, work, evidence):
    value, producer, authenticated = run("verify", bundle)
    installed = strict_json((work / "installation.json").read_bytes())
    service = runpy.run_path(str(ROOT / "engineering/integration/service-package.py"))
    require(service["inventory"](Path(installed["application"])) == installed["package"]["inventoryBeforeSha256"],
            "installed public Fleet package changed during journey")
    source_observation = strict_json((work / "source-packages.json").read_bytes())
    for role in ("alpha", "jobs", "manager"):
        root = ROOT / (".integration-" + role)
        expected = value["repositories"][role]["released"]
        require(git(root, "rev-parse", "HEAD") == expected["commit"]
                and git(root, "rev-parse", "HEAD^{tree}") == expected["tree"]
                and git(root, "status", "--porcelain", "--untracked-files=no") == "",
                "released source changed during journey")
        for entry in source_observation["packages"][role]["files"]:
            file = root / entry["path"]
            if file.is_symlink():
                raw = os.readlink(file).encode()
                mode = stat.S_IFLNK | 0o777
            else:
                require(file.resolve(strict=True) == file and file.is_file(), "source path changed")
                raw = file.read_bytes(); mode = stat.S_IFREG | stat.S_IMODE(file.stat().st_mode)
            require(sha(raw) == entry["sha256"] and mode == entry["installedMode"], "public source payload changed")
    wheel_observation = strict_json((work / "wheel-installation.json").read_bytes())
    for entry in wheel_observation["payload"]:
        file = Path(wheel_observation["sitePackages"]) / entry["path"]
        require(file.resolve(strict=True) == file and file.is_file()
                and digest(file) == entry["sha256"] and file.stat().st_size == entry["bytes"]
                and stat.S_IMODE(file.stat().st_mode) == entry["installedMode"], "installed wheel changed during journey")
    compatibility = strict_json((evidence / "compatibility-evidence.json").read_bytes())
    require(compatibility["nativeAndMockChainJourneyPassed"] is True
            and compatibility["costs"]["providerRequests"] == 0
            and compatibility["mainnetTransactions"] == 0
            and compatibility["productionQualified"] is False, "original collector did not qualify its finite route")
    require((evidence / "wheel-cli-demo.json").is_file(), "separate installed-wheel CLI phase missing")
    transition = strict_json((evidence / "jobs-source-transition.json").read_bytes())
    save(evidence.parent / "public-package-evidence/public-package-proof.json", encoded({"schema": "agi-fleet/final-public-package-proof/v1",
         "producer": producer, "consumerSource": value["consumerSource"],
         "releaseInputs": value, "installation": installed,
         "sourcePackages": source_observation, "jobsSourceTransition": transition,
         "wheel": strict_json((work / "wheel-installation.json").read_bytes()),
         "sourceQualification": "ORIGINAL_RELEASE_GATES_REMAIN_REQUIRED_NOT_REPLACED",
         "productionQualified": False, "authority": "none", "mainnetTransactions": 0,
         "providerRequests": compatibility["costs"]["providerRequests"], "humanMinutes": None, "deviceCost": None}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["sources", "installation", "wheel", "finish"])
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--architecture", choices=["x64", "arm64"])
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args()
    bundle, work = args.bundle.absolute(), args.work.absolute()
    if args.mode == "sources": sources(bundle, work)
    elif args.mode == "installation": installation(bundle, work, args.architecture)
    elif args.mode == "wheel": wheel(bundle, work)
    else:
        require(args.evidence is not None, "evidence directory required")
        finish(bundle, work, args.evidence.absolute())
