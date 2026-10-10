# Mac 1.20.1 — reliable first-start preparation

**A dedicated Apple silicon Mac distribution with all six Fleet roles and a guided clean-install path.** This candidate targets M1 and M2 Macs, macOS 15 or later and native arm64 execution. It remains separate from the Linux release identity and its physical evidence.

## What changed in 1.20.1

A first-start timing race could interrupt a new Standard-account installation: the pinned Gateway could write its interface cache after it had reported ready. The later integrity check then correctly rejected the unexpected profile change.

The installer now prepares the exact pinned cache while the private candidate is stopped, before capturing its authority and asking for approval. This removes the identified race without relaxing integrity validation, ownership checks, cleanup requirements or safety stops. A regression using the actual pinned runtime checks this preparation path.

Mac 1.20.0 introduced the initial complete Mac distribution. Its archive and recorded results remain separate historical evidence. Version 1.20.1 has a new archive, source revision and qualification run; earlier acceptance does not qualify the changed package.

## Included

- One complete Fleet ZIP containing Agent, Node, Moderator, Employer, Evidence and Recovery role folders, each with its own launchers and guides.
- Mac app/command launchers, signer-only seed-wallet controls, separate Standard compute installation, pinned private runtime and authenticated readiness.
- Agent creation, Node review, isolated document/code/computer-work capabilities and specialist formal workflows with their existing authority limits.
- macOS service and secret-storage paths, retained stop/recovery evidence, positive cleanup checks and native-workforce pilot source.
- Mac-specific online entry points, offline welcome and fresh-install/help/qualification guides.
- Reproducible package verification, release manifests/checksums, archive size limits and separate Mac regression/physical evidence gates.

## Version targets and limits

| Component | Candidate target |
| --- | --- |
| Host | Physical Apple silicon M1 or M2; macOS 15+; no Rosetta execution |
| Node | Preferred 24.21.0; supported >=24.19.0 and <25 |
| OpenClaw | Private pinned 2026.9.5 |
| Docker Desktop | Apple silicon 4.93.0, user CLI and user context |
| Memory/storage planning | 16 GB RAM recommended; allow 40 GB free storage plus work; 8 GB M1 remains unqualified |
| Fresh run limits | 256 runs/signer requests per rolling 24 hours |
| Images | 32 attempts for Agent/Node; zero for specialist roles |
| Archive | The complete Mac Fleet ZIP must remain below 450 MB |

Pins identify the evaluated dependency target, not a claim that it is the latest version. Changing a pin, runtime, policy or archive requires new evidence for the changed scope.

## What this release does not claim

Physical M1 and M2 fresh installation, live provider work, useful independent review, positive base/browser cleanup, reboot recovery, 72-hour endurance and role interaction need exact-release observations. Native CI and synthetic tests remain regression evidence. The package is not developer-signed or notarized; use only verified official artifacts and normal macOS file-specific approval.

Funded work, public browsing, native desktop permissions and production operation remain subject to their own checks and explicit authority. A successful install, package hash or evidence-completeness result does not grant those permissions. No throughput, profitability or billion-user capacity is asserted.

## How to start

Open [Welcome](START_HERE.md), then follow [Fresh Mac setup](FRESH_INSTALL.md). Keep previous installations inactive and intact; this is a clean-install-first release. Migration is a separately reviewed advanced path, never a prerequisite for a new Mac installation.

Use [Physical qualification](PHYSICAL_QUALIFICATION.md) to record results for this exact release and [Help and recovery](TROUBLESHOOTING.md) if anything stops. The published release assets and machine-readable validation reports are authoritative for the checks actually run; these notes deliberately do not invent results.
