# Reproducing the native regression run

Use a fresh, disposable Ubuntu 24.04 engineering VM. The supplied workflow uses GitHub-hosted x86-64 and ARM64 VMs, with a read-only repository token and no operator secrets. Authorized root access is used only for isolated test provisioning and real foreign-ownership fixtures. Do not run this harness in an operator signer or compute account.

The workflow downloads the three frozen release assets and checks their exact sizes and SHA-256 digests. It validates all release manifests and source inventories while freshly extracting the saved archive. It installs hash-verified Node 24.21.0 and lockfile-pinned OpenClaw 2026.9.5; the frozen preflight verifies the OpenClaw inventory and historical fixture manifests. The real OpenClaw CLI version is also checked.

All 14 files containing the original 44 failures and six skips run first, followed by all 341 test files. No test-name filters, test modifications, mock substitutions or ownership exceptions are introduced. The targeted invocation has a deliberate exit code of 1 because the frozen runner never labels a partial suite PASS; the harness checks every targeted result, requires zero failures/skips/timeouts and records its scope separately. The full suite must independently return PASS and exit zero.

The initial provisioning attempt is preserved in `validation/attempts/37998288915.json`. GitHub's runner `/opt` was mode 0777. The executable trust guard correctly refused Node beneath it. The corrected harness uses a new private directory below `/root`, records the full ownership chain and leaves the guard and host-wide permissions unchanged.

Run `Frozen Linux 1.0.6 native validation` from the Actions tab to repeat the two-architecture run. Evidence is uploaded even when a job fails. Every run gets a separate artifact; never overwrite restricted-run evidence. The release ZIP remains frozen, and workflow changes do not change its release identity.

For an independent evidence audit, download the capable-run evidence and original release ZIP, then run:

```sh
python3 engineering/audit-native-evidence.py \
  --release AGI_Fleet_Linux_v1.0.6.zip \
  --case-audit validation/original-native-case-ledger.json \
  --run PATH_TO_X64_EVIDENCE \
  --run PATH_TO_ARM64_EVIDENCE \
  --out native-evidence-audit.json
```

The audit verifies retained TAP lengths and hashes, TAP totals, every tested source hash against the frozen ZIP, and each formerly failing/skipped test name in both targeted and full runs. A passing regression run is distinct from fresh physical desktop qualification; follow `docs/FRESH_INSTALL.md` for that remaining work.
