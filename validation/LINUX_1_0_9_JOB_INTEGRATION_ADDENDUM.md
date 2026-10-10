# Linux 1.0.9 AGIJobManager integration acceptance

**PASS on Ubuntu 24.04 x86-64 and ARM64.** This addendum supplements [native acceptance](LINUX_1_0_9_NATIVE_ADDENDUM.md). It does not replace the frozen Fleet ZIP or qualify physical operation.

| Identity | Value |
| --- | --- |
| Fleet ZIP SHA-256 | `5e17bac752ae8dfc8756fe8dc612ceb8820616723808232f3541d552addce102` |
| Fleet ZIP bytes | 401,420,759 |
| Manager baseline | `191cf3590e5cdc08df1bb0af500ee28a91c8b010`, package 1.13.0 |
| Engineering workflow commit | `1620be59395599b898fe81a4c36f040b3d9e1c8c` |
| Canonical run | [38052394030](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38052394030), main push, both jobs successful |
| Independent audit | [job-integration-audit.json](job-integration-audit.json) |

| Validation | x86-64 | ARM64 |
| --- | ---: | ---: |
| Preserved standalone EVM integration scripts | 8 / 8 | 8 / 8 |
| Fresh-manager Agent and three Node client lifecycle | PASS | PASS |
| Exact production Solidity sources matched | 11 / 11 | 11 / 11 |
| Contract artifacts reproduced and matched | 11 / 11 | 11 / 11 |
| Manager regression tests collected / executed / passed | 777 / 777 / 777 | 777 / 777 / 777 |
| Retained stage logs independently hash-verified | 19 / 19 | 19 / 19 |

The native runner collected `.test.mjs` files. This additional lane explicitly executes all eight standalone `integration*.mjs` scripts, including identity, finalization, budget recovery, image and computer lifecycles. It sets the current Node package path for the two frozen scripts with old standalone defaults. Future standalone additions cause a coverage failure until included. The old labels printed inside fixtures remain preserved; the outer evidence binds the actual Fleet ZIP, Node runtime and manager commit.

Fleet's bundled manager source pin is `db876a8021da6afcf7aa974489d13374e6d188b5` (`v1.1.0`). Every production source still matches the current baseline byte-for-byte. Fresh compilation also matches ABI, creation/runtime bytecode, linked-library references and immutable byte offsets. Compiler AST ID renumbering is permitted only when the exact immutable locations and bytecode match. Compilation completed with zero warnings or errors.

The new regression deploys the freshly compiled manager with its eight linked production libraries and uses the actual Agent and three actual Node clients. It keeps the default quorum of three and seven-day review period. Preparation, approval, voting, finalization and claims survive store closure/reopening. Every settlement transfer is deliberately failed, all reservations conserve mock USDC, and each Agent/Node claim recovers through the application journal after a restart. Fee recipients claim through fixture signers. The test ends with zero contract token balance, zero client exposure, conserved total mock USDC, one generation/publication and no repeated transactions.

## Permanent evidence

[Linux-Job-Integration-Evidence-v1.0.9.zip](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.0.9-qualification/Linux-Job-Integration-Evidence-v1.0.9.zip) retains both original Actions ZIPs, the independent audit, the runner, lifecycle regression and auditor. It is **74,706 bytes**, SHA-256 `059a085435ebf8d06789b74e754b25f028982dfebe72772982c6c236df5d7353`. [Metadata and original artifact identities](Linux-Job-Integration-Evidence-v1.0.9.json) bind the bundle to both saved runs. The publisher independently re-audits the original logs before uploading and refuses to replace mismatched assets. A separate `SHA256SUMS-job-integration-v1.0.9.txt` identifies the implementation and integration bundle.

Reproduce with the [job integration guide](../docs/JOB_INTEGRATION.md). Repository checks verify release/audit identities, both architectures and the frozen source. Negative tests reject missing/tampered logs, failed steps, skipped manager tests, changed contract hashes and claims that the simulation used real USDC.

## Remaining qualification

These are local EVM integrations. Model output and content transport are deterministic fixtures. The allowlisted identities and three validator wallets share one test controller; the two loopback RPC transports share one backend. The seven-day review window is advanced by eight simulated days. No production address, real USDC, paid inference, public IPFS, independently operated validators or real-time endurance is qualified.

Physical fresh installation, rootless Docker/cgroups, real OAuth/inference, live documents, positive base AND browser cleanup, reboot identity persistence and 72-hour endurance remain **NOT RUN**. The release stays a prerelease with `productionQualified: false`. Complete the [physical ledger](../docs/PHYSICAL_QUALIFICATION.md) and verify the selected deployed manager before funded operation.
