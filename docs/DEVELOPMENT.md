# Working on the Linux source

The repository maintains the exact inventoried Linux 1.0.9 source under `fleet/`. It includes all six roles, their shared runtime, tests, lockfiles, Linux helpers, and license notices. The initial source import preserves every recorded byte and executable mode. Bundled dependencies and historical reports remain in the frozen release ZIP. A source checkout alone is not an operator distribution.

Use Python 3.12 or later on Ubuntu 24.04. For a complete engineering working copy, materialize the frozen ZIP into an absent directory outside this checkout:

```sh
python3 engineering/materialize-release.py --output /ABSOLUTE/PATH/materialized
```

The command downloads the exact hash-pinned archive, verifies its byte count, CRC, seven manifests and source inventories, and safely extracts executable modes. It does not install packages, create accounts, start services, invoke a provider, or open a wallet. An offline ZIP can be supplied with `--archive`.

To reproduce only the browsable source in a new directory:

```sh
python3 engineering/materialize-release.py --source-only --output /ABSOLUTE/PATH/source-copy
python3 engineering/check-repository.py --require-source
```

`fleet/source-inventory.json` covers 4,816 source files with revision SHA-256 `0bf5b82329a7f743759fa7f8a6383ef985df286f3c702143719b8667c5051f97`. The source mirror is an audited baseline. Future runtime work needs a new version, updated inventories, an explicit diff, and saved-archive native acceptance; changing a mirror file does not change the frozen 1.0.9 qualification.

The [engineering guide](../engineering/README.md) explains full native reproduction. Use disposable VMs for ownership and runtime tests. Preserve failed evidence and original release assets. Never use an operator account or production profile as a test fixture.

Repository CI checks metadata, documentation links, evidence classification, extraction safety and source identity. [Job integration CI](JOB_INTEGRATION.md) additionally compiles AGIJobManager, compares its production contract to the saved Fleet artifacts, runs all standalone EVM scripts, and exercises a fresh-manager lifecycle on both architectures. Release CI independently re-audits the retained native artifacts before publishing evidence; it never promotes the candidate to a stable production release. Source changes are reviewed through pull requests.

## Authorized-workspace development preview

New workstation capability work lives under [`workstation/`](../workstation/QUICKSTART.md), version `0.1.0-preview.1`. Its Linux engine derives from the frozen native workforce source and has its own source inventory, tests and qualification ledger. It does not modify or inherit acceptance from the frozen `fleet/` mirror. Start the guided terminal menu with `npm --prefix workstation start` on a prepared task account; the engine itself uses Node built-ins and needs no npm dependency install. Read the quickstart before connecting a desktop.

The [Studio source overlay](../workstation/STUDIO.md) adds general-format imports to the top-level Agent and Node applications. To assemble a **disposable source fixture** for development outside this checkout:

```sh
python3 engineering/materialize-workstation-preview.py --output /ABSOLUTE/PATH/workstation-preview-source
python3 engineering/check-workstation-preview.py
npm --prefix workstation test
npm --prefix workstation run test:regressions
```

Studio tests need the frozen `ajv` dependency. Set `AGI_STUDIO_NODE_MODULES` to an existing verified dependency directory, or run `npm ci --prefix fleet --ignore-scripts --omit=dev` to install the exact lockfile dependencies for testing. No install scripts run. The materialized fixture contains no bundled dependencies and is **not an operator distribution**. Its top-level Agent/Node overlay is the tested UI path; nested distribution copies remain frozen. Do not run the baseline installer or verifier against this modified fixture and treat its output as release qualification.

The preview workflow exercises source and synthetic regressions on Linux x64 and ARM64. A release still requires rebuilding all distribution copies, new inventories, a saved archive and retained native acceptance, followed by actual desktop, model, account, recovery and endurance commissioning. [`candidate.json`](../workstation/candidate.json) records those physical gates separately as `NOT_RUN`.
