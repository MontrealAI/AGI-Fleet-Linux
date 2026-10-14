# Linux 1.1.1 — clearer onboarding and verified release instructions

This maintenance qualification prerelease preserves the complete SUCCESSOR Ω + Fleet experience and all six roles. It adds clearer English/French starting guides and corrects how release instructions are prepared and published. AGIJobManager remains pinned to 1.16.1 at `09d89fb22d52a8df194e8dd0a00beff9f7771d82`.

## What changed

- The [English starting guide](START_HERE.md) and [French starting guide](COMMENCER_ICI.md) explain the browser-only Builder, dedicated Linux/Mac installation, Fleet connection, recovery and unfinished development previews.
- Release-note guide links resolve to real repository files at the exact validated commit. Missing files, escaping destinations and mutable source references stop preparation.
- Publication regenerates the canonical notes from reviewed source and exact artifact identities. It rejects altered notes before remote actions, binds the canonical body into the publication request and checks the returned body, including concurrent-edit regressions.
- Installer, launcher, application and role version records agree on 1.1.1. Installation commands and the empty physical ledger use this release identity. Dependencies, contract policy, runtime authority and existing tests are preserved.
- Per-commit source-review receipts preserve the reviewed source without cancelling previous review or qualification runs. These receipts are development evidence, not installers.

## Start with the path you need

Use the free [Builder guide](../successor/docs/GUIDE.md) for a useful first result without a wallet, account or provider key. For a dedicated Linux host, follow [fresh installation](FRESH_INSTALL.md) using `AGI_Fleet_Linux_v1.1.1.zip` and `SHA256SUMS-v1.1.1.txt` from this release. Keep the complete Fleet folder and preserve previous installations inactive.

The [architecture guide](../successor/docs/ARCHITECTURE.md) explains execution and review authority; the [acceptance map](../successor/docs/ACCEPTANCE.md) distinguishes engineering observations from operating qualification. [Help and recovery](TROUBLESHOOTING.md) explains safe failure handling.

## Exact-archive qualification

Publication requires both x64 and ARM64 to pass 291 targeted and 3,908 complete native cases, with zero failures, skips, cancellations or TODOs. Each architecture must also pass all eight integration scripts and 780 pinned Manager regressions. The saved-archive browser journey, offline restoration and evidence audit must pass for the same archive and workflow commit. The published manifest and evidence ZIP record the actual results; earlier releases' results do not qualify these bytes.

Every supplied archive remains below 450,000,000 bytes. The publisher verifies remote sizes and SHA-256 digests before exposing the prerelease.

## Qualification limits

**Qualification prerelease; `productionQualified: false`.** Physical installations, live-provider/OAuth participation and costs, independent controller operation, human usability and endurance remain `NOT_RUN` until exact-release observations are supplied. The browser gate uses declared provider and sandbox fixtures. Keep funded work disabled until the required operating gates pass.

Mac 1.20.2 remains a separate published distribution. Local Skills PR #26 and the native workspace previews remain incomplete development tracks outside this installer. This release does not claim their completion or enable mainnet work. Existing release assets, historical evidence, recovery controls and flowcharts remain preserved.
