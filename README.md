# AGI Fleet Linux

**[Open the Fleet website — installation, roles, readiness and troubleshooting](https://montrealai.github.io/AGI-Fleet-Linux/)** · [Français](https://montrealai.github.io/AGI-Fleet-Linux/fr.html)

**Our mission: make a large fraction of the work people do with a keyboard, mouse and screen accessible to a capable, easy-to-use AI workforce.** Fleet is being developed for everyday installed applications, signed-in business tools, documents, code, research and multi-step workflows, with independent review and clear human control.

The team frames this opportunity as an **approximately US$40 trillion annual total addressable market**. This is the team's strategic estimate, not a verified market measurement, revenue forecast or demonstrated automation rate.

**Linux 1.0.9 passed native tests and AGIJobManager integration on Ubuntu 24.04 x86-64 and ARM64. It is ready for controlled fresh installation on your Linux machine.** Physical qualification remains open, so this is a prerelease.

[Download Linux 1.0.9](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.9-qualification) · [Install step by step](docs/FRESH_INSTALL.md) · [Audited results](validation/LINUX_1_0_9_NATIVE_ADDENDUM.md)

The Fleet ZIP includes **Agent, Node, Moderator, Employer, Evidence and Recovery**. Agent performs sandboxed workstation work; Node independently checks and reviews it. Signer and compute run in separate nonadministrator accounts. Compute uses rootless Docker and policy-bound local services, with spending/run limits, authenticated readiness, durable cleanup evidence and fail-closed STOP controls.

Fleet works with [AGIJobManager](https://github.com/MontrealAI/AGIJobManager): Agent prepares and publishes a supported deliverable, submits its completion URI, and follows settlement; Node reviews the evidence and submits a bonded vote. The contract enforces escrow, identity, review deadlines and USDC settlement. [Integration validation](docs/JOB_INTEGRATION.md) covers the actual clients against the current manager baseline. The [new mainnet deployment](docs/MAINNET_DEPLOYMENT.md), `0xCFA78f9980eA9B55c705B3E44467baE383cE1fA7`, also matches all nine production runtimes; its verified snapshot records paused job intake.

## Choose the right work mode

| Your goal | Work mode | Where to start |
| --- | --- | --- |
| Produce checkable files from public or synthetic inputs using an isolated workspace. | **Public-work release.** Linux 1.0.9 has recorded native and contract-integration acceptance; physical qualification remains open. | [Fresh-install guide](docs/FRESH_INSTALL.md) |
| Develop and qualify work across installed Linux applications and manually signed-in business accounts. | **Authorized workspace preview.** A separate Linux X11 native engine, signed task grants, action budgets and encrypted result handoffs. Pilot-only development preview; production execution is disabled. Not part of the published 1.0.9 archive. | [Workspace quickstart](workstation/QUICKSTART.md) |

The public sandbox is one work mode, **not the ceiling of the product's mission**. The authorized workspace expands the development path toward normal workstation tasks. It uses a dedicated OS account: desktop control can reach everything that account can access. Keep it separate from your everyday account and the Fleet signer; a grant is not a per-site sandbox. Sign into approved applications yourself. The preview does not automatically publish private results or settle private jobs through AGIJobManager.

**Also in the source preview:** [Work Studio general-format imports](workstation/STUDIO.md) let Agent and Node open public `computer-work/v2` jobs with arbitrary declared file extensions and larger bounded bundles. The quick editor remains v1; this preview preserves each imported job’s exact runtimes, permissions, inputs and budgets.

## The potential of Fleet + AGIJobManager

**Fleet supplies the workforce; AGIJobManager supplies escrow, participation rules, review deadlines and settlement.** A reusable job specification can accommodate many occupations without a profession or filename-extension allowlist. Broader tools and account access expand what can be attempted; representative task results establish what can be offered reliably.

The target spans software and data work, documents and creative production, research, customer operations, CRM, scheduling, business administration and multi-application projects. Some tasks require installed applications, enterprise access or extra adapters. These are categories to qualify, not claims of demonstrated customer-job coverage.

A user-friendly experience should answer five questions: **What should be done? Which workspace may be used? What may it change? What will it cost? How do I review or stop it?** The preview quickstart makes the first workspace explicit; task templates, smoother setup and broader application qualification remain part of the development roadmap.

Success means **repeatable, independently accepted results at a competitive total cost and low human supervision**. No current release establishes that most keyboard-and-mouse jobs can already be completed.

**[Read the complete potential and scope guide](docs/POTENTIAL_AND_SCOPE.md)** · **[Français](docs/POTENTIEL_ET_PERIMETRE.md)** · **[Explore the website explanation](https://montrealai.github.io/AGI-Fleet-Linux/#potential)**

## Start here

1. Use a dedicated clean **Ubuntu Desktop 24.04 LTS** host, x86-64 or ARM64, with GNOME, systemd and cgroup v2. Allow at least 8 GB RAM and 40 GB free disk; 16 GB RAM is recommended.
2. Download **AGI_Fleet_Linux_v1.0.9.zip** from the release page. Verify its checksum before following the [fresh-install guide](docs/FRESH_INSTALL.md).
3. Start with Agent using new separate signer/compute accounts. Record actual results in the [physical qualification ledger](docs/PHYSICAL_QUALIFICATION.md).

The installer pins Node 24.21.0, OpenClaw 2026.9.5 and Docker Engine 29.8.2. New profiles default to 256 runs per rolling day; Agent and Node allow 32 image attempts. Signer approval and spending controls remain separate.

## What passed

| Architecture | Targeted tests | Full suite | Failures / skips / timeouts |
| --- | ---: | ---: | ---: |
| x86-64 | 291 / 291 | 3,897 / 3,897 | 0 / 0 / 0 |
| ARM64 | 291 / 291 | 3,897 / 3,897 | 0 / 0 / 0 |

The [independent audit](validation/capable-38022168787-audit.json) verified **734 retained TAP logs** against the exact published ZIP, including real Unix sockets, cross-user ownership and the actual pinned Gateway discovery cache. The original 44 failures and six skips are resolved on both architectures. Their original test source remains unchanged.

[AGIJobManager integration acceptance](validation/LINUX_1_0_9_JOB_INTEGRATION_ADDENDUM.md) additionally passed **eight standalone EVM scripts, a freshly compiled-manager lifecycle with Agent and three Node clients, and 777 manager regressions on each architecture**. All 11 production sources and contract artifacts match the current manager baseline (1.13.0). The independent audit verified 38 integration logs; permanent evidence is attached to the release. Generation, content transport and identities use explicit fixtures.

Fresh physical installation, rootless Docker/cgroup enforcement, real OAuth/inference, live documents, positive base AND browser cleanup, reboot identity persistence and 72-hour endurance are **NOT RUN**. Keep funded work disabled while recording these gates. Native regression success cannot supply physical observations.

## Download integrity

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| AGI_Fleet_Linux_v1.0.9.zip | 401,420,759 | `5e17bac752ae8dfc8756fe8dc612ceb8820616723808232f3541d552addce102` |

Every supplied archive and member is below **450,000,000 bytes**. Permanent native evidence and its checksum are attached to the release. The original Fleet ZIP remains frozen; its embedded pending reports are superseded by the [later hash-bound addendum](validation/LINUX_1_0_9_NATIVE_ADDENDUM.md).

## Engineering

[Development and verified source materialization](docs/DEVELOPMENT.md) · [Native reproduction](engineering/README.md) · [AGIJobManager integration](docs/JOB_INTEGRATION.md)

The repository tracks the exact inventoried application source under `fleet/`, including all six roles, shared runtime, 342 regression files, lockfiles and license notices. Dependencies and historical reports are distributed in the full Fleet ZIP. Use that ZIP for operator installation; GitHub-generated source archives are development checkouts.

Historical results remain available: [1.0.6](validation/LINUX_1_0_6_NATIVE_ADDENDUM.md), [1.0.7](validation/LINUX_1_0_7_NATIVE_ADDENDUM.md), [1.0.8](validation/LINUX_1_0_8_NATIVE_ADDENDUM.md). Their failures have not been relabeled.

Never commit operator profiles, wallets, setup JSON, OAuth stores, provider responses or user documents.
