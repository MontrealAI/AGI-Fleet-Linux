Linux 1.0.9 has **audited native PASS on Ubuntu 24.04 x86-64 and ARM64** and is ready for controlled fresh physical installation. It remains a prerelease while physical qualification is incomplete.

| Architecture | Targeted | Complete suite | Failures / skips / timeouts |
| --- | ---: | ---: | ---: |
| x86-64 | 291 / 291 | 3,897 / 3,897 | 0 / 0 / 0 |
| ARM64 | 291 / 291 | 3,897 / 3,897 | 0 / 0 / 0 |

An independent audit verified all 734 TAP logs and the exact frozen source. All original 44 failures and six skips are resolved on both architectures, without changing their test source. [Audited addendum](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/validation/LINUX_1_0_9_NATIVE_ADDENDUM.md) · [Native run](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38022168787).

Download **AGI_Fleet_Linux_v1.0.9.zip** for installation. It contains Agent, Node, Moderator, Employer, Evidence and Recovery. Follow the [fresh installation guide](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/docs/FRESH_INSTALL.md); start with Agent on a dedicated clean host using separate new signer and compute accounts. Historical regression fixtures are engineering inputs and are not needed for installation.

- ZIP bytes: **401,420,759**; below 450 MB.
- ZIP SHA-256: `5e17bac752ae8dfc8756fe8dc612ceb8820616723808232f3541d552addce102`.
- Node **24.21.0**; OpenClaw **2026.9.5**; installer pins Docker **29.8.2**.
- `Linux-Native-Evidence-v1.0.9.zip` preserves the original native artifacts and independent audit for later reproduction.
- `SHA256SUMS-v1.0.9.txt` identifies both downloadable archives.

The Fleet ZIP is unchanged. Its embedded pending reports predate native CI and are superseded only by the hash-bound external addendum. The 1.0.6 restricted results and failed 1.0.7/1.0.8 archives remain preserved.

**Physical fresh installation, rootless Docker, real OAuth/inference, live documents, positive base/browser cleanup, reboot identity persistence and 72-hour endurance: NOT RUN.** Record these with the [physical ledger](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/docs/PHYSICAL_QUALIFICATION.md). Native regression success does not qualify them or authorize funded work. Physical M1/M2: NOT RUN.
