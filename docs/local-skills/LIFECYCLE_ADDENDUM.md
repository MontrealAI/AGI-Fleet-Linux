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

Outstanding implementation includes the positive pinned-assistant adapter, full ComputeWorker/browser/desktop and Mac local paths, unrelated independent-review placement, protocol/signer integration, authoritative cross-host fencing and complete resource/lifecycle qualification. The presence of installer source does not imply these paths exist. Power-loss interrupted staging may leave an unselected directory for explicit operator inspection; it is never broadly deleted.
