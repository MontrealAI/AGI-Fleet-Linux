# Linux 1.0.11 release validation addendum

Published on 13 October 2026 as a qualification prerelease for controlled fresh installation. **Production qualification is incomplete; physical qualification remains NOT_RUN.**

The [public release](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.11-qualification) is bound to commit `811c20df46aebbb7537e5a8b8ebdd53e3f9579bd` and [main workflow 38437206563](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38437206563). The release archive was built once, extracted afresh and tested unchanged on both architectures. The [published manifest](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.0.11-qualification/Release-Manifest-v1.0.11.json) contains the independent audit; its exact bytes are retained in `engineering/published-release.json`.

| Observed check | Ubuntu 24.04 x86-64 | Ubuntu 24.04 ARM64 |
| --- | --- | --- |
| Targeted native regressions | 25 files; 291 PASS | 25 files; 291 PASS |
| Complete native suite | 342 files; 3,898 PASS | 342 files; 3,898 PASS |
| Original restricted-run cases | 44 failures and six skips now PASS | 44 failures and six skips now PASS |
| Manager 1.15.0 regressions | 780 PASS | 780 PASS |
| Standalone integration scripts | Eight PASS | Eight PASS |
| Fresh-manager Agent/three-Node lifecycle | PASS | PASS |
| Production source/artifact comparison | 11 matching sources and artifacts | 11 matching sources and artifacts |

Both native scopes have zero failed, skipped, cancelled, TODO or timed-out cases. The isolated runners verified real Unix-domain socket round trips and disposable foreign socket/directory ownership, pinned Node 24.21.0 and OpenClaw 2026.9.5. Operator accounts were not fixtures. The independent audit verified **734 retained TAP logs and 38 integration logs**, including their hashes, source coverage and workflow provenance. Manager commit: `3958cbc3b01aa459de16cf39e1ab0985b5fa56c3`.

Saved-archive checks passed all seven manifests and source inventories, 275 shell parses, 7,773 JavaScript parses and 248 launcher cases. The source inventory contains 4,816 files with SHA-256 `8911ff0ef1f6f3e31260ed0ee04779a31652b8d725627dd04715663419a056e2`. Every supplied asset and archive member is below 450,000,000 bytes.

| Public asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `AGI_Fleet_Linux_v1.0.11.zip` | 404,252,051 | `4322b454df3e9fd8134cc7f28a12925f1d7c17e017ead545c1317006bb3c02cc` |
| `Linux-Qualification-Evidence-v1.0.11.zip` | 2,853,128 | `fe65b6d4f23352115ecd596d202b4a552d0e20c52c5a268d185f98599a773052` |
| `Release-Manifest-v1.0.11.json` | 109,763 | `8365b8ad433631b0a364d161735da9e0caaa6cfb798f583a6b08222019a68118` |
| `SHA256SUMS-v1.0.11.txt` | 297 | `a8a37bae5a1534064cbb6745e1d4c751372469ab42c519ce93a0d0edc3494bfc` |

Public asset sizes and digests, manifest/checksum bytes, evidence ZIP CRC and member sizes were verified after publication. The release tag still names the audited commit.

## Preserved history and scope

The original restricted-run records and older native/integration addenda remain unchanged. Preparation runs [38434941987](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38434941987) and [38435151331](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38435151331) rejected stale generated guide/version inventories; the Mac preview gate separately rejected its stale source inventory. The inventories and version labels were corrected without weakening checks. [PR run 38435995753](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38435995753) is separate evidence for its own commit; the main run above is authoritative for the published ZIP.

Fleet runtime logic, dependencies, contract artifacts and test assertions are unchanged from 1.0.10. This release adds exact-archive Manager 1.15.0 integration, stronger publication provenance and current operator guides. It does not inherit physical qualification from any previous release or source preview.

Use the [single fresh-install procedure](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.0.11-qualification/docs/FRESH_INSTALL.md) with new, separate nonadministrator signer and compute accounts. Keep earlier installations inactive and preserved. No migration, engineering fixtures or manual state editing is required.

Physical Linux installation, rootless Docker/cgroup enforcement, live OAuth and inference, actual document creation, positive base AND browser cleanup, persisted approval after reboot and 72-hour endurance remain **NOT_RUN**. Local-chain integration uses mock USDC and fixture generation, content transport and identities. Linux ARM64 results do not qualify physical M1 or M2 Macs; the Mac 1.20.2 release remains separate. Funded work stays disabled until the required commissioning observations pass.
