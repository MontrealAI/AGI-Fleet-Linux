# AGI Fleet Linux

## New here? Let’s find your next step.

Fleet helps a dedicated Linux computer perform AI work and check the results. You can explore the possibilities without knowing the technical terms.

### [Start here — guide me, one step at a time →](https://montrealai.github.io/AGI-Fleet-Linux/start.html)

### [Commencer en français — me guider, étape par étape →](https://montrealai.github.io/AGI-Fleet-Linux/start-fr.html)

**Get work done · Set up an AI worker · Help me understand**

Choose a goal in the guided welcome. It explains what you need and points you to the right next step, including help preparing a suitable computer. You can go back and explore at your own pace. No sign-up is needed to read the guide.

**Today’s release:** Linux 1.0.10 is an early testing release with recorded native and contract-integration acceptance; physical machine qualification remains open, so paid work must stay disabled until its required checks pass.

[Explore the Fleet website](https://montrealai.github.io/AGI-Fleet-Linux/) · [Download and installation guide](docs/FRESH_INSTALL.md) · [Get help](docs/TROUBLESHOOTING.md)

## What we’re building

**Our mission: make a large fraction of the work people do with a keyboard, mouse and screen accessible to a capable, easy-to-use AI workforce.** Fleet is being developed for everyday installed applications, signed-in business tools, documents, code, research and multi-step workflows, with independent review and clear human control.

The team frames this opportunity as an **approximately US$40 trillion annual total addressable market**. This is the team's strategic estimate, not a verified market measurement, revenue forecast or demonstrated automation rate.

**Linux 1.0.10 is published as a qualification prerelease with native and AGIJobManager integration PASS on x86-64 and ARM64.** Install, operate and qualify six isolated AGI Jobs roles on Ubuntu Desktop 24.04 LTS. Physical commissioning remains open.

[Download Linux 1.0.10](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.10-qualification) · [Install step by step](docs/FRESH_INSTALL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Release notes](docs/RELEASE_NOTES_1_0_10.md)

## Choose the right work mode

| Your goal | Work mode | Where to start |
| --- | --- | --- |
| Produce checkable files from public or synthetic inputs using an isolated workspace. | **Public-work release.** Linux 1.0.10 has native and contract-integration PASS on both architectures, recorded in the [published manifest](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.0.10-qualification/Release-Manifest-v1.0.10.json); physical qualification remains open. | [Fresh-install guide](docs/FRESH_INSTALL.md) |
| Develop and qualify work across installed Linux applications and manually signed-in business accounts. | **Authorized workspace preview.** A separate Linux X11 native engine, signed task grants, action budgets and encrypted result handoffs. Pilot-only development preview; production execution is disabled. Not included in the 1.0.10 Fleet ZIP; the preview records a historical 1.0.9 source basis. | [Workspace quickstart](workstation/QUICKSTART.md) |

The public sandbox is one work mode, **not the ceiling of the product's mission**. The authorized workspace expands the development path toward normal workstation tasks. It uses a dedicated OS account: desktop control can reach everything that account can access. Keep it separate from your everyday account and the Fleet signer; a grant is not a per-site sandbox. Sign into approved applications yourself. The preview does not automatically publish private results or settle private jobs through AGIJobManager.

**Also in the source preview, outside the 1.0.10 Fleet ZIP:** [Work Studio general-format imports](workstation/STUDIO.md) let Agent and Node open public `computer-work/v2` jobs with arbitrary declared file extensions and larger bounded bundles. The quick editor remains v1; this preview preserves each imported job’s exact runtimes, permissions, inputs and budgets.

## The potential of Fleet + AGIJobManager

**Our assessment: together, they could form a reusable workforce that turns a clear request into an independently checked outcome in the tools people already use.** Fleet supplies execution and review; AGIJobManager supplies funded work orders, participation rules and settlement. This is an architectural and commercial assessment, not a measured automation rate.

Modern assistants can already use tools. The combined product's value would be a dependable process: **define the result → execute in the required applications → independently review the outcome → settle under the job's rules**. That process must justify its total cost; a simple question or draft may still be better served by an assistant alone. The private workspace preview needs a separately implemented and qualified settlement bridge.

The target spans software, data, documents, research, creative production, business operations and cross-application projects. The job format has no profession or file-extension allowlist, but tools, permissions and demonstrated competence still determine coverage. **A successful task, a completed workflow and an entire occupation are different units.** Measure accepted results across all attempted work, human intervention and the share of representative work time or value covered.

The commercial progression is **verified task templates → repeat-buyer workflows → cross-application projects → a multi-operator market**. Expand when quality, demand, review capacity and economics support the next step. These are recommended development stages, not completed deployments.

Keep the market model clear: **total opportunity → serviceable work → accepted paid job value → actual participant receipts and profit**. At the team's stated US$40 trillion TAM, 0.01%, 0.1% and 1% correspond arithmetically to US$4 billion, US$40 billion and US$400 billion in associated annual human-work spending. These illustrate scale; they are neither forecasts, job transaction volume nor company revenue. No platform fee is assumed.

A user-friendly experience should answer five questions: **What should be done? Which workspace may be used? What may it change? What will it cost? How do I review or stop it?** The preview quickstart makes the first workspace explicit; task templates, smoother setup and broader application qualification remain part of the development roadmap.

Success means **repeatable, independently accepted results at a competitive total cost and low human supervision**. No current release establishes that most keyboard-and-mouse jobs can already be completed.

The full analysis reviews Fleet [`2f27979`](https://github.com/MontrealAI/AGI-Fleet-Linux/tree/2f2797905fe7867ab3ec63d3b7332ef6d38f407d) and AGIJobManager [`69a9d6c` (1.14.0 source)](https://github.com/MontrealAI/AGIJobManager/blob/69a9d6cef1d6f4daff22cfe360282f6abefcd27a/README.md). Fleet's retained 1.13.0 integration results do not automatically qualify the newer source or private-work settlement.

**[Read the complete potential and scope guide](docs/POTENTIAL_AND_SCOPE.md)** · **[Français](docs/POTENTIEL_ET_PERIMETRE.md)** · **[Explore the website explanation](https://montrealai.github.io/AGI-Fleet-Linux/#potential)**

## Ready to prepare a computer?

The [guided welcome](https://montrealai.github.io/AGI-Fleet-Linux/start.html) is the easiest place to begin. The following installation path is for operators and technical helpers.

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
