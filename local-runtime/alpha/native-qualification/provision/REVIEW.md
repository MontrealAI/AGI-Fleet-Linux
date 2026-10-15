# Implementation check record

Source-only check date: 2026-10-15 UTC. This record is the implementation author's
local result, not an eligible independent review or native qualification.

## Passed

- 33 new Python synthetic fixture/provenance/rejection/binding tests
- 45 existing focused Node Alpha, trust and IPC synthetic tests
- 45 existing Python candidate-builder tests
- 7 existing Python native-harness evidence-validator tests
- Node syntax checks for both added JavaScript files and Python AST parsing
- Repository source preservation (6,004 inventoried Fleet source files)
- SUCCESSOR preservation (5,051 original paths; no removed paths, mode changes,
  anchor removals or diagram removals)
- Whitespace/error check before commit

The repository inventory check was first attempted with ignored installed
`fleet/node_modules` present and correctly failed its strict source coverage
check. The locally copied dependency directory was temporarily moved out, the
source/preservation checks passed, and the same directory was restored. No
inventory was loosened or rewritten. Its package-lock SHA-256 matches this source
(`2b9d7fc41982f87dc44f4a230b69739741bf1591c8ddd0fa2b0493c844e573d0`).

The Node tests used the executor's Node v24.19.0. This is not the hash-pinned native
runtime and no native equivalence is claimed. Future real preparation must match
the exact per-architecture Node hash in the successful native evidence.

## Source identity

The baseline of this isolated branch is
`81c71b08f4d9e3e560b11d6b4493eef962e0fee2`.
The reviewed runtime source expectation is now explicitly frozen to PR 42 head
`275a86df3b0e8a9740d5a5e463944d07e515e4c1`, tree
`0470b481c9a921863a7ef9dbe4d3afab964cae23`.
Local commit `42fe876db9409d026f4a16613f905e3115816d25` has that exact tree;
its only change from the baseline is the native qualification README's timing
correction. The harness accepts only a clean exact current head or independently
verified tested-integration checkout for later execution, never this older base
as an implicit replacement.

## Not run / not established

- Genuine exact-run artifact preparation (requires both successful native jobs)
- Any sudo, `/opt` write, package installation or host-security modification
- Actual fixed-path provisioning, admission, grants or execution on either CPU
- Live namespace, STOP/revocation, cleanup or actual-path timing observations
- Full Local Skills/native test matrix, saved-distribution release gates
- Independent eligible reviewer approval, workflow/branch publication
- Production trust, production qualification, funding, provider or wallet work

The generated `approval.json` does not exist for genuine artifacts yet. Its
formatting is unit tested using synthetic values only. The README and
`expected-pr42.json` are the reviewable command/input proposal. A moved PR head,
unpassed run, changed artifact, altered dependency/source/harness/runtime or
preexisting fixed installation fails closed.


## Corrections after the original review (2026-10-15)

Original commit `6318400` is retained unchanged. Corrections are isolated on
`fix/alpha-provision-review`; this is not an independent rereview result.

- Replaced launcher-substring detection with exact fixed Python argv plus opened
  provisioned interpreter inode/hash and stable PID/start-time/namespace evidence.
  Host-side prlimit/bwrap wrappers are skipped; genuine host-namespace Python is
  rejected. Wrong executable, changed bytes, unrelated descendants and PID reuse
  have synthetic regressions.
- Added nonce/identity-bound cancellation and synchronous pre-action target
  verification. A pass requires matching retained RUN_CANCELLED phase evidence
  and non-success native termination, not merely an active map or thrown error.
  Ended-phase, late successful-phase, wrong receipt and identity races are tested.
- Resolved and rejected symlink/noncanonical destination ancestry before writes,
  including nested aliases and missing-child paths. Both source preparation and
  evidence qualification protect original source, fixture checkout and preparation.
- Added a pure fixed runner-path validator and WORKFLOW_PROPOSAL.md. One final
  exact-source/hash-bound workflow approval covers the two designated runners;
  obsolete per-runner approval-pause language is removed. No workflow is installed.

Current correction checks: 47 Python synthetic tests, 10 Node cancellation
synthetic tests, 45 existing focused Node tests, 45 candidate tests and 7 existing
native-harness unit tests pass. Python/Node syntax checks pass. Actual native payloads,
privileged commands, workflow publication/dispatch and production qualification
remain NOT_RUN. The old 275a86df pin stays historical and closed until corrected
Fleet/Alpha source plus fresh exact native evidence are reviewed and repinned.


## Path alignment after independent rereview

The original three blocker corrections passed independent rereview. Its remaining
path mismatch is now corrected: approval generation, runner execution and public
report retention all share `prepare.py:evidence_directory`, yielding
`ROOT/actual-evidence`. The packet explicitly records that evidence directory and
`fixed-path.json` report path. A new cross-component regression checks both native
architectures, quoted paths containing spaces, command parsing and the documented
retention path, without creating or executing a native run.

Updated source-only harness count: 48 Python tests plus 10 Node cancellation
tests. No source pin, workflow activation, privileged step or native claim changes.


## PR 47 source-only rebind (2026-10-15)

Prior PR 46 proposal commit `263036283ca4a7be5c055e25d306a5e851fbb4c7` and
both historical expectation files are preserved unchanged. The current inactive
proposal now pins PR 47 head `2d5d62369d57db9abc9f622ccb4781e6cccd90d2`,
tree `7c52bc0cdd85b87f2219b46b6be6caeafa136b43`, tested merge
`847943561dcd6406824eb4d22a617bd52a18f381`, run `38716434461`, attempt 1.
The guard requires all five fields exactly and additionally freezes both raw
artifact IDs, digests and lengths. Historical PR 42/46, alternative valid merge,
run/attempt, replaced/swapped artifact, wrong digest and wrong length regressions
fail closed. Pending/failed jobs, source drift and prior refusal coverage remain.

The coordinator downloaded and verified both raw ZIPs, streamed the inner archive
hashes and retained native reports. This change only read its saved receipt/report
JSONs and exact-tree Git metadata; it did not open/extract the ZIPs, perform genuine
preparation, or duplicate the large artifacts. Receipt SHA-256
`eb6aa0b2b13e4d663ace3844468c14609ae28e6ed97df865ad063be0693d5884`
and all six referenced report hashes were checked. `reviewed-pr47-evidence.json`
retains the input/manifest/archive/tree/adapter/Node/source-file identities and
fixed installation destinations. Those upstream reports establish candidate
isolation and IPC transport with synthetic grant authority only; production
provisioning and admission remain false/UNPROVISIONED.

`APPROVAL_PR47.md` is the inactive exact-input/path/command review packet.
`WORKFLOW_PROPOSAL.md` still describes a future implementation, not executable
workflow YAML. The fixed-path root scope changes no existing security settings;
the separately disclosed optional prerequisite helper can change loaded AppArmor
policy and requires its own explicit scope in final action-time approval. No
per-runner approval pause is added within an already approved one-time workflow.

Source regression results on this harness worktree: **161 tests passed**:
54 synthetic Python harness tests, 10 Node cancellation tests, 45 focused Node
runtime tests, 45 candidate-builder tests and 7 native-harness unit tests. Python
AST and Node syntax checks and `git diff --check` also pass. These are source
regressions on the isolated harness branch, not a rerun of PR 47 native qualification.
The test tables use real reference labels but wholly synthetic metadata and bytes.

No `.github/workflows`, production lock, production runtime, original PR 42/46
expectation or existing security setting was changed. Actual preparation,
provisioning, native fixed-path execution and timing remain NOT_RUN. Final
independent review and user action-time approval are still required; no remote
publication, dispatch or privileged action was performed.
