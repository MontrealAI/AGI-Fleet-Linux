# AGI Fleet Linux

**[Open the Fleet website — installation, roles, readiness and troubleshooting](https://montrealai.github.io/AGI-Fleet-Linux/)** · [Français](https://montrealai.github.io/AGI-Fleet-Linux/fr.html)

**Install, operate and qualify six isolated AGI Jobs roles on Ubuntu Desktop 24.04 LTS.** The current release track is **1.0.10**, a controlled-installation prerelease for x86-64 and ARM64. Physical commissioning remains open.

[Download Linux 1.0.10](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.10-qualification) · [Install step by step](docs/FRESH_INSTALL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Release notes](docs/RELEASE_NOTES_1_0_10.md)

## Start here

1. Use a dedicated, clean **Ubuntu Desktop 24.04 LTS** machine with GNOME, systemd and cgroup v2. Allow at least 8 GB RAM and 40 GB free disk; 16 GB RAM is recommended.
2. Download **AGI_Fleet_Linux_v1.0.10.zip** and **SHA256SUMS-v1.0.10.txt** from the release page. Follow the [checksum and extraction instructions](docs/FRESH_INSTALL.md). GitHub's automatic source archives are development checkouts, not installer bundles.
3. Start with Agent using new, separate nonadministrator signer and compute accounts. Follow the guide through readiness, then record your machine's results in the [physical qualification ledger](docs/PHYSICAL_QUALIFICATION.md).

The ZIP includes the pinned dependencies and current operator guides. You do not need the historical regression-fixture download to install it. Every supplied file and archive member is below **450,000,000 bytes**.

## Choose a role

| Role | Purpose |
| --- | --- |
| Agent | Performs supported sandboxed workstation work and submits deliverables. |
| Node | Independently checks evidence and submits bonded reviews. |
| Moderator | Handles appointed, conflict-free disputes within policy. |
| Employer | Posts scoped jobs and manages buyer acceptance and funding. |
| Evidence | Provides read-only evidence service without a signing key. |
| Recovery | Performs permitted deadline-based finalization, refunds and claims. |

Compute uses rootless Docker, policy-bound local services, spending/run limits, authenticated readiness, durable cleanup evidence and fail-closed STOP controls. Signer approval remains separate. The pinned runtime is **Node 24.21.0, OpenClaw 2026.9.5 and Docker Engine 29.8.2**. New profiles allow 256 runs per rolling day; Agent and Node permit 32 image attempts. The [installation guide](docs/FRESH_INSTALL.md) lists each role's OAuth sessions and capabilities.

## What release publication verifies

Linux 1.0.10 corrects stale 1.0.6 diagnostic labels, aligns role version metadata, and adds current installation and recovery guidance. Its [release workflow](.github/workflows/next-release.yml) builds the saved ZIP once, then tests those exact bytes:

| Gate | Required result on each architecture |
| --- | --- |
| Targeted native regressions | 291 passing tests; no failures, skips or timeouts |
| Complete Fleet suite | 3,898 passing tests; no failures, skips or timeouts |
| AGIJobManager integration | Eight standalone EVM scripts, Agent/three-Node lifecycle, 777 manager regressions |
| Independent evidence audit | Archive, source, log hashes, counts and workflow commit agree |

Publication occurs only after these gates pass. Read the release's **Release-Manifest-v1.0.10.json** and **Linux-Qualification-Evidence-v1.0.10.zip** for observed results. The final archive also passes all seven manifests, source inventories, executable parsing and launcher smoke checks. Both successful and failed CI runs retain their evidence.

**Physical installation, rootless Docker/cgroup enforcement, real OAuth/inference, live documents, positive base AND browser cleanup, reboot identity persistence and 72-hour endurance remain NOT RUN.** Keep funded work disabled until the required physical observations pass. A passing regression suite is not a physical commissioning result.

## AGI Jobs integration

Fleet works with [AGIJobManager](https://github.com/MontrealAI/AGIJobManager): Agent prepares and publishes a supported deliverable, submits its completion URI, and follows settlement; Node reviews evidence and submits a bonded vote. The contract governs escrow, identity, deadlines and USDC settlement.

The tested contract baseline is **1.13.0**, commit `191cf3590e5cdc08df1bb0af500ee28a91c8b010`. [Integration details](docs/JOB_INTEGRATION.md) distinguish real client execution from explicit local-chain, generation, content-transport and identity fixtures. The [mainnet deployment report](docs/MAINNET_DEPLOYMENT.md) records nine matching production runtimes for `0xCFA78f9980eA9B55c705B3E44467baE383cE1fA7` at its observation block. Its paused-intake finding is a historical snapshot; check current readiness before commissioning.

## Engineering and history

[Development and reproducible builds](docs/DEVELOPMENT.md) · [Native baseline reproduction](engineering/README.md) · [Physical ledger](docs/PHYSICAL_QUALIFICATION.md)

The repository tracks all six roles, shared runtime, **342 regression files**, lockfiles and license notices under `fleet/`. New artifacts are built from that reviewed source and the hash-pinned 1.0.9 dependency bundle. Dependency versions and on-chain contract policies are unchanged in 1.0.10.

The frozen 1.0.9 release passed 3,897 native tests per architecture and 777 manager regressions per architecture; its [native audit](validation/LINUX_1_0_9_NATIVE_ADDENDUM.md) and [integration audit](validation/LINUX_1_0_9_JOB_INTEGRATION_ADDENDUM.md) remain unchanged. Earlier reports remain available for [1.0.6](validation/LINUX_1_0_6_NATIVE_ADDENDUM.md), [1.0.7](validation/LINUX_1_0_7_NATIVE_ADDENDUM.md) and [1.0.8](validation/LINUX_1_0_8_NATIVE_ADDENDUM.md). Historical results are never relabeled as a new release's tests.

Never commit operator profiles, wallets, setup JSON, OAuth stores, provider responses or user documents.
