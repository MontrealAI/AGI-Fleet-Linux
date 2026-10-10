Linux 1.0.9 has **audited native PASS on Ubuntu 24.04 x86-64 and ARM64** and is ready for controlled fresh physical installation. It remains a prerelease while physical qualification is incomplete.

| Architecture | Targeted | Complete suite | Failures / skips / timeouts |
| --- | ---: | ---: | ---: |
| x86-64 | 291 / 291 | 3,897 / 3,897 | 0 / 0 / 0 |
| ARM64 | 291 / 291 | 3,897 / 3,897 | 0 / 0 / 0 |

An independent audit verified all 734 TAP logs and the exact frozen source. All original 44 failures and six skips are resolved on both architectures, without changing their test source. [Audited addendum](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/validation/LINUX_1_0_9_NATIVE_ADDENDUM.md) · [Native run](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38022168787).

**AGIJobManager integration also passed on both architectures:** eight standalone EVM scripts, a freshly compiled-manager lifecycle with Agent plus three Node clients, and 777 manager regressions per architecture. Every production source and all 11 contract artifacts match manager commit `191cf3590e5cdc08df1bb0af500ee28a91c8b010` (1.13.0). The new regression covers persistent approvals, votes, finalization and claims across restarts, failed token transfers, USDC conservation and zero remaining exposure. An independent audit verified all 38 logs. [Integration addendum](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/validation/LINUX_1_0_9_JOB_INTEGRATION_ADDENDUM.md) · [Integration run](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38052394030). Model/content/identity inputs are fixtures on a local chain; eight simulated days do not qualify live inference, native USDC, independently operated validators or endurance.

Download **AGI_Fleet_Linux_v1.0.9.zip** for installation. It contains Agent, Node, Moderator, Employer, Evidence and Recovery. Follow the [fresh installation guide](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/docs/FRESH_INSTALL.md); start with Agent on a dedicated clean host using separate new signer and compute accounts. Historical regression fixtures are engineering inputs and are not needed for installation.

- ZIP bytes: **401,420,759**; below 450 MB.
- ZIP SHA-256: `5e17bac752ae8dfc8756fe8dc612ceb8820616723808232f3541d552addce102`.
- Node **24.21.0**; OpenClaw **2026.9.5**; installer pins Docker **29.8.2**.
- `Linux-Native-Evidence-v1.0.9.zip` preserves the original native artifacts and independent audit for later reproduction.
- `SHA256SUMS-v1.0.9.txt` identifies both downloadable archives.
- `Linux-Job-Integration-Evidence-v1.0.9.zip` preserves both original integration artifacts and the independent audit (74,706 bytes; SHA-256 `059a085435ebf8d06789b74e754b25f028982dfebe72772982c6c236df5d7353`). `SHA256SUMS-job-integration-v1.0.9.txt` identifies the implementation and integration bundle.

The Fleet ZIP is unchanged. Its embedded pending reports predate native CI and are superseded only by the hash-bound external addendum. The 1.0.6 restricted results and failed 1.0.7/1.0.8 archives remain preserved.

**Physical fresh installation, rootless Docker, real OAuth/inference, live documents, positive base/browser cleanup, reboot identity persistence and 72-hour endurance: NOT RUN.** Record these with the [physical ledger](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/docs/PHYSICAL_QUALIFICATION.md). Native regression success does not qualify them or authorize funded work. Physical M1/M2: NOT RUN.
