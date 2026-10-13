# Linux 1.0.11 — exact-archive AGIJobManager 1.15.0 qualification

A qualification prerelease for controlled fresh installation on Ubuntu Desktop 24.04 LTS, x86-64 and ARM64. All six roles are included. Physical commissioning and production qualification remain open.

## What changed

- The release integration gate now exercises this exact saved Fleet ZIP against AGIJobManager **1.15.0**, commit `3958cbc3b01aa459de16cf39e1ab0985b5fa56c3`. Earlier compatibility probes used the frozen 1.0.9 Fleet ZIP; they are preserved separately and do not substitute for this release's results.
- The integration target is bound into build metadata and every native/integration evidence receipt. Independent auditing requires the exact Manager version and commit, eight standalone integration scripts, 11 matching production artifacts, the Agent/three-Node lifecycle and all **780** Manager regressions.
- Publication rejects mismatched build commits, changed release specifications, mixed workflow runs, wrong Manager commits and incomplete aggregate log coverage. Negative tests exercise these rejection paths.
- The complete installer includes the current clean-install, recovery, integration and existing-instance commissioning guides. All seven edition version records are coordinated at 1.0.11.

Fleet runtime logic, dependencies, contract artifacts and test assertions are unchanged from Linux 1.0.10. Installer, UI and retained launcher version labels are coordinated at 1.0.11. Contract production source remains compatible; this release does not deploy or migrate contracts. Existing releases and historical evidence remain intact.

## Exact-archive acceptance required for publication

| Gate | Required on each architecture |
| --- | --- |
| Targeted native suite | 25 files; 291 passing tests |
| Complete native suite | 342 files; 3,898 passing tests |
| AGIJobManager 1.15.0 | Eight integration scripts; Agent/three-Node lifecycle; 780 passing Manager tests |
| Independent audit | Exact source and archive hashes, retained logs, counts, integration target and workflow provenance agree |

Both native scopes require zero failures, skips, cancellations, TODOs and timeouts. Real Unix-domain sockets and disposable foreign ownership are exercised on isolated engineering runners with verified Node 24.21.0 and pinned OpenClaw 2026.9.5. Operator accounts are never fixtures. Original 44 failing and six skipped case source files remain unchanged.

The publisher runs only after these gates pass and verifies remote asset digests before exposing the release. The manifest and evidence ZIP record observed results. Validation records embedded before the installer ZIP was frozen remain PENDING; the external hash-bound manifest supplies completed acceptance.

## Fresh installation

Download `AGI_Fleet_Linux_v1.0.11.zip` and `SHA256SUMS-v1.0.11.txt` together. Use the complete Fleet ZIP; GitHub's generated source archive is a development checkout. Follow the [single Linux fresh-install guide](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.0.11-qualification/docs/FRESH_INSTALL.md). Preserve earlier installations inactive; use new, separate nonadministrator signer/compute accounts. No migration, historical engineering fixtures or manual state editing is required.

Pins remain Node 24.21.0, OpenClaw 2026.9.5 and rootless Docker Engine 29.8.2. New profiles retain 256 runs per rolling day and 32 Agent/Node image attempts, with independent spending controls and signer approval. Each archive and member must stay below **450,000,000 bytes**.

## Qualification still required

Physical Linux installation, rootless Docker/cgroup enforcement, live OAuth/inference, real documents, positive base AND browser sandbox cleanup, persisted approval after reboot and 72-hour endurance remain **NOT_RUN**. Complete the [physical ledger](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.0.11-qualification/docs/PHYSICAL_QUALIFICATION.md) before funded work. Local-chain integration uses mock USDC and fixtures for generation, content transport and identities; it does not prove real payments or independently operated validators.

The Linux and Mac source previews remain separate development artifacts outside this ZIP. Mac 1.20.2 remains a separate immutable release; neither Linux architecture qualifies physical M1 or M2 operation. The dated mainnet readiness decision remains HOLD until its operator gates pass.

On failure, preserve STOP, accounts, Docker/OpenClaw state, journals and sanitized reports. Never delete STOP manually, weaken ownership checks or replace the rootless daemon to force acceptance. This release is not represented as flawless or production-qualified.
