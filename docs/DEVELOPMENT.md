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

Repository CI checks metadata, documentation links, evidence classification, extraction safety and source identity. Release CI independently re-audits the retained native artifacts before publishing evidence; it never promotes the candidate to a stable production release. Source changes are reviewed through pull requests.
