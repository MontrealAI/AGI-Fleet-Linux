# Develop and reproduce AGI Fleet Linux

The reviewed application source lives under `fleet/`: all six roles, shared runtime, 343 regression files, lockfiles and license notices. The **1.1.2** source identity is recorded in `engineering/next-release.json` and `fleet/source-inventory.json`. A source checkout alone is not an operator distribution.

## Check a source change

Use Python 3.12+ and Node 24.21.0 on Ubuntu 24.04. Keep operator profiles and credentials outside the checkout.

```sh
python3 engineering/check-repository.py --require-source
python3 -m unittest discover -s engineering/tests -v
node --test fleet/tests/linux-platform.test.mjs
```

Shared runtime changes belong in `fleet/shared/runtime/`. Propagate them with `python3 fleet/scripts/sync-shared-runtime.py --root fleet` and then use `--check`. Preserve role-specific adapters. Updating source also requires reviewed inventory hashes and a new release identity; do not change an already-published ZIP.

## Build the complete 1.1.2 candidate

The builder downloads and verifies the frozen 1.0.9 ZIP, overlays exactly the inventoried source, incorporates current operator guides, regenerates the seven edition inventories/manifests and SBOMs, and validates the final extracted archive. It never creates accounts, opens a wallet or starts an operator service.

From a clean reviewed checkout, choose an absent output directory outside the checkout:

```sh
python3 engineering/build-next-release.py \
  --output /ABSOLUTE/PATH/candidate-dist \
  --commit "$(git rev-parse HEAD)"
```

Use `--archive /ABSOLUTE/PATH/AGI_Fleet_Linux_v1.0.9.zip` for an offline baseline. Its hash must match the frozen release. `--node` can identify the exact Node executable. Do not use the resulting candidate for funded work; publication requires the saved-archive qualification workflow.

Output includes `AGI_Fleet_Linux_v1.1.2.zip`, `release.json`, packaging receipts, and final-extraction evidence. `release.json` identifies the bytes; it is not a claim that native or physical tests have passed.

## Qualify and publish

Linux 1.1.2 binds AGIJobManager 1.16.1 at `d9b65eda376e990db30bfd20235cac0447af7fa4`, including all 780 Manager regressions. The build metadata, each evidence binding and the independent audit retain the exact target. Publication additionally rejects mixed workflow runs, a different build commit and incomplete log coverage. Historical 1.0.9 and 1.0.10 results remain unchanged.

The [next-release workflow](../.github/workflows/next-release.yml) builds once and distributes the same artifact to disposable x86-64 and ARM64 runners. It runs targeted/full native suites and AGIJobManager integration separately, then rechecks retained log hashes, test-source identity, exact counts and workflow provenance. Root runtime provisioning is limited to disposable GitHub-hosted runners; do not run that harness in an operator account or on a shared workstation.

Pull requests run all qualification jobs without publishing. On `main`, changing `engineering/next-release.json` starts a release invocation; ordinary documentation pushes do not republish the fixed tag. Manual dispatch validates only unless `publish` is explicitly selected. Publication runs only after the independent audit passes. It uploads a draft release, verifies the remote asset digests, and publishes the prerelease. Existing differing assets are rejected rather than replaced. Every file must remain below 450,000,000 bytes. A stable production release additionally requires the [physical ledger](PHYSICAL_QUALIFICATION.md), which is still open.

## Reproduce the preserved 1.0.9 baseline

These commands intentionally remain pinned to the original 1.0.9 bytes:

```sh
python3 engineering/materialize-release.py --output /ABSOLUTE/PATH/baseline-materialized
python3 engineering/materialize-release.py --source-only --output /ABSOLUTE/PATH/baseline-source
```

An offline ZIP can be supplied with `--archive`. Materialization verifies size, SHA-256, CRC, seven manifests, inventories and executable modes before extracting into an absent canonical directory.

`engineering/current-release.json` preserves the 1.0.9 acceptance anchor for the historical audit tools; `engineering/next-release.json` describes the 1.1.2 source and required gates. The published 1.1.2 manifest is the authority for new archive identity and observed test results. The [baseline engineering guide](../engineering/README.md) documents historical reproduction commands. Do not update historical constants to make a new candidate appear previously accepted.

## Authorized-workspace development preview

New workstation capability work lives under [`workstation/`](../workstation/QUICKSTART.md), version `0.1.0-preview.1`. Its Linux engine records a historical **1.0.9** native workforce source basis in `workstation/candidate.json` and has its own source inventory, tests and qualification ledger. The native-workstation preview is **not included in the 1.1.2 Fleet ZIP**. Its reviewed public Studio format and explicit backup exclusion are incorporated into the 1.1.2 Agent and Node; the original overlay remains available below. The separate native preview does not modify a published Fleet archive or inherit acceptance from either the frozen 1.0.9 release or the 1.1.2 release track. Start the guided terminal menu with `npm --prefix workstation start` on a prepared task account; the engine itself uses Node built-ins and needs no npm dependency install. Read the quickstart before connecting a desktop.

The [Studio source overlay](../workstation/STUDIO.md) adds general-format imports to the top-level Agent and Node applications. To assemble a **disposable source fixture** for development outside this checkout:

```sh
python3 engineering/materialize-workstation-preview.py --output /ABSOLUTE/PATH/workstation-preview-source
python3 engineering/check-workstation-preview.py
npm --prefix workstation test
npm --prefix workstation run test:regressions
```

Studio tests need the frozen `ajv` dependency. Set `AGI_STUDIO_NODE_MODULES` to an existing verified dependency directory, or run `npm ci --prefix fleet --ignore-scripts --omit=dev` to install the exact lockfile dependencies for testing. No install scripts run. The materialized fixture contains no bundled dependencies and is **not an operator distribution**. Its top-level Agent/Node overlay is the tested UI path; nested Studio distribution copies retain the underlying Fleet source. The fixture records its actual reviewed Fleet source identity separately from the preview’s historical 1.0.9 origin. Do not run the baseline installer or verifier against this modified fixture and treat its output as release qualification.

The preview workflow exercises source and synthetic regressions on Linux x64 and ARM64. A release still requires rebuilding all distribution copies, new inventories, a saved archive and retained native acceptance, followed by actual desktop, model, account, recovery and endurance commissioning. [`candidate.json`](../workstation/candidate.json) records those physical gates separately as `NOT_RUN`.

## Review-source evidence and release-note links

The [exact-source review workflow](../.github/workflows/repository-review.yml) retains the complete Git source archive and a receipt containing its commit, workflow run, byte count and SHA-256. Its read-only token cannot publish a release or change a branch. Per-commit runs are not cancelled by newer revisions. The artifact is review source, **not an operator installer or release qualification**. On a pull request, its recorded commit is GitHub's tested integration commit, not a relabelled branch-head observation.

After downloading the `exact-review-source` artifact, verify the inner ZIP with `SHA256SUMS.txt` and compare `source-receipt.json` with the workflow and commit being reviewed. Keep both identities when comparing a branch head with its tested integration tree. A successful engineering review does not replace the saved-archive native, browser, Manager integration or physical gates above.

The publisher resolves local guide links against `docs/RELEASE_NOTES_1_1_1.md` and pins their public URLs to the exact validated commit. The original Markdown remains unchanged for offline installation guides. Missing or escaping local destinations stop preparation. Before making a release public, the publisher regenerates the expected note text from the checked-out source and exact asset identities, rejects changed text, and checks the remotely stored body. This prevents an edited notes artifact from silently replacing the reviewed instructions. The link relocator supports the repository's bounded Markdown guide format; it is not a general HTML sanitizer.

The [English starting guide](START_HERE.md) and [French starting guide](COMMENCER_ICI.md) distinguish current published qualification releases from Local Skills and native-workspace development previews. Keep their release labels aligned with the published manifests; do not advertise a draft branch as a released installer.
