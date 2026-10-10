# Develop and reproduce AGI Fleet Linux

The reviewed application source lives under `fleet/`: all six roles, shared runtime, 342 regression files, lockfiles and license notices. The **1.0.10** source identity is recorded in `engineering/next-release.json` and `fleet/source-inventory.json`. A source checkout alone is not an operator distribution.

## Check a source change

Use Python 3.12+ and Node 24.21.0 on Ubuntu 24.04. Keep operator profiles and credentials outside the checkout.

```sh
python3 engineering/check-repository.py --require-source
python3 -m unittest discover -s engineering/tests -v
node --test fleet/tests/linux-platform.test.mjs
```

Shared runtime changes belong in `fleet/shared/runtime/`. Propagate them with `python3 fleet/scripts/sync-shared-runtime.py --root fleet` and then use `--check`. Preserve role-specific adapters. Updating source also requires reviewed inventory hashes and a new release identity; do not change an already-published ZIP.

## Build the complete 1.0.10 candidate

The builder downloads and verifies the frozen 1.0.9 ZIP, overlays exactly the inventoried source, incorporates current operator guides, regenerates the seven edition inventories/manifests and SBOMs, and validates the final extracted archive. It never creates accounts, opens a wallet or starts an operator service.

From a clean reviewed checkout, choose an absent output directory outside the checkout:

```sh
python3 engineering/build-next-release.py \
  --output /ABSOLUTE/PATH/candidate-dist \
  --commit "$(git rev-parse HEAD)"
```

Use `--archive /ABSOLUTE/PATH/AGI_Fleet_Linux_v1.0.9.zip` for an offline baseline. Its hash must match the frozen release. `--node` can identify the exact Node executable. Do not use the resulting candidate for funded work; publication requires the saved-archive qualification workflow.

Output includes `AGI_Fleet_Linux_v1.0.10.zip`, `release.json`, packaging receipts, and final-extraction evidence. `release.json` identifies the bytes; it is not a claim that native or physical tests have passed.

## Qualify and publish

The [next-release workflow](../.github/workflows/next-release.yml) builds once and distributes the same artifact to disposable x86-64 and ARM64 runners. It runs targeted/full native suites and AGIJobManager integration separately, then rechecks retained log hashes, test-source identity, exact counts and workflow provenance. Root runtime provisioning is limited to disposable GitHub-hosted runners; do not run that harness in an operator account or on a shared workstation.

Pull requests run all qualification jobs without publishing. On `main`, publication runs only after the independent audit passes. It uploads a draft release, verifies the remote asset digests, and publishes the prerelease. Existing differing assets are rejected rather than replaced. Every file must remain below 450,000,000 bytes. A stable production release additionally requires the [physical ledger](PHYSICAL_QUALIFICATION.md), which is still open.

## Reproduce the preserved 1.0.9 baseline

These commands intentionally remain pinned to the original 1.0.9 bytes:

```sh
python3 engineering/materialize-release.py --output /ABSOLUTE/PATH/baseline-materialized
python3 engineering/materialize-release.py --source-only --output /ABSOLUTE/PATH/baseline-source
```

An offline ZIP can be supplied with `--archive`. Materialization verifies size, SHA-256, CRC, seven manifests, inventories and executable modes before extracting into an absent canonical directory.

`engineering/current-release.json` preserves the 1.0.9 acceptance anchor for the historical audit tools; `engineering/next-release.json` describes the 1.0.10 source and required gates. The published 1.0.10 manifest is the authority for new archive identity and observed test results. The [baseline engineering guide](../engineering/README.md) documents historical reproduction commands. Do not update historical constants to make a new candidate appear previously accepted.
