# Linux 1.0.6 native validation addendum

**Release acceptance: NOT_PASS. Operator installation remains gated.**

This addendum is bound to the unchanged `AGI_Fleet_Linux_v1.0.6.zip`, SHA-256 `c3faed24d51472a7a69dede9f9d015c433e5b5c7e09aab331b61a02e681340e1`, 402,016,636 bytes. The published archive was not modified to obtain these results.

| Run | Tests | Pass | Fail | Skip | Timeout |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original restricted complete suite | 3,876 | 3,826 | 44 | 6 | 0 |
| Ubuntu 24.04 x86-64 targeted | 224 | 224 | 0 | 0 | 0 |
| Ubuntu 24.04 ARM64 targeted | 224 | 224 | 0 | 0 | 0 |
| Ubuntu 24.04 x86-64 complete | 3,876 | 3,847 | 29 | 0 | 0 |
| Ubuntu 24.04 ARM64 complete | 3,876 | 3,846 | 30 | 0 | 0 |

The targeted selection covers all 14 files containing the original 44 failures and six skips. Independent reconciliation confirms all 50 original case names passed in both targeted and complete runs on both architectures. The complete suites ran all 341 files. There were no cancellations or TODO cases.

The remaining failures are in eight files: six role copies of `setup-runtime-materialization.test.mjs` (23 failures on x86-64, 24 on ARM64) and Agent/Node `setup-standard-readiness.test.mjs` (six failures on each architecture). These failures remain part of the acceptance result. Diagnosis and any corrective candidate require separate evidence.

## Provenance

- [Capable run 37998479254](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/37998479254), workflow commit `ba6dcb4fdf6a90f560ee78d736cca0802f7580af`.
- Fresh disposable GitHub-hosted Ubuntu 24.04 x86-64 and ARM64 VMs. Authorized root context supplies real Unix-domain sockets, hard links and disposable foreign ownership. No operator signer or compute account was used.
- Exact Node 24.21.0 vendor archives verified against fixed SHA-256 digests. OpenClaw 2026.9.5 verified through its CLI and a complete package inventory of 11,427 files. Dependencies came from the supplied lockfile, with install scripts disabled.
- Supplied historical fixture archive SHA-256 `4e95b35a90a2f212f2686f2c31bd4eb0d7de8131f1733d4d51e8647359b47014`; all four historical manifests verified.
- Saved release archive: CRC, all seven package manifests, source inventories and fresh extraction verified. Source bytes and retained logs stayed unchanged through each suite.
- [Independent audit](capable-37998479254-audit.json) reconciles all 710 TAP logs, their sizes and hashes, test counts, exact source bytes and original case identities. Its evidence-integrity result is PASS; its release-acceptance result remains NOT_PASS.

The first capable-run attempt, [37998288915](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/37998288915), executed zero tests: the frozen executable guard correctly rejected Node under the runner's world-writable `/opt`. Provisioning was moved to a private, root-owned `/root` tree. No ownership rule changed. [The attempt receipt](attempts/37998288915.json) remains separate.

## Retained capable-run artifacts

| Architecture | Artifact ID | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| x86-64 | 11649631085 | 1,037,920 | `b2a10ee53bddd08f0df658f8be6ad7a46228709b25c089db3f6ecea33fbffab1` |
| ARM64 | 11649866054 | 1,040,844 | `07aaee1521d47ce424cdb0706d5f12babcb0f2b9afb061f361a1c60acbc39f4d` |

Each artifact contains runner and prerequisite receipts, saved-archive verification, targeted and complete results, tested-source inventories, every TAP log and download receipts. The original restricted evidence is preserved in its original published ZIP. The runner deliberately returns `1` for any partial selection; scoped targeted PASS was established by checking every selected result and count. The complete runner returned `1` and NOT_PASS as required.

Physical Linux installation, rootless Docker/systemd integration, real OAuth and inference, actual document workflow cleanup, approval persistence after reboot and the 72-hour endurance period have not been qualified by these runs. M1 and M2 results remain separate and pending. No result here authorizes deletion of COMPUTE_STOP or changes to existing operator state.
