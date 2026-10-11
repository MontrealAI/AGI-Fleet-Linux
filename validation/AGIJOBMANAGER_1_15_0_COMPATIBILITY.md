# AGIJobManager 1.15.0 compatibility — 11 October 2026

**PASS on Linux x64 and ARM64.** The frozen Fleet **1.0.9** archive was checked against freshly compiled AGIJobManager **1.15.0**, commit `3958cbc3b01aa459de16cf39e1ab0985b5fa56c3`. This supplements the preserved 1.13.0 baseline and the separate [1.14.0 result](AGIJOBMANAGER_1_14_0_COMPATIBILITY.md). It does not replace the release qualification for Linux 1.0.10 or Mac 1.20.2, or qualify a physical computer, participant or funded mainnet operation.

[Workflow run 38158279692](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38158279692) ran from PR head `1b00cde66e9cf34591c7bcbf129b8573cf14aab1`, using merge revision `532be263ac1fc664c70aeafc55dbc855052ab318`. The [retained record](AGIJobManager-1.15.0-compatibility-2026-10-11.json) preserves both complete summaries, exact archive identities, lockfile hashes and limitations.

| Verified result | x64 | ARM64 |
| --- | --- | --- |
| Production Solidity sources matched | 11 | 11 |
| Exact compiled artifacts matched | 11 | 11 |
| Standalone Fleet EVM scripts passed | 8 | 8 |
| Fresh manager / Agent / three-Node lifecycle | PASS | PASS |
| Manager cases collected / executed / passed | 780 / 780 / 780 | 780 / 780 / 780 |
| Retained logs checked against their SHA-256 | 19 | 19 |

Compilation passed its zero-warning/error gate. ABI, creation/runtime bytecode, links and immutable byte offsets matched. The lifecycle covered persisted approvals, votes and finalization, failed payouts and deferred claims, restart recovery, exact mock-USDC conservation and no duplicate transactions. The 780-case result belongs to this manager commit; the historical 1.13.0 and 1.14.0 records remain 777 and 779 cases respectively. The new maximum-length URI regression verifies escrow recovery while exposing partial ENS mirroring failure despite a successful outer hook. Inspect actual resolver records and rehearse the intended input profile as described in the [mainnet guide](../docs/MAINNET_DEPLOYMENT.md#operate-the-existing-instance-with-manager-1150).

The complete original CI artifacts are preserved here so their evidence survives GitHub Actions retention:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| [x64 logs](AGIJobManager-1.15.0-compatibility-x64.zip) | 32,978 | `cc1dac078cb740d4c4ecd7aca5145abf8fb629d676535f4f4b68b2dcea163f13` |
| [ARM64 logs](AGIJobManager-1.15.0-compatibility-arm64.zip) | 32,962 | `179d67d1383b0404f706c65ef6733e46c19183d5ddca327e4a9d86dff7e03e3a` |
| [Combined record](AGIJobManager-1.15.0-compatibility-2026-10-11.json) | 31,906 | `f6d514d9db028ad20bf1814248c541613f67ec941ca1ee9f820f3a1e29bf047e` |

Each ZIP contains its summary, lifecycle report and all 19 original logs. Publication review checked both downloaded artifact hashes, every retained log hash, the 11 source hashes against the pinned manager checkout and the 11 artifact hashes against Fleet's frozen production artifacts.

From a repository checkout, recheck the preserved evidence without installing dependencies or connecting to RPC:

```sh
python3 validation/audit-manager-1.15.0.py
```

This authenticates the fixed record and archives, rechecks log coverage, hashes, provenance and recorded results, and preserves `productionQualified: false`. It does not recompile contracts or perform fresh execution. To reproduce execution, use the [integration guide](../docs/JOB_INTEGRATION.md) with `--manager-ref 3958cbc3b01aa459de16cf39e1ab0985b5fa56c3`.

All transactions used local chain `31337`, deterministic fixture wallets and mock USDC. Inference, public delivery, independently operated validators/RPC services, real-time endurance and physical installation were not qualified. The separate [mainnet deployment and readiness guide](../docs/MAINNET_DEPLOYMENT.md) records the dated public-chain observation and remaining activation requirements.
