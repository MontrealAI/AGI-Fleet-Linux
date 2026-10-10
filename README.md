# AGI Fleet Linux

**Linux 1.0.9 is a controlled qualification candidate, not production-qualified. Native validation is running; operator installation remains gated.**

The [frozen 1.0.9 prerelease](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.9-qualification) contains all six roles for Ubuntu Desktop 24.04 LTS, x86-64 and ARM64. Download the Fleet Linux ZIP for the implementation. GitHub-generated source archives contain this qualification repository and its engineering harnesses.

## Native validation

[Run 38022168787](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38022168787) is testing the exact published 1.0.9 ZIP on separate, disposable x64 and ARM64 runners. It runs 25 targeted files (291 tests), followed by the complete 342-file suite (3,897 tests). **Results are pending; the operator installation gate remains closed until the complete results and retained evidence pass independent audit.**

The prerequisites include real Unix-domain sockets and disposable cross-user ownership, verified Node 24.21.0 in application and SDK system lookup locations, inventory-verified OpenClaw 2026.9.5, and the supplied historical fixtures. Ownership guards and fail-closed STOP handling remain enforced. No operator account, wallet or OAuth store is a fixture.

Linux 1.0.9 corrects two historical fresh-readiness fixtures: a recreated 1.18.6 approval must omit both modern mutability-policy fields. Production executable source and test acceptance assertions are unchanged from 1.0.8. The original 50 case source files remain byte-for-byte unchanged. The existing 128-entry qualification source-map bound remains enforced.

The new release introduces a bounded, explicitly versioned policy for the pinned default unsigned plugin discovery cache. Installed code, plugin approvals, allowlists, credentials and older seals remain protected. Telemetry integration tests isolate automatic polling while retaining the actual pinned writer and real local HTTP requests.

The [original 1.0.6 artifacts](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.6-qualification) remain unchanged. Its restricted run recorded 3,826 passes, 44 failures and six skips. Native runs resolved those original 50 cases on both architectures, but complete runs found 29 x64 and 30 ARM64 failures. The [separate 1.0.6 addendum](validation/LINUX_1_0_6_NATIVE_ADDENDUM.md) retains those failures and the independent 710-log audit. They are not relabeled as passes.

The [1.0.7 addendum](validation/LINUX_1_0_7_NATIVE_ADDENDUM.md) records 283/285 targeted and 3,889/3,897 complete passes on each architecture, with two source-map boundary failures and six historical fixture failures. The [1.0.8 addendum](validation/LINUX_1_0_8_NATIVE_ADDENDUM.md) records 285/285 targeted and 3,891/3,897 complete passes on each architecture; its six historical fixture failures led to 1.0.9. Separate raw evidence and audits preserve both NOT_PASS results. See [engineering reproduction instructions](engineering/README.md).

## Fresh installation

Use the [single fresh signer/compute procedure](docs/FRESH_INSTALL.md) only after the hash-bound native addendum records complete-suite PASS for your architecture. Preserve prior installations inactive. No migration, historical engineering fixtures or manual state editing is required.

Physical Linux installation, real OAuth/inference, actual documents, positive base/browser cleanup, identity approval after reboot and measured endurance remain unqualified. Physical M1 and M2 results are separately NOT RUN. Native regression success does not qualify those gates.

New profiles default to 256 runs per rolling day; Agent and Node allow 32 image attempts. Spending controls and explicit signer approvals remain independent.

## Frozen candidate identity

- File: `AGI_Fleet_Linux_v1.0.9.zip`
- Bytes: 401,420,759
- SHA-256: `5e17bac752ae8dfc8756fe8dc612ceb8820616723808232f3541d552addce102`
- Every supplied archive and member is below 450,000,000 bytes.
- Saved-archive checks passed: all seven manifests/source inventories, 275 shell files, 7,773 JavaScript files and 248 packaged launcher cases. Local parsing used Node 24.19.0; native acceptance uses hash-pinned Node 24.21.0.

No operator profile, wallet, setup JSON, OAuth material, provider response or user document belongs in this repository.

