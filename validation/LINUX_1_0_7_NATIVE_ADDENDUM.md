# Linux 1.0.7 native validation addendum

**Native release acceptance: NOT_PASS. Production qualification: NOT QUALIFIED.**

Bound to the immutable `AGI_Fleet_Linux_v1.0.7.zip`: **401,734,226 bytes**, SHA-256 `11c47bf901df7c47d5816be0f65a707bd5ff9efd6d515a9f9ae5ae7a77fa062d`. No release source or test bytes changed during the capable runs. This external addendum supplies the completed results; validation records embedded before archive freezing remain historical PENDING records and are not rewritten.

| Architecture / scope | Tests | Pass | Fail | Skip | Timeout |
| --- | ---: | ---: | ---: | ---: | ---: |
| x64 targeted | 285 | 283 | 2 | 0 | 0 |
| x64 complete | 3,897 | 3,889 | 8 | 0 | 0 |
| arm64 targeted | 285 | 283 | 2 | 0 | 0 |
| arm64 complete | 3,897 | 3,889 | 8 | 0 | 0 |

The targeted selection contains 23 files; the complete suite contains all 342 test files. There were no cancellations or TODO cases. Targeted selection deliberately returns exit 1 under the frozen runner's partial-scope convention; each targeted result and aggregate was checked independently. Full-suite acceptance requires exit 0 and FULL/PASS.

The complete suite retains eight failures: the two Agent/Node execution-fingerprint source-map boundary cases plus six historical fresh-readiness resume cases. The targeted selection retains the two source-map failures. The added standalone runtime module enlarged the bounded source map from 128 to 129 entries. The existing 128-entry guard correctly rejected it. Linux 1.0.8 relocates the validator into the existing SQLite module without raising the bound or omitting approved source. This 1.0.7 archive remains immutable and is not an installation candidate. The historical fixture removed runtimeMutabilityVersion to recreate the released 1.18.6 approval, but incorrectly retained the newly added pluginCatalogCacheVersion. The unchanged version guard correctly rejected that impossible combination with SETUP_RUNTIME_SECURITY_VERSION. Linux 1.0.9 removes both modern fields in those two historical fixtures; production executable source and test acceptance assertions are unchanged from 1.0.8. Its separate saved archive must pass independent native validation.

## Exact evidence and prerequisites

- [Native run 38006497366](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38006497366), workflow commit `9c448784fe0b61e4b097c1142eb0884d788c4e07`.
- Separate disposable GitHub-hosted Ubuntu 24.04 x64 and ARM64 VMs. Native Unix-domain socket round trips and disposable foreign socket/directory ownership were exercised. No operator signer, compute account, wallet or OAuth store was used.
- Hash-pinned Node 24.21.0 in the private application runtime and the SDK's trusted system lookup. Runner provisioning preserved the ambient non-pinned binary, verified parent ownership and permissions, and left application guards unchanged. The original runner `/opt` refusal remains preserved separately.
- OpenClaw 2026.9.5 checked through its actual CLI and the full 11,427-file package inventory. Dependencies were prepared from the supplied lockfile with install scripts disabled. The four historical fixture manifests passed; fixture archive SHA-256 is `4e95b35a90a2f212f2686f2c31bd4eb0d7de8131f1733d4d51e8647359b47014`.
- Saved ZIP CRC, all seven manifests, source inventories and fresh extraction passed. Source and retained TAP hashes stayed unchanged throughout both scopes.
- [Independent audit](capable-38006497366-audit.json) reconciles **730 TAP logs**, exact selections, source inventories, each original case name, counts and log sizes/hashes. Every role's positive runtime-materialization tests required the real pinned Gateway's hosted discovery cache in both scopes.
- `Linux-Native-Evidence-v1.0.7.zip` in the [release assets](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.7-qualification) preserves the original CI artifact ZIPs, receipts, auditor, ledger, local saved-archive gates and this addendum. Its external checksum receipt is published separately.

| Architecture | CI artifact ID | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| x64 | 11652188334 | 1,063,052 | `7c46ef3c3d085c2ae6864743f95ebee1504b82581120de6d2ae62e55ab25baf8` |
| arm64 | 11651967952 | 1,061,391 | `969cdbefd827b64593750e8dc254f41851b9cdcf0478e643076721c88c0d0aaf` |

## Changes and retained earlier evidence

The bounded discovery-cache policy is explicitly versioned for new Verified approvals. It accepts only the pinned default feed, exact row schema, bounded JSON and checksum format, and null trust metadata. The feed is unsigned discovery data and grants no installation authority. Installed code, explicit plugin allowlists, approvals, configuration and credentials remain sealed. Older seals retain their original strict comparison. Malformed cache state fails closed with a sanitized failure classification. Ownership checks, spending limits and COMPUTE_STOP reconciliation rules are unchanged.

Telemetry integration tests disable the SDK's independent automatic polling while exercising the actual pinned telemetry writer and real local HTTP requests. Native acceptance does not substitute mocks for the socket/ownership cases.

The [1.0.6 restricted and capable evidence](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.6-qualification) remains unchanged: restricted 3,826 pass / 44 fail / six skip; capable complete 3,847 pass / 29 fail on x64 and 3,846 pass / 30 fail on ARM64. Original-case resolution did not make those complete runs pass. Linux 1.0.7's separate failure evidence is also retained. Diagnostic runs are labeled NOT ACCEPTANCE and never substituted for frozen-source validation.

## Remaining physical qualification

Physical Linux fresh installation, rootless Docker/systemd integration, real OAuth and inference, actual document creation, positive base and browser sandbox cleanup, persisted identity approval after reboot and the 72-hour endurance period are **NOT RUN**. Physical M1 and M2 results are each **NOT RUN** and cannot be inferred from Linux ARM64 tests. This Linux edition is not the Mac installation path.

Use the [single fresh-install procedure](../docs/FRESH_INSTALL.md) only with a candidate whose native addendum is PASS. Preserve earlier installations inactive; no migration, historical engineering fixtures or manual state editing is required. A failed or ambiguous cleanup must retain COMPUTE_STOP and its evidence. No native result authorizes deleting STOP, funding a wallet, submitting paid jobs or changing an operator's existing state.
