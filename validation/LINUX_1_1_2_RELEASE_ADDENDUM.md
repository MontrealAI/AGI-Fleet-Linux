# Linux 1.1.2 release validation addendum

Published as a qualification prerelease for controlled fresh installation. **Production qualification remains incomplete; physical qualification remains NOT_RUN.**

The [public release](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.2-qualification) is bound to commit `f1de8602ccea65250bfd0c40757e4984e889869e` and [main workflow 38614251266](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38614251266). The workflow built one saved archive and exercised those same bytes on both architectures. The downloaded published manifest is retained in `engineering/published-release.json`; the previous pointer is preserved byte-for-byte in `successor/history/published-release-v1.1.1.json`.

Publication was retried alone after a queue-recovery cancellation. The successful build, native, integration, browser and independent audit results were retained in the same workflow run; the qualified archive was not rebuilt or replaced.

This release adds stronger report checks, approved column mapping, selected-method reuse with parent lineage, truthful attempt observations, landing-page accessibility corrections and repaired Mac build tooling. The published Mac 1.20.2 archive remains separate. Existing release tags and evidence are preserved.

| Observed check | Ubuntu 24.04 x86-64 | Ubuntu 24.04 ARM64 |
| --- | --- | --- |
| Targeted native regressions | 25 files; 291 PASS | 25 files; 291 PASS |
| Complete native suite | 343 files; 3,909 PASS | 343 files; 3,909 PASS |
| Manager source regressions | 780 PASS | 780 PASS |
| Standalone integration and Agent/three-Node lifecycle | PASS | PASS |
| Production source/artifact comparison | 11 matching sources and artifacts | 11 matching sources and artifacts |

Both native scopes have zero failed, skipped, cancelled or TODO cases. The independent audit checked 736 TAP logs and 38 integration logs against exact source, hashes, counts and workflow identity. The Manager target is revision `d9b65eda376e990db30bfd20235cac0447af7fa4`, derived from 1.16.1 with engine 2 corrections. The source inventory contains 5,989 files, SHA-256 `52c25a4d7d548c0be33db1c509a8948cceff41a30550d6b4679b4c34f8ff8936`. These are new 1.1.2 results; earlier observations are not relabelled.

## Saved-archive Builder journey

The saved-archive browser gate passes authenticated Agent execution, separately authorized Node review, checked capsule import, explicit version choice and fresh offline English/French restoration and reruns. It also exercises selected-method reuse on new, explicitly mapped inputs, fresh checks, whole mobile numbers and retained parent lineage. Restored authority remains `none` and payment remains `unfunded`.

Provider transport and sandbox CLI remain declared engineering fixtures. This does not establish live-provider competence, physical isolation, independently administered review, human usability, actual billing or funded readiness. [Practical qualification guide](../successor/docs/PRACTICAL_QUALIFICATION.md).

## Public artifact verification

All four assets were downloaded from the published release and checked against the GitHub asset sizes and SHA-256 digests. The checksum file covers exactly the installer, evidence ZIP and manifest.

| Public asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `AGI_Fleet_Linux_v1.1.2.zip` | 426,215,995 | `987a4f7bd56402e9cade8f5338570e0f803a787a83a64b1bcf17a7eceef9875d` |
| `Linux-Qualification-Evidence-v1.1.2.zip` | 6,890,684 | `b766a23b2fba3798fb522af3569ad18be7c086d8c7711ad9588d70d28dbf99a7` |
| `Release-Manifest-v1.1.2.json` | 111,081 | `67494f2d102216036a292125fa89074af33485ee559bd823acd4b3944d7b0eb9` |
| `SHA256SUMS-v1.1.2.txt` | 294 | `7eccdb8c52584904de73b174dc2f9fdc6c857b383e46b8a339aefb31a4c1ed6e` |

The downloaded installer passed all seven manifests and the complete source inventory. Evidence passed safe-member and CRC checks. Re-running the independent auditor against the downloaded bytes reproduced the published audit. The public release body matches the commit-pinned source notes and actual asset identities. All supplied assets and archive members remain below 450,000,000 bytes. [Machine-readable download receipt](linux-1.1.2-public-download.json).

## Separate Mac tooling verification

The [Mac regression campaign 38612794283](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38612794283), at integration commit `e6bce2e533344c237f4d69a73c11a51b9b22043f`, passed complete distribution build, Manager integration, native suites on macOS 15 and 26, and independent evidence audit. Publication was correctly skipped for this pull-request campaign. This verifies the repaired build path; the existing Mac 1.20.2 release retains its original archive and acceptance identity.

## Preserved scope and remaining gates

Linux 1.1.1 and earlier tags, archives, notes and validation records retain their identities. The separate Mac 1.20.2 release keeps its own evidence. Follow the [version-matched Linux guide](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.1.2-qualification/docs/FRESH_INSTALL.md) using fresh separate signer and compute accounts.

Physical installation, OS isolation, real OAuth/inference, actual costs, native application competence, independently administered review, observed EN/FR user outcomes, positive base AND browser cleanup, reboot persistence and 72-hour endurance remain **NOT_RUN**. Publication grants no signing, spending or paid-intake authority. The recorded activation decision remains **HOLD**.

[Published release screenshot](linux-1.1.2-release.png).
