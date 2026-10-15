# PR 47 merged-lifecycle proposal

Status: **SOURCE_ONLY; NOT_AUTHORIZED_NOT_EXECUTED**. This local change is separate
from published inert PR 48 and does not update its source or the inactive workflow's
existing harness pin. Actual fixed-path preparation, provisioning and admission
remain **NOT_RUN**. Production trust remains **UNPROVISIONED**.

## Why the lifecycle check needs a separate review

GitHub requires a manually dispatched workflow to exist on the default branch.
Registering a reviewed workflow therefore needs its own publication sequence; it
must not depend on dispatching in a narrow interval while release PR 47 stays open.
See [GitHub's manual workflow documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

The original open-PR gate rejected moved or abandoned source while exact candidate
evidence was being assembled. Simply dropping it would wrongly admit a closed,
unmerged proposal or silently substitute a later release. This change instead
separates PR lifecycle from immutable source/evidence identity. The later merge
record is extra provenance, not a new runtime source or a new qualification result.

GitHub's PR API changes the meaning of `merge_commit_sha` after merging. Normal
merges, squash merges and rebases have different semantics. Consequently, the PR
field or `merged: true` alone is insufficient. The proposed gate accepts only the
specific two-parent case below and refuses other strategies even if their files
look similar. See [GitHub's pull-request API](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request).

## Exact proposed acceptance conditions

All existing gates remain mandatory:

- Repository `MontrealAI/AGI-Fleet-Linux`, PR 47, same-repository frozen head
  `2d5d62369d57db9abc9f622ccb4781e6cccd90d2`.
- Head and tested commit `847943561dcd6406824eb4d22a617bd52a18f381`
  both resolve through the fixed GitHub Git API to tree
  `7c52bc0cdd85b87f2219b46b6be6caeafa136b43`.
- Exact native IPC run `38716434461`, attempt 1, successful exact workflow and
  both successful native architecture jobs. No rerun or alternative run fallback.
- Both frozen raw artifact IDs, digests and lengths, upstream report/source hashes,
  archive/manifest/adapter/Node identities, clean source, and all existing evidence,
  isolation and cleanup checks. `expected-pr47.json` and
  `reviewed-pr47-evidence.json` are unchanged.

An open PR must have `state: open` and the boolean `merged: false`.
The sole additional lifecycle case requires all of:

1. PR API reports `state: closed`, boolean `merged: true`, a UTC merge timestamp,
   and destination `main` in the reviewed repository. Missing/inconsistent flags
   fail closed.
2. Its real `merge_commit_sha` is a full lowercase Git object ID, distinct from
   the frozen head and synthetic tested-merge IDs.
3. The already pinned tested-merge Git object has exactly two valid parents in
   order `[tested base, frozen head]`, with a distinct base.
4. A separate fixed-repository Git API read of the real merge ID succeeds. Its
   returned object ID equals the requested ID, its tree equals the exact frozen
   tested tree, and its two ordered parent IDs equal those of the tested merge.
   Missing, malformed, wrong-tree, wrong-parent, squash, rebase, reordered,
   extra-parent and advanced-base merges are refused, without fallback.

The fixed HTTPS API reader uses normal certificate validation, rejects redirects,
and accepts neither a caller URL nor offline metadata at the CLI. This authenticates
the service read; it does not claim a GPG-verified commit signature, merge-actor
eligibility or approval. The Git API's commit object supplies the exact tree and
parent identities. Its `verification` signature status is a different assertion,
not an alternative authorization path. See [GitHub's Git commit API](https://docs.github.com/en/rest/git/commits#get-a-commit-object).

The actual later merge ID cannot be frozen before a merge exists. It is obtained
only from that current authoritative PR response and checked against the already
immutable tested tree and parent lineage. The complete PR and real Git object are
retained in `remote-provenance.json`, with lifecycle label
`MERGED_EXACT_TESTED_LINEAGE`; its bytes are covered by the preparation digest.
An open PR is labeled `OPEN_REVIEWED_HEAD` and has no real-merge object.

`prepare --source` still permits only the original frozen PR head or tested merge.
It rejects the real release merge even if all files match. No production policy,
runtime code, source pin, artifact pin, privileged command, fixed path or security
setting is changed. This deliberately conservative proposal does not guarantee
that every legitimate future merge will qualify. An advanced base or another merge
strategy requires a new review rather than relaxing this guard.

## Publication and approval sequence

1. Independently review this local source delta and its synthetic regressions.
2. If separately authorized, publish the reviewed inert harness source. Verify the
   returned exact remote commit/tree and complete harness bytes. Existing PR 48
   commit `6bbf81c68001bb8262f4df9e300d27b5ab8e5993` remains unchanged by this
   local proposal.
3. Separately repin the inactive workflow's harness commit/tree to that actual
   published source, update its implementation hashes, and review that narrow
   identity delta. The workflow currently retains the preceding open-only harness;
   copying or dispatching it does not implicitly select this local change.
4. Obtain authorization for the exact live workflow registration and its final
   published identity. Follow the reviewed default-branch registration sequence;
   do not race release PR 47 or use a moving default-branch runtime checkout.
5. After final source/artifact readback, obtain action-time user approval for the
   exact one-time two-runner workflow, including named apt packages, the disclosed
   AppArmor helper, root command, private fixture, retained evidence and whole-runner
   disposal. Registration or a merge flag does not supply that approval.

The unchanged `APPROVAL_PR47.md`, `WORKFLOW_PROPOSAL.md` and `workflow/README.md`
retain the fixed paths, command scope, source separation, evidence exclusions and
disposal guarantees. There is no new download, extraction, genuine preparation,
workflow publication/dispatch, privilege or trust activation in this proposal.

## Synthetic regression scope

Clearly labeled fixtures cover the exact merged lineage, open compatibility,
closed-unmerged/inconsistent metadata, missing merge time/ID, wrong destination,
changed head/tree/object, missing or invalid ordered parents, unavailable API
objects, HTTPS API endpoint/redirect restrictions, native/artifact failures after
merge, and refusal to use the real merge as the runtime checkout. Mocked transport
does not authenticate a fixture or claim a real merged PR 47 result.
