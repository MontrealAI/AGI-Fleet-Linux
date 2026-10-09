# AGI Fleet Linux

**Linux 1.0.7 is a controlled qualification candidate, not production-qualified.**

The [frozen 1.0.7 prerelease](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.7-qualification) contains all six roles for Ubuntu Desktop 24.04 LTS, x86-64 and ARM64. Download the Fleet Linux ZIP for the implementation. GitHub-generated source archives contain this qualification repository and its engineering harnesses.

## Native validation

[Run 38006497366](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38006497366) is testing the exact published 1.0.7 ZIP on separate, disposable x64 and ARM64 runners. It runs 23 targeted files (285 tests), followed by the complete 342-file suite (3,897 tests). **The run has exposed a source-map limit regression in 1.0.7; the operator installation gate remains closed. Complete results are still running and will be preserved.**

A separately versioned 1.0.8 candidate is being prepared. It retains the 128-entry bound by placing the catalog validator inside the existing SQLite policy module. The unchanged regression test reproduces failure on 1.0.7 and passes on 1.0.8; this local result does not replace native saved-archive acceptance.

The prerequisites include real Unix-domain sockets and disposable cross-user ownership, verified Node 24.21.0 in application and SDK system lookup locations, inventory-verified OpenClaw 2026.9.5, and the supplied historical fixtures. Ownership guards and fail-closed STOP handling remain enforced. No operator account, wallet or OAuth store is a fixture.

The new release introduces a bounded, explicitly versioned policy for the pinned default unsigned plugin discovery cache. Installed code, plugin approvals, allowlists, credentials and older seals remain protected. Telemetry integration tests isolate automatic polling while retaining the actual pinned writer and real local HTTP requests.

The [original 1.0.6 artifacts](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.6-qualification) remain unchanged. Its restricted run recorded 3,826 passes, 44 failures and six skips. Native runs resolved those original 50 cases on both architectures, but complete runs found 29 x64 and 30 ARM64 failures. The [separate 1.0.6 addendum](validation/LINUX_1_0_6_NATIVE_ADDENDUM.md) retains those failures and the independent 710-log audit. They are not relabeled as passes.

## Fresh installation

Use the [single fresh signer/compute procedure](docs/FRESH_INSTALL.md) only after the hash-bound native addendum records complete-suite PASS for your architecture. Preserve prior installations inactive. No migration, historical engineering fixtures or manual state editing is required.

Physical Linux installation, real OAuth/inference, actual documents, positive base/browser cleanup, identity approval after reboot and measured endurance remain unqualified. Physical M1 and M2 results are separately NOT RUN. Native regression success does not qualify those gates.

New profiles default to 256 runs per rolling day; Agent and Node allow 32 image attempts. Spending controls and explicit signer approvals remain independent.

## Frozen candidate identity

- File: `AGI_Fleet_Linux_v1.0.7.zip`
- Bytes: 401,734,226
- SHA-256: `11c47bf901df7c47d5816be0f65a707bd5ff9efd6d515a9f9ae5ae7a77fa062d`
- Every supplied archive and member is below 450,000,000 bytes.
- Saved-archive checks passed: all seven manifests/source inventories, 275 shell files, 7,786 JavaScript files and 248 packaged launcher cases. Local parsing used Node 24.19.0; native acceptance uses hash-pinned Node 24.21.0.

No operator profile, wallet, setup JSON, OAuth material, provider response or user document belongs in this repository.
