"""Reproduce development-only wire fixtures from the exact pinned Alpha Git blob.

Uses stdlib JSON to preserve Python's original number types. No Alpha code,
dependencies, runtime artifact, model, network or operator state is executed.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
UPSTREAM = "examples/ecosystem/fleet-work-vectors.json"
UPSTREAM_SHA256 = "e257ab9e1c9bc17acca850ca3ceedccaf70f42d1652e530acb3997a7b66e7a2d"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--alpha-repository", type=Path, required=True)
    args = parser.parse_args()
    commit = json.loads((HERE / "package-lock.json").read_text())["source"]["commit"]
    raw = subprocess.run(
        ["git", "-C", str(args.alpha_repository.resolve()), "show", f"{commit}:{UPSTREAM}"],
        check=True, capture_output=True, timeout=10,
    ).stdout
    assert hashlib.sha256(raw).hexdigest() == UPSTREAM_SHA256, "upstream fixture changed"
    source = json.loads(raw)
    assert source["schema"] == "agialpha.fleet-work-vectors.v1"
    cases = []
    for item in source["vectors"]:
        spec = base64.b64decode(item["spec_base64"], validate=True)
        assert base64.b64encode(spec).decode() == item["spec_base64"]
        cases.append({
            "kind": item["kind"], "workSpec": spec.decode("utf-8"),
            "alphaOutput": canonical(item["result"]),
            "alphaValidation": canonical(item["validation"]),
        })
    output = {
        "evidenceClass": "SYNTHETIC_CONTRACT_FIXTURE; supplied-input computation; no native Fleet IPC, runtime-package or OS isolation qualification",
        "sourceCommit": commit, "upstreamFixture": UPSTREAM,
        "upstreamFixtureSha256": UPSTREAM_SHA256, "cases": cases,
    }
    target = HERE.parent / "tests/fixtures/alpha-contract.json"
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"Reproduced {len(cases)} synthetic contract vectors; no native qualification")


if __name__ == "__main__":
    main()
