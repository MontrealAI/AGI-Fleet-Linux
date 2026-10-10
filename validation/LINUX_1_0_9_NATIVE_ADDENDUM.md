# Linux 1.0.9 — audited native acceptance

**Native acceptance: PASS on Ubuntu 24.04 x86-64 and ARM64. The gate is open for a controlled fresh physical installation. Production qualification remains incomplete.**

This addendum applies only to `AGI_Fleet_Linux_v1.0.9.zip`, 401,420,759 bytes, SHA-256 `5e17bac752ae8dfc8756fe8dc612ceb8820616723808232f3541d552addce102`. The frozen ZIP and its embedded pending reports have not been edited. This external addendum records the later native results.

## Recorded results

| Architecture | Targeted files / passes | Complete files / passes | Fail / skip / timeout |
| --- | ---: | ---: | ---: |
| x86-64 | 25 / 291 | 342 / 3,897 | 0 / 0 / 0 |
| ARM64 | 25 / 291 | 342 / 3,897 | 0 / 0 / 0 |

[Workflow run 38022168787](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38022168787) executed the exact published ZIP. Its harness commit is `30d337265e6ec459ed54d9572949a6d0d6980ff4`. Both complete-suite invocations exited zero with scope FULL and status PASS. The frozen runner deliberately returns one for a partial selection; all 291 targeted results were independently checked, rather than treating that partial exit status as full-suite acceptance.

The [independent audit](capable-38022168787-audit.json) reconciled all **734 retained TAP logs**: 25 targeted plus 342 complete logs per architecture. It verified log lengths and SHA-256 hashes, test totals, exact selections, inventoried source hashes, executable identity, and the 50 original failed/skipped case names in both scopes. The 44 original failures and six original skips pass on both architectures; their source files still match the original 1.0.6 case ledger byte-for-byte. There were no cancelled or TODO cases.

The native runs used hash-pinned Node 24.21.0 and inventory-verified OpenClaw 2026.9.5, real Unix-domain sockets, real foreign ownership, and the actual hosted plugin discovery cache. They used disposable engineering runners, no operator accounts, no signer wallet, and no operator OAuth store. Native acceptance does not prove physical rootless Docker, a desktop session, provider entitlement, or actual workstation output.

## Durable evidence

`Linux-Native-Evidence-v1.0.9.zip` on the [1.0.9 release](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.9-qualification) preserves the original two Actions artifacts, the audit program, case ledger, audited report, and this addendum. Exact bundle identity is recorded in [Linux-Native-Evidence-v1.0.9.json](Linux-Native-Evidence-v1.0.9.json). Release publication verifies existing assets and refuses to replace mismatching bytes.

| Original artifact | ID | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| x86-64 | 11659292213 | 1,073,642 | `365982a939335671ebefa657ae3073ce5fb4c89b8f7b84c83b107b86d192bd5f` |
| ARM64 | 11659562690 | 1,074,018 | `eb2f8a7f62719bfc168d27ac8c20c0c6fd73651f659a4114a7b0c0e856c1d698` |

To reproduce the audit after unpacking the evidence bundle into a new directory:

```sh
unzip artifacts/x64.zip -d x64
unzip artifacts/arm64.zip -d arm64
python3 audit-linux-1.0.9-evidence.py \
  --release /ABSOLUTE/PATH/AGI_Fleet_Linux_v1.0.9.zip \
  --case-audit case-ledger.json --run x64 --run arm64 --out repeated-audit.json
```

## Remaining physical gates

Fresh installation, rootless Docker/cgroup enforcement, real OAuth/inference, live documents, positive base AND browser cleanup, persisted identity after reboot, and 72-hour endurance are **NOT RUN**. Physical M1 and M2 remain separately NOT RUN. Keep the release marked prerelease and leave funded work disabled during physical qualification.

Use [FRESH_INSTALL](../docs/FRESH_INSTALL.md) and the [physical qualification ledger](../docs/PHYSICAL_QUALIFICATION.md). Historical 1.0.6, 1.0.7, and 1.0.8 failures remain preserved in their own addenda; this PASS does not change those earlier results.
