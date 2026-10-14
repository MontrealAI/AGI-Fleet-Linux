# Linux 1.1.1 release validation addendum

Published as a qualification prerelease for controlled fresh installation. **Production qualification remains incomplete; physical qualification remains NOT_RUN.**

The [public release](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.1-qualification) is bound to commit `92d7768943e2f5363afd404d59e422c1a9d2d767` and [main workflow 38570352736](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38570352736). The workflow built one saved archive and exercised those same bytes on both architectures. The exact downloaded [published manifest](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.1.1-qualification/Release-Manifest-v1.1.1.json) is retained in `engineering/published-release.json`; the previous pointer is preserved byte-for-byte in `successor/history/published-release-v1.1.0.json`.

This maintenance release improves English/French guidance, coherent edition labels and source-bound release publication. Runtime logic, dependency versions and contract artifacts are unchanged. The [maintenance scope](../engineering/linux-1.1.1-maintenance-scope.json) records every changed Fleet source path and its before/after identity. PR #26's unfinished Local Skills development is excluded.

| Observed check | Ubuntu 24.04 x86-64 | Ubuntu 24.04 ARM64 |
| --- | --- | --- |
| Targeted native regressions | 25 files; 291 PASS | 25 files; 291 PASS |
| Complete native suite | 343 files; 3,908 PASS | 343 files; 3,908 PASS |
| Manager 1.16.1 regressions | 780 PASS | 780 PASS |
| Standalone integration scripts | Eight PASS | Eight PASS |
| Fresh-manager Agent/three-Node lifecycle | PASS | PASS |
| Production source/artifact comparison | 11 matching sources and artifacts | 11 matching sources and artifacts |

Both native scopes have zero failed, skipped, cancelled or TODO cases. The independent evidence audit checked 736 retained TAP logs and 38 integration logs against source, hashes, counts and workflow identity. The exact Manager source is `09d89fb22d52a8df194e8dd0a00beff9f7771d82`. The source inventory contains 5,914 files, SHA-256 `b02b319871824f7a641cd1f147839251f2a5e4035771745503280e9723586b58`. These are new 1.1.1 results; earlier-release observations are not relabelled.

## Saved-archive Builder journey

The saved-archive browser gate passed authenticated Agent dispatch, separately authorized Node review, checked capsule import, explicit version selection and fresh offline English/French restoration and reruns. Real Chromium effects and delivered bytes pass through Controller, Companion and ComputeWorker. The audit binds the journey and screenshots to this archive, source and workflow. Restored authority remains `none` and payment remains `unfunded`.

Provider transport and sandbox CLI are declared engineering fixtures. The browser result does not establish live-provider competence, physical sandbox isolation, independently administered review or funded marketplace readiness. The free local Builder missions still require no account, wallet or provider key.

## Public download verification

All four public assets were downloaded after publication and checked against their GitHub asset sizes and SHA-256 digests. The published checksum file covers the installer, evidence archive and manifest.

| Public asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `AGI_Fleet_Linux_v1.1.1.zip` | 424,135,971 | `edf8733e71be4188c3bcafa66f8d57ed2a2b66dcedaa8fe3c64d17e245a50147` |
| `Linux-Qualification-Evidence-v1.1.1.zip` | 6,155,334 | `80b1d9b8d562e8d8cb7c377203be100a1319cf270946bfd33b2434007698eaa3` |
| `Release-Manifest-v1.1.1.json` | 111,081 | `1f390bd712e178bbfadec779128e2f191555174c7343613b9c97ac0f347d6160` |
| `SHA256SUMS-v1.1.1.txt` | 294 | `29635ac1307513090849c08143a2f8008a1b08ebb344b29f0038d60b7e6568bf` |

The installer passed all seven edition manifests and the complete source inventory. The evidence ZIP passed CRC and safe-member checks; its audit equals the published manifest audit. Re-running the independent auditor against the downloaded evidence reproduced all 736 TAP-log and 38 integration-log results. The canonical public release body matches the commit-pinned release notes and actual asset identities. All supplied assets and archive members remain below 450,000,000 bytes. The [download verification receipt](linux-1.1.1-public-download.json) records the observed identities.

## Preserved history and remaining scope

Linux 1.1.0 and earlier release tags, assets, notes and validation records remain unchanged. The separate Mac 1.20.2 release retains its own evidence. Follow the [version-matched fresh-install guide](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.1.1-qualification/docs/FRESH_INSTALL.md) on a dedicated host with separate nonadministrator signer and compute accounts.

Physical installation, rootless Docker/cgroup enforcement, real OAuth/inference and costs, native application competence, independently administered review, human accessibility/usability, positive base AND browser cleanup, reboot persistence and 72-hour live endurance remain **NOT_RUN**. Publication grants no signing, spending or paid-intake authority. The historical activation decision remains **HOLD**.
