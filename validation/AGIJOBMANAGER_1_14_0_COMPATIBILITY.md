# AGIJobManager 1.14.0 compatibility — 11 October 2026

**PASS on Linux x64 and ARM64.** The frozen Fleet **1.0.9** archive was checked against freshly compiled AGIJobManager **1.14.0**, commit `5f296a14727f3497128f3a49bd628c1f09a96221`. This supplements the preserved 1.13.0 baseline. It does not replace the release qualification for Linux 1.0.10 or Mac 1.20.2, or qualify a physical computer, participant or funded mainnet operation.

[Workflow run 38153067432](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38153067432) ran from PR head `a274ab2222b0ed1c99ec1ceed255564eb01ab1a3`, using merge revision `8d825dc57cbe72f192e5ce2262077a8abbd95974`. The [retained record](AGIJobManager-1.14.0-compatibility-2026-10-11.json) preserves both complete summaries, exact archive identities, lockfile hashes and limitations.

| Verified result | x64 | ARM64 |
| --- | --- | --- |
| Production Solidity sources matched | 11 | 11 |
| Exact compiled artifacts matched | 11 | 11 |
| Standalone Fleet EVM scripts passed | 8 | 8 |
| Fresh manager / Agent / three-Node lifecycle | PASS | PASS |
| Manager cases collected / executed / passed | 779 / 779 / 779 | 779 / 779 / 779 |
| Retained logs checked against their SHA-256 | 19 | 19 |

Compilation passed its zero-warning/error gate. ABI, creation/runtime bytecode, links and immutable byte offsets matched. The lifecycle covered persisted approvals, votes and finalization, failed payouts and deferred claims, restart recovery, exact mock-USDC conservation and no duplicate transactions. The 779-case result belongs to this manager commit; the historical 1.13.0 record remains 777 cases.

The complete original CI artifacts are preserved here so their evidence survives GitHub Actions retention:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| [x64 logs](AGIJobManager-1.14.0-compatibility-x64.zip) | 32,880 | `1c3d94587bfeaaa83db310cad003e91c2dbc5f87174432fd4358e8df445b5565` |
| [ARM64 logs](AGIJobManager-1.14.0-compatibility-arm64.zip) | 32,916 | `0b903e6236e1fee5b8747b9baa6019dfcdb9fbc9f3a532a15aa70f3a4612cb0c` |
| [Combined record](AGIJobManager-1.14.0-compatibility-2026-10-11.json) | 31,904 | `4dd604f2fc1fc7c386bbf2ca731d9a6e9c7bcc7806a4d48fd4d3f2b652df3560` |

Each ZIP contains its summary, lifecycle report and all 19 original logs. Publication review checked both downloaded artifact hashes, every retained log hash, the 11 source hashes against the pinned manager checkout and the 11 artifact hashes against Fleet's frozen production artifacts.

From a repository checkout, recheck the preserved evidence without installing dependencies or connecting to RPC:

```sh
python3 validation/audit-manager-1.14.0.py
```

This authenticates the fixed record and archives, rechecks log coverage, hashes, provenance and recorded results, and preserves `productionQualified: false`. It does not recompile contracts or perform fresh execution. To reproduce execution, use the [integration guide](../docs/JOB_INTEGRATION.md) with `--manager-ref 5f296a14727f3497128f3a49bd628c1f09a96221`.

All transactions used local chain `31337`, deterministic fixture wallets and mock USDC. Inference, public delivery, independently operated validators/RPC services, real-time endurance and physical installation were not qualified. The separate [mainnet deployment and readiness guide](../docs/MAINNET_DEPLOYMENT.md) records the dated public-chain observation and remaining activation requirements.
