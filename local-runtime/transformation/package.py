# SPDX-License-Identifier: MIT
"""Additive alpha.7 TI source preview; the alpha.6 builder/profile stay unchanged."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import stat
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
PROFILE = ROOT / "local-runtime/transformation/release-profile.json"
INVENTORY = ROOT / "local-runtime/transformation/source-inventory.json"
ROOTS = ["local-runtime", "local-dashboard", "role-skills", "docs/local-skills", "fleet/shared", "fleet/successor",
        "fleet/node_modules", "fleet/packages/AGI_Agent/src/admission-core", "fleet/packages/AGI_Node/src"]
TI_ROOTS = ["local-runtime/transformation", "engineering/transformation"]
TI_FILES = ["docs/transformational-project.md", ".github/workflows/transformational-project.yml"]
def sha(data):
    return hashlib.sha256(data).hexdigest()
def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
def regular(file):
    if file != file.absolute() or file.resolve() != file or not file.is_relative_to(ROOT) or file.is_symlink() or not file.is_file() or file.stat().st_size > 8_000_000:
        raise ValueError("TI_PACKAGE_REGULAR_BOUNDED_SOURCE: " + str(file))
    return file.read_bytes(), 0o755 if file.stat().st_mode & 0o111 else 0o644
def ti_files():
    files = [ROOT / name for name in TI_FILES]
    for name in TI_ROOTS:
        base = ROOT / name
        if base.resolve() != base or not base.is_dir():
            raise ValueError("TI_PACKAGE_SOURCE_ROOT: " + name)
        files += [p for p in base.rglob("*") if p.is_file() and p != INVENTORY and "__pycache__" not in p.parts and p.suffix != ".pyc"]
    return sorted(set(files))
def rows(entries):
    return [{"path": name, "sha256": sha(data), "bytes": len(data), "mode": mode} for name, (data, mode) in sorted(entries.items())]
def reviewed_inventory():
    return {"schema": "agi-fleet/ti-source-inventory/v1", "version": "0.1.0-alpha.7",
            "files": rows({p.relative_to(ROOT).as_posix(): regular(p) for p in ti_files()})}
def build(output):
    output = Path(output).absolute()
    if output.exists() or output.is_relative_to(ROOT) or output.parent != output.parent.resolve():
        raise ValueError("TI_PACKAGE_NEW_EXTERNAL_OUTPUT_REQUIRED")
    profile = json.loads(PROFILE.read_bytes())
    if json.loads(INVENTORY.read_bytes()) != reviewed_inventory():
        raise ValueError("TI_REVIEWED_SOURCE_INVENTORY_CHANGED")
    entries = {}
    for name in ROOTS:
        base = ROOT / name
        if base.resolve() != base or not base.is_dir():
            raise ValueError("TI_PACKAGE_MISSING_SOURCE: " + name)
        for file in sorted(base.rglob("*")):
            if "__pycache__" in file.parts or file.suffix == ".pyc":
                continue
            if file.is_symlink() and file.parent.name == ".bin" and file.resolve().is_relative_to(ROOT / "fleet/node_modules"):
                continue
            if file.is_symlink():
                raise ValueError("TI_PACKAGE_SOURCE_LINK")
            if file.is_file():
                entries[file.relative_to(ROOT).as_posix()] = regular(file)
    for file in [*ti_files(), INVENTORY, *(ROOT / n for n in ["LOCAL_SKILLS.md", "LICENSE", "fleet/package.json", "fleet/package-lock.json"])]:
        entries[file.relative_to(ROOT).as_posix()] = regular(file)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=normal", "--", *ROOTS, *TI_ROOTS, *TI_FILES], cwd=ROOT))
    manifest = {"schema": "agi-fleet/local-source-preview/v1", "version": profile["version"], "commit": commit,
        "workingTreeDirty": dirty, "operatorInstaller": False, "productionQualified": False, "nativeAcceptance": "NOT_RUN",
        "tiProfileSha256": sha(PROFILE.read_bytes()), "tiInventorySha256": sha(INVENTORY.read_bytes()), "files": rows(entries)}
    entries["local-preview-manifest.json"] = encoded(manifest), 0o644
    if len(entries) > 25_000 or sum(len(data) for data, _ in entries.values()) >= 450_000_000:
        raise ValueError("TI_PACKAGE_CAPACITY")
    output.mkdir(mode=0o700)
    archive = output / profile["archive"]
    prefix = "agi-fleet-local-" + profile["version"]
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for name, (data, mode) in sorted(entries.items()):
            info = zipfile.ZipInfo(prefix + "/" + name, date_time=(2026, 10, 19, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            target.writestr(info, data)
    result = {"schema": "agi-fleet/ti-source-package-receipt/v1", "version": profile["version"], "commit": commit,
        "workingTreeDirty": dirty, "archive": archive.name, "sha256": sha(archive.read_bytes()), "bytes": archive.stat().st_size,
        "files": len(manifest["files"]), "inventorySha256": sha(INVENTORY.read_bytes()), "operatorInstaller": False,
        "productionQualified": False, "scope": profile["scope"]}
    (output / "package-receipt.json").write_bytes(encoded(result))
    print(json.dumps(result, sort_keys=True))
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--output")
    group.add_argument("--refresh-inventory", action="store_true")
    group.add_argument("--verify")
    args = parser.parse_args()
    if args.refresh_inventory:
        INVENTORY.write_bytes(encoded(reviewed_inventory()))
    elif args.output:
        build(args.output)
    else:
        installer = runpy.run_path(str(ROOT / "local-runtime/install.py"))
        archive = Path(args.verify)
        manifest, _ = installer["inspect_archive"](archive, sha(archive.read_bytes()))
        if manifest["version"] != "0.1.0-alpha.7" or manifest.get("operatorInstaller") is not False:
            raise ValueError("TI_SOURCE_PREVIEW_PROFILE_REQUIRED")
        print(json.dumps({"status": "PASS", "version": manifest["version"], "files": len(manifest["files"]), "productionQualified": False}))
if __name__ == "__main__":
    main()
