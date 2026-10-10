# Linux 1.0.8 native validation addendum

**Native release acceptance: NOT_PASS. Production qualification: NOT QUALIFIED.**

Bound to the immutable `AGI_Fleet_Linux_v1.0.8.zip`: **401,550,566 bytes**, SHA-256 `fa2bafdf957c3b3ecf36639ecd47adb4f7bf33c2ddfb13a99500fdd4625f4fb8`. No release source or test bytes changed during the capable runs. This external addendum supplies the completed results; validation records embedded before archive freezing remain historical PENDING records and are not rewritten.

| Architecture / scope | Tests | Pass | Fail | Skip | Timeout |
| --- | ---: | ---: | ---: | ---: | ---: |
| x64 targeted | 285 | 285 | 0 | 0 | 0 |
| x64 complete | 3,897 | 3,891 | 6 | 0 | 0 |
| arm64 targeted | 285 | 285 | 0 | 0 | 0 |
| arm64 complete | 3,897 | 3,891 | 6 | 0 | 0 |

The targeted selection contains 23 files; the complete suite contains all 342 test files. There were no cancellations or TODO cases. Targeted selection deliberately returns exit 1 under the frozen runner's partial-scope convention; each targeted result and aggregate was checked independently. Full-suite acceptance requires exit 0 and FULL/PASS.

The targeted selection passed, including the source-map boundary cases. The complete suite retains six historical fresh-readiness resume failures, three each for Agent and Node. This archive remains immutable and is not an installation candidate. The historical fixture removed runtimeMutabilityVersion to recreate the released 1.18.6 approval, but incorrectly retained the newly added pluginCatalogCacheVersion. The unchanged version guard correctly rejected that impossible combination with SETUP_RUNTIME_SECURITY_VERSION. Linux 1.0.9 removes both modern fields in those two historical fixtures; production executable source and test acceptance assertions are unchanged from 1.0.8. Its separate saved archive must pass independent native validation.

## Exact evidence and prerequisites

- [Native run 38007875613](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38007875613), workflow commit `e5a8c2cc3d2e13f4a2269fe7585892b9173079b3`.
- Separate disposable GitHub-hosted Ubuntu 24.04 x64 and ARM64 VMs. Native Unix-domain socket round trips and disposable foreign socket/directory ownership were exercised. No operator signer, compute account, wallet or OAuth store was used.
- Hash-pinned Node 24.21.0 in the private application runtime and the SDK's trusted system lookup. Runner provisioning preserved the ambient non-pinned binary, verified parent ownership and permissions, and left application guards unchanged. The original runner `/opt` refusal remains preserved separately.
- OpenClaw 2026.9.5 checked through its actual CLI and the full 11,427-file package inventory. Dependencies were prepared from the supplied lockfile with install scripts disabled. The four historical fixture manifests passed; fixture archive SHA-256 is `4e95b35a90a2f212f2686f2c31bd4eb0d7de8131f1733d4d51e8647359b47014`.
- Saved ZIP CRC, all seven manifests, source inventories and fresh extraction passed. Source and retained TAP hashes stayed unchanged throughout both scopes.
- [Independent audit](capable-38007875613-audit.json) reconciles **730 TAP logs**, exact selections, source inventories, each original case name, counts and log sizes/hashes. Every role's positive runtime-materialization tests required the real pinned Gateway's hosted discovery cache in both scopes.
- `Linux-Native-Evidence-v1.0.8.zip` in the [release assets](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.8-qualification) preserves the original CI artifact ZIPs, receipts, auditor, ledger, local saved-archive gates and this addendum. Its external checksum receipt is published separately.

| Architecture | CI artifact ID | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| x64 | 11653730393 | 1,057,278 | `838995174f8f2e842b086fe859431ba384ad081898bd24e8de3494096327255a` |
| arm64 | 11653360376 | 1,060,670 | `834e4057fbd4b9bdfefa234b289254c4299bf579782dfddd8dcdf498811fd710` |

## Changes and retained earlier evidence

The bounded discovery-cache policy is explicitly versioned for new Verified approvals. It accepts only the pinned default feed, exact row schema, bounded JSON and checksum format, and null trust metadata. The feed is unsigned discovery data and grants no installation authority. Installed code, explicit plugin allowlists, approvals, configuration and credentials remain sealed. Older seals retain their original strict comparison. Malformed cache state fails closed with a sanitized failure classification. Ownership checks, spending limits and COMPUTE_STOP reconciliation rules are unchanged.

Telemetry integration tests disable the SDK's independent automatic polling while exercising the actual pinned telemetry writer and real local HTTP requests. Native acceptance does not substitute mocks for the socket/ownership cases.

The [1.0.6 restricted and capable evidence](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.6-qualification) remains unchanged: restricted 3,826 pass / 44 fail / six skip; capable complete 3,847 pass / 29 fail on x64 and 3,846 pass / 30 fail on ARM64. Original-case resolution did not make those complete runs pass. Linux 1.0.7's separate failure evidence is also retained. Diagnostic runs are labeled NOT ACCEPTANCE and never substituted for frozen-source validation.

## Remaining physical qualification

Physical Linux fresh installation, rootless Docker/systemd integration, real OAuth and inference, actual document creation, positive base and browser sandbox cleanup, persisted identity approval after reboot and the 72-hour endurance period are **NOT RUN**. Physical M1 and M2 results are each **NOT RUN** and cannot be inferred from Linux ARM64 tests. This Linux edition is not the Mac installation path.

Use the [single fresh-install procedure](../docs/FRESH_INSTALL.md) only with a candidate whose native addendum is PASS. Preserve earlier installations inactive; no migration, historical engineering fixtures or manual state editing is required. A failed or ambiguous cleanup must retain COMPUTE_STOP and its evidence. No native result authorizes deleting STOP, funding a wallet, submitting paid jobs or changing an operator's existing state.
