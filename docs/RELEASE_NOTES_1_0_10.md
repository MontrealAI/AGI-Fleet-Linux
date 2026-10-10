# Linux 1.0.10 — clear installation and trustworthy release identity

A new **qualification prerelease** for controlled fresh installation on Ubuntu Desktop 24.04 LTS, x86-64 and ARM64. All six roles are included: Agent, Node, Moderator, Employer, Evidence and Recovery.

## What changed

- Linux inspection and qualification reports now read the installed role version instead of reporting the stale 1.0.6 label. Role registry, package versions and companion metadata agree on 1.0.10.
- The installation guide explains account separation, prerequisites, transfer checks, each role's actual OAuth sessions, readiness, and safe recovery. A dedicated troubleshooting guide covers STOP conditions, services and support evidence.
- Current operator guides ship inside the Fleet ZIP and each role directory. Historical evidence remains identifiable as historical.
- Reproducible packaging starts from the verified 1.0.9 dependency bundle and overlays the reviewed source. It regenerates the seven source inventories, manifests, SBOMs and change indexes, then validates the final extracted archive.
- Publication requires new source-bound native and AGIJobManager integration results on both architectures, followed by an independent audit of retained logs. Existing assets are never silently replaced.

## Release acceptance

This publication is gated on **291 targeted tests and 3,898 full-suite tests per architecture**, with zero failures, skips or timeouts. It additionally requires all eight standalone EVM integrations, the Agent/three-Node manager lifecycle and the 777 manager regressions per architecture. The packaged contract baseline is AGIJobManager commit `191cf3590e5cdc08df1bb0af500ee28a91c8b010` (1.13.0); this does not assert compatibility with later untested contract changes.

The attached qualification evidence and release manifest record the actual archive identity, source commit, observed counts, and every retained log. Every supplied file and ZIP member is below **450,000,000 bytes**.

## Install

Download `AGI_Fleet_Linux_v1.0.10.zip` and `SHA256SUMS-v1.0.10.txt` from this release. Follow [Fresh installation](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.0.10-qualification/docs/FRESH_INSTALL.md), or open `START_HERE.md` after extraction. GitHub-generated source archives are engineering checkouts; use the named Fleet ZIP for installation.

Use fresh separate signer and compute accounts. The pinned runtime remains Node 24.21.0, OpenClaw 2026.9.5 and Docker Engine 29.8.2. Dependencies and on-chain contract policies are unchanged.

**Physical commissioning is not yet qualified:** fresh installation, rootless Docker/cgroups, real OAuth and inference, live document work, positive base AND browser cleanup, reboot identity persistence, and the 72-hour endurance run remain NOT RUN. Keep funded work disabled until those observations pass. The included mainnet report is a dated read-only snapshot, not a current intake-readiness claim.

The original 1.0.9 implementation and evidence remain preserved. This release does not relabel their results as 1.0.10 results.
