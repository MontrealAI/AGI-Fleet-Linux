# Linux 1.1.0 release validation addendum

Published as a qualification prerelease for controlled fresh installation. **Production qualification remains incomplete; physical qualification remains NOT_RUN.**

The [public release](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.0-qualification) is bound to commit `e120d55fb0b0d1f97691c59c5923ec400df14d14` and [main workflow 38481345528](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38481345528). The workflow built one saved archive and tested those same bytes on both architectures. The exact downloaded [published manifest](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.1.0-qualification/Release-Manifest-v1.1.0.json) is retained in `engineering/published-release.json`; the previous pointer is preserved in `successor/history/published-release-v1.0.11.json`.

| Observed check | Ubuntu 24.04 x86-64 | Ubuntu 24.04 ARM64 |
| --- | --- | --- |
| Targeted native regressions | 25 files; 291 PASS | 25 files; 291 PASS |
| Complete native suite | 343 files; 3,908 PASS | 343 files; 3,908 PASS |
| Manager 1.16.1 regressions | 780 PASS | 780 PASS |
| Standalone integration scripts | Eight PASS | Eight PASS |
| Fresh-manager Agent/three-Node lifecycle | PASS | PASS |
| Production source/artifact comparison | 11 matching sources and artifacts | 11 matching sources and artifacts |

Both native scopes have zero failed, skipped, cancelled or TODO cases. The evidence audit checked 736 retained TAP logs and 38 integration logs against source, hashes, counts and workflow identity. The exact Manager source is `09d89fb22d52a8df194e8dd0a00beff9f7771d82`. The source inventory contains 5,914 files, SHA-256 `284b7082c6c74bc2ca97e55990387b7969097208eacec75df943440280c1dd0f`.

## Saved-archive Builder journey

The browser gate creates useful work in the free Builder and downloads its Fleet request. It authenticates installed Agent and Node HTTP sessions with their own authorization; dispatch without confirmation and cross-role authorization are rejected. Real Chromium interaction creates and downloads bytes through Controller, Companion and ComputeWorker. Node reopens those exact delivered bytes. The checked capsule preserves the incumbent until explicit version selection. The selected HTML and capsule are downloaded, restored in fresh offline English and French browser contexts and rerun with identical artifact bytes. Restored authority remains `none` and payment remains `unfunded`.

The audit binds this journey and its screenshots to the archive, source and workflow. Provider transport and sandbox CLI are explicitly simulated. This establishes engineering behavior, not live-provider competence, physical sandbox isolation, reviewer independence or funded marketplace readiness. Free local missions remain usable without installing Fleet or providing credentials.

The portable pack requires a completed Node review, with valid criterion checks, and binds the receipt, handoff, immutable plan and actual artifacts. Recomputed hashes cannot hide missing evidence, a substituted project or changed requirements. Custom public work records its complete specification before execution. Original public/native workflows, backup safeguards and control-server startup remain preserved.

## Public download verification

| Public asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `AGI_Fleet_Linux_v1.1.0.zip` | 423,729,286 | `7d5f5063fadaf229ce01c753523e475edd98429a280f84fe9c6f4aa92ed3c9dc` |
| `Linux-Qualification-Evidence-v1.1.0.zip` | 6,151,019 | `f2fedfc48bdcc9d59c80bf0ee8ae9509c53aea6b7dcdc33e4e61986de7a70cce` |
| `Release-Manifest-v1.1.0.json` | 111,081 | `e9b4edc6d8952fae6eb519bb5af98415e0758cc6a7cc9e6ff1f37df71b678b31` |
| `SHA256SUMS-v1.1.0.txt` | 294 | `ad38ea0548b15b8914849225f8253f197bf8d8af7b8bd61c64341efb2e6496da` |

After publication, all four assets were downloaded and compared with GitHub asset sizes and digests and the published checksum file. The evidence ZIP passed CRC and member-size checks; its audit equals the manifest audit. The saved installer passed archive validation; every pinned upstream Builder file matched provenance; the editable Builder source rebuilt byte-identically using pinned Node 24.21.0. All supplied assets and archive members remain below 450,000,000 bytes.

## Preserved history and remaining scope

Linux 1.0.11, earlier release assets and validation records, and the separate Mac 1.20.2 qualification remain historical and unchanged. Use [fresh installation](../docs/FRESH_INSTALL.md) on a dedicated host with separate nonadministrator signer and compute accounts. Publication does not authorize a transaction, funding, custody change or paid intake activation.

Physical installation, rootless Docker/cgroup enforcement, real OAuth/inference and costs, native application competence, independently administered review, human accessibility/usability sessions, positive base AND browser cleanup, reboot persistence and 72-hour live endurance remain **NOT_RUN**. The historical activation decision remains **HOLD**.
