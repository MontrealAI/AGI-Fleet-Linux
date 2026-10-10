# AGI Fleet Linux

**[Open the Fleet website — installation, roles, readiness and troubleshooting](https://montrealai.github.io/AGI-Fleet-Linux/)** · [Français](https://montrealai.github.io/AGI-Fleet-Linux/fr.html)

**Our mission: make a large fraction of the work people do with a keyboard, mouse and screen accessible to a capable, easy-to-use AI workforce.** Fleet is being developed for everyday installed applications, signed-in business tools, documents, code, research and multi-step workflows, with independent review and clear human control.

The team frames this opportunity as an **approximately US$40 trillion annual total addressable market**. This is the team's strategic estimate, not a verified market measurement, revenue forecast or demonstrated automation rate.

**Install, operate and qualify six isolated AGI Jobs roles on Ubuntu Desktop 24.04 LTS.** The **1.0.10** release track targets controlled fresh installation on x86-64 and ARM64. Publication requires the saved-archive qualification gates below to pass; physical commissioning remains open.

[Download Linux 1.0.10](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.10-qualification) · [Install step by step](docs/FRESH_INSTALL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Release notes](docs/RELEASE_NOTES_1_0_10.md)

## Choose the right work mode

| Your goal | Work mode | Where to start |
| --- | --- | --- |
| Produce checkable files from public or synthetic inputs using an isolated workspace. | **Public-work release.** Linux 1.0.10 requires its own native and contract-integration acceptance before publication; physical qualification remains open. | [Fresh-install guide](docs/FRESH_INSTALL.md) |
| Develop and qualify work across installed Linux applications and manually signed-in business accounts. | **Authorized workspace preview.** A separate Linux X11 native engine, signed task grants, action budgets and encrypted result handoffs. Pilot-only development preview; production execution is disabled. Not included in the 1.0.10 Fleet ZIP; the preview records a historical 1.0.9 source basis. | [Workspace quickstart](workstation/QUICKSTART.md) |

The public sandbox is one work mode, **not the ceiling of the product's mission**. The authorized workspace expands the development path toward normal workstation tasks. It uses a dedicated OS account: desktop control can reach everything that account can access. Keep it separate from your everyday account and the Fleet signer; a grant is not a per-site sandbox. Sign into approved applications yourself. The preview does not automatically publish private results or settle private jobs through AGIJobManager.

**Also in the source preview, outside the 1.0.10 Fleet ZIP:** [Work Studio general-format imports](workstation/STUDIO.md) let Agent and Node open public `computer-work/v2` jobs with arbitrary declared file extensions and larger bounded bundles. The quick editor remains v1; this preview preserves each imported job’s exact runtimes, permissions, inputs and budgets.

## The potential of Fleet + AGIJobManager

**Fleet supplies the workforce; AGIJobManager supplies escrow, participation rules, review deadlines and settlement.** A reusable job specification can accommodate many occupations without a profession or filename-extension allowlist. Broader tools and account access expand what can be attempted; representative task results establish what can be offered reliably.

The target spans software and data work, documents and creative production, research, customer operations, CRM, scheduling, business administration and multi-application projects. Some tasks require installed applications, enterprise access or extra adapters. These are categories to qualify, not claims of demonstrated customer-job coverage.

A user-friendly experience should answer five questions: **What should be done? Which workspace may be used? What may it change? What will it cost? How do I review or stop it?** The preview quickstart makes the first workspace explicit; task templates, smoother setup and broader application qualification remain part of the development roadmap.

Success means **repeatable, independently accepted results at a competitive total cost and low human supervision**. No current release establishes that most keyboard-and-mouse jobs can already be completed.

**[Read the complete potential and scope guide](docs/POTENTIAL_AND_SCOPE.md)** · **[Français](docs/POTENTIEL_ET_PERIMETRE.md)** · **[Explore the website explanation](https://montrealai.github.io/AGI-Fleet-Linux/#potential)**

## Start here

1. Use a dedicated, clean **Ubuntu Desktop 24.04 LTS** machine with GNOME, systemd and cgroup v2. Allow at least 8 GB RAM and 40 GB free disk; 16 GB RAM is recommended.
2. Once the release page records completed native and integration acceptance, download **AGI_Fleet_Linux_v1.0.10.zip** and **SHA256SUMS-v1.0.10.txt**. Follow the [checksum and extraction instructions](docs/FRESH_INSTALL.md). GitHub's automatic source archives are development checkouts, not installer bundles.
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

Publication occurs only after these gates pass. Read the release's **Release-Manifest-v1.0.10.json** and **Linux-Qualification-Evidence-v1.0.10.zip** for observed results. The final archive must also pass all seven manifests, source inventories, executable parsing and launcher smoke checks. Both successful and failed CI runs retain their evidence.

**Physical installation, rootless Docker/cgroup enforcement, real OAuth/inference, live documents, positive base AND browser cleanup, reboot identity persistence and 72-hour endurance remain NOT RUN.** Keep funded work disabled until the required physical observations pass. A passing regression suite is not a physical commissioning result.

## AGI Jobs integration

Fleet works with [AGIJobManager](https://github.com/MontrealAI/AGIJobManager): Agent prepares and publishes a supported deliverable, submits its completion URI, and follows settlement; Node reviews evidence and submits a bonded vote. The contract governs escrow, identity, deadlines and USDC settlement.

The tested contract baseline is **1.13.0**, commit `191cf3590e5cdc08df1bb0af500ee28a91c8b010`. [Integration details](docs/JOB_INTEGRATION.md) distinguish real client execution from explicit local-chain, generation, content-transport and identity fixtures. The [mainnet deployment report](docs/MAINNET_DEPLOYMENT.md) records nine matching production runtimes for `0xCFA78f9980eA9B55c705B3E44467baE383cE1fA7` at its observation block. Its paused-intake finding is a historical snapshot; check current readiness before commissioning.

## Engineering and history

[Development and reproducible builds](docs/DEVELOPMENT.md) · [Native baseline reproduction](engineering/README.md) · [Physical ledger](docs/PHYSICAL_QUALIFICATION.md)

The repository tracks all six packaged roles, shared runtime, **342 regression files**, lockfiles and license notices under `fleet/`. The 1.0.10 artifacts are built from reviewed `fleet/` source and the hash-pinned 1.0.9 dependency bundle. The separately inventoried `workstation/` development preview is not included in the 1.0.10 Fleet ZIP and needs its own qualification. Dependency versions and on-chain contract policies are unchanged in 1.0.10.

The frozen 1.0.9 release passed 3,897 native tests per architecture and 777 manager regressions per architecture; its [native audit](validation/LINUX_1_0_9_NATIVE_ADDENDUM.md) and [integration audit](validation/LINUX_1_0_9_JOB_INTEGRATION_ADDENDUM.md) remain unchanged. Earlier reports remain available for [1.0.6](validation/LINUX_1_0_6_NATIVE_ADDENDUM.md), [1.0.7](validation/LINUX_1_0_7_NATIVE_ADDENDUM.md) and [1.0.8](validation/LINUX_1_0_8_NATIVE_ADDENDUM.md). Historical results are never relabeled as a new release's tests.

Never commit operator profiles, wallets, setup JSON, OAuth stores, provider responses or user documents.
