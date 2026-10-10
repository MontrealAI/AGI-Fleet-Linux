# AGI Fleet Linux

**Linux 1.0.9 passed the complete native suite on Ubuntu 24.04 x86-64 and ARM64. It is ready for controlled fresh installation on your Linux machine.** Physical qualification remains open, so this is a prerelease.

[Download Linux 1.0.9](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.9-qualification) · [Install step by step](docs/FRESH_INSTALL.md) · [Audited results](validation/LINUX_1_0_9_NATIVE_ADDENDUM.md)

The Fleet ZIP includes **Agent, Node, Moderator, Employer, Evidence and Recovery**. Agent performs sandboxed workstation work; Node independently checks and reviews it. Signer and compute run in separate nonadministrator accounts. Compute uses rootless Docker and policy-bound local services, with spending/run limits, authenticated readiness, durable cleanup evidence and fail-closed STOP controls.

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
