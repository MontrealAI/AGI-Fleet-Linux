# Lifecycle implementation checkpoint — 2026-10-14

This continues PR #26 against the actual merged SUCCESSOR bridge at `e120d55fb0b0d1f97691c59c5923ec400df14d14`. The original handoff, validation records, unfinished acceptance cases and draft restriction remain in force. It does not relabel the source preview as a qualified operator installer or publish a release.

Implemented additions:

- A hash-verified, unprivileged software installer with private snapshot extraction, staged validation, exact pinned Node, atomic version selection, software-only rollback and owned-resource removal. State lives outside versioned code; active/uncertain obligations and pending grants block maintenance. Unexpected files and changed manifests/modes block removal.
- Atomic initial state creation and operator-only dead-service recovery. Recovery refuses a live or unverified socket, persists STOP, revokes unused grants and invalidates actor bindings.
- Explicit uncertain-run reconciliation, restricted to the offline sandbox with recorded closure or observed reboot. It retains the unsuccessful outcome, consumed grant and budget reservation. Provider, signer and unknown-backend attempts cannot use this procedure. Resume and fresh activation remain separate.
- English/French recovery controls and installation/recovery guidance.
- Saved-package CI that must install the actual package, initialize and start its private service, execute a scoped authorized report in the real sandbox, reopen outputs, and uninstall while retaining state and outputs. Native cancellation must produce actual closure evidence. No missing environment prerequisite is skipped.

Locally observed at this checkpoint:

| Evidence class | Observation |
|---|---|
| Installer fault/security fixtures | 8/8 pass using verified Node 24.21.0 on Linux x64. Includes traversal/collision/hash negatives, failed pointer-write recovery, state-preserving rollback/uninstall, live-lock refusal and unowned-resource preservation. The small package fixture is explicitly not the full runtime. |
| Supervisor modules with a synthetic OS boundary | 28/28 pass across authority, roles, portability, SUCCESSOR and reconciliation. No OS-isolation claim follows from these tests. |
| Skills format | Six packages validate; this does not establish assistant execution. |
| Real Unix socket in this workspace | `listen EPERM`; the new live-service recovery test cannot pass here. Required CI cases remain enabled. |
| New installed-package/native/browser gates | Pending the exact-head workflow; no success is recorded in advance. |
| Physical, provider, independent-operation and human usability | NOT_RUN. |

The prior native repair at `adf95e4b5f1bb27684e00b87391717a89261d4e0` passed the bounded Linux x64/ARM64 source and archive cases in workflow `38469328128`. Earlier failures in `validation.json` and `acceptance.json` remain historical; they do not qualify this changed implementation. Current full-handoff completion remains false.

Outstanding implementation at that checkpoint included the positive pinned-assistant adapter, full ComputeWorker/browser/desktop and Mac local paths, unrelated independent-review placement, protocol/signer integration, authoritative cross-host fencing and complete resource/lifecycle qualification. The presence of installer source does not imply these paths exist. Power-loss interrupted staging may leave an unselected directory for explicit operator inspection; it is never broadly deleted.

## Observed checkpoint and assistant continuation

The exact checkpoint `db19a6a6cab86e5c883e194d091a1da92d12701f` passed [Local Skills workflow 38490542629](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38490542629). On both Linux x64 and ARM64: 33/33 supervisor cases on source and extracted archive, 8/8 installer cases, 3/3 native cases on source and archive, and the actual installed-package journey passed. The browser gate also passed. The exact package was 8,185,644 bytes, SHA-256 `3bd2bb5032f63a9350c12901bd6b4f59e85cb73804550ca0ac8c7d6283dcf93f`, with 2,830 inventoried files. Installation started its actual private service, ran a scoped authorized report in the real sandbox, reopened all three output files, and preserved the ledger, credential and outputs after removal. The x64 workflow artifact was downloaded separately: its outer ZIP digest `cf8bf4d0b60b0a22f205f6c99ac7df375a8c9d235fdb5c4bd8356f9e73e9ed3e`, inner package digest, CRCs and all 2,830 member hashes were verified. The package records CI integration source `1aaff2ab643e9e4ec98e20760cd485933ecd1fda`. Final-head qualification remains separate.

The next change adds the [pinned OpenClaw client](OPENCLAW_CLIENT.md), fresh profile provisioning and an EN/FR dashboard approval queue. The actual pinned Gateway has locally loaded the Agent skill, offered exactly `fleet_local`, prepared a real supervisor request, waited for separate operator authorization, and executed it in four **synthetic model transport** calls. The local worker boundary was explicitly synthetic because this workspace denies native isolation; the new CI gate must exercise the saved package with the actual sandbox and rejects synthetic-worker evidence.

The assistant client refuses operator credentials, role/actor substitution, arbitrary endpoints, extra request fields and privileged operations. Local HTTP negative tests pass. The installer now atomically reserves the control socket path during maintenance to close the raw-CLI startup race; 10/10 installer cases pass locally, including live-fence refusal and explicit dead-maintenance recovery. The 31 module cases across authority, roles, portability, SUCCESSOR, reconciliation and client transport pass with their declared synthetic worker boundary. New exact-head native/browser/assistant qualification remains pending until its workflow finishes.

The full handoff is still incomplete. Live inference/privacy/spending commissioning, ComputeWorker/browser/desktop and Mac local execution, unrelated independent review, signer/protocol integration, authoritative cross-host fencing and physical/human/endurance gates retain their prior status. This addition must not be described as a completed product or made merge/release eligible by changing those labels.

The Linux worker now reports measured CPU, peak resident memory and kernel namespace identities in its execution observation. A new mandatory native case dispatches an Agent report and an unrelated internal Node check through different scoped clients, checks separate PID/network namespaces and denies cross-actor output access. Those changes await native observation; no independent-review claim is made.
