# Reproducing Linux 1.0.9 native validation

**This is the frozen 1.0.9 baseline, which passed on both architectures.** See the [audited native addendum](../validation/LINUX_1_0_9_NATIVE_ADDENDUM.md). For the current 1.1.1 build and publication process, use the [development guide](../docs/DEVELOPMENT.md). The commands below reproduce historical engineering qualification; operators use the [fresh-install guide](../docs/FRESH_INSTALL.md).

Use a fresh, disposable Ubuntu 24.04 engineering VM. The supplied workflow uses GitHub-hosted x86-64 and ARM64 VMs, with a read-only repository token and no operator secrets. Authorized root access is used only for isolated test provisioning and real foreign-ownership fixtures. Do not run this harness in an operator signer or compute account.

Run `Linux 1.0.9 saved-archive native validation` from the Actions tab. The workflow fetches its harness from the exact workflow commit. It downloads the frozen 1.0.9 release ZIP and the unchanged historical fixtures and restricted evidence from the 1.0.6 release, checking exact sizes and SHA-256 digests. It validates all seven release manifests and source inventories while freshly extracting the saved archive. It installs hash-verified Node 24.21.0 and lockfile-pinned OpenClaw 2026.9.5; the frozen preflight verifies the OpenClaw inventory and historical fixture manifests. The real OpenClaw CLI version is also checked.

The targeted selection contains all 14 unchanged files holding the original 44 failures and six skips, six runtime-materialization files, two Standard-readiness files, two historical fresh-readiness resume files and the new plugin-cache-policy file: 25 files and 291 tests. It is followed by the complete 342-file, 3,897-test suite. The harness does not patch the frozen candidate, apply test-name filters, replace native tests with mocks or introduce ownership exceptions. The targeted invocation deliberately exits 1 because the frozen runner never labels a partial suite PASS; the harness checks every targeted result, requires zero failures/skips/timeouts and records its scope separately. The full suite must independently return PASS and exit zero.

The initial provisioning attempt is preserved in `validation/attempts/37998288915.json`. GitHub's runner `/opt` was mode 0777. The executable trust guard correctly refused Node beneath it. The corrected harness uses a new private directory below `/root`, records the full ownership chain and leaves the guard and host-wide permissions unchanged.

The pinned SDK also searches system Node locations. In these disposable VMs only, the harness preserves and quarantines the ambient non-pinned `/usr/local/bin/node`, verifies the root-owned non-writable `/usr/bin` parent chain, and provisions the same hash-verified Node binary there. It does not weaken the application's executable guard or change unsafe parent permissions. This is engineering runner provisioning, not an operator installation step.

`AGI_REQUIRE_LIVE_PLUGIN_CATALOG=1` requires the real pinned Gateway to persist the hosted default discovery cache in each positive materialization case. Acceptance cannot pass by testing only an empty cache. This unsigned cache carries no plugin-install authority; policy, approvals, installed code and credentials remain independently sealed.

Evidence is uploaded even when a job fails. Every run gets a separate artifact; never overwrite restricted-run evidence. The release ZIP remains frozen, and workflow changes do not change its release identity. The original `Frozen Linux 1.0.6 native validation`, the separate 1.0.7 candidate workflow and this 1.0.9 workflow remain available for historical reproduction; they do not qualify changed 1.0.10 source.

For an independent evidence audit, download the capable-run evidence and original release ZIP, then run:

```sh
python3 engineering/audit-linux-1.0.9-evidence.py \
  --release AGI_Fleet_Linux_v1.0.9.zip \
  --case-audit validation/original-native-case-ledger.json \
  --run PATH_TO_X64_EVIDENCE \
  --run PATH_TO_ARM64_EVIDENCE \
  --out native-evidence-audit.json
```

The audit verifies all 734 retained TAP logs, their lengths and hashes, exact selections, TAP totals, every inventoried source hash against the frozen ZIP, positive hosted-cache assertions, and each formerly failing/skipped test name in both targeted and full runs. The original 50 case source files must still match the 1.0.6 ledger byte-for-byte. The audit requires both x64 and ARM64 evidence and rejects any failure, skip, cancellation, TODO or timeout.

For failed historical runs, use `audit-failed-frozen-evidence.py` with 1.0.6 `audit-linux-1.0.7-failed-evidence.py` with 1.0.7, or `audit-linux-1.0.8-failed-evidence.py` with 1.0.8. Those scripts verify the specific recorded failures and report NOT_PASS; a successful evidence-integrity check does not turn a failed release into a pass.

A passing native regression run is distinct from fresh physical desktop qualification. Follow `docs/FRESH_INSTALL.md` for actual rootless Docker/systemd setup, OAuth, inference, documents, both sandbox cleanup postconditions, reboot identity persistence and endurance. No operator signer/compute account or historical engineering fixture belongs in that fresh-install procedure.
