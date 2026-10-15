# One-time exact-source native CI proposal (inactive)

This is a reviewable workflow design, not an installed workflow. Nothing under
`.github/workflows` is changed. Preparing this proposal is authorized; privileged
execution, publication and dispatch remain pending final exact-source review and
action-time approval. The current PR 47 proposal is identified in
`expected-pr47.json` and `APPROVAL_PR47.md`; earlier PR 42 and PR 46 pins remain
historical and are refused. A reported upstream native IPC pass does not authorize
fixed-path execution or let an earlier green result qualify new bytes.

## Approval boundary

Approve the one-time workflow as a whole only after all immutable source and
artifact identities below are available and reviewed. That approval covers its
fixed root commands on the two designated disposable GitHub-hosted runners.
There is no per-runner pause asking for another approval when an approved job
starts. Material changes to source, workflow, artifacts, privileges or destination
require a new proposal. The workflow is dispatched once at the exact approved
commit; publication/dispatch is a separate externally verified action, not a
boolean invented by this harness. A metadata hash is evidence, not permission.

## Final immutable inputs required before activation

`APPROVAL_PR47.md` binds the proposed PR 47 source, tested merge, native run and
attempt, and both raw artifact IDs/digests/lengths. Coordinator-verified inner
identities are retained in `reviewed-pr47-evidence.json`. The final implementation
must recheck those exact bytes and receive independent review and user action-time
approval before execution.

- Exact workflow/harness commit and complete reviewed source tree, with the
  original review commit `6318400` and subsequent correction commits retained
- Exact corrected Fleet runtime head, tested integration commit and tree, including
  the newly reviewed Alpha arithmetic and fixture closure
- One successful native candidate/IPC run and exact attempt for that same runtime
  source, both architecture jobs, both raw GitHub artifact ZIP IDs, SHA-256s and
  lengths, candidate/manifest/evidence hashes and separate adapter identities
- Existing Fleet Node archive URLs and SHA-256s from that exact source lock, and
  interpreter executable hashes matching the native reports
- Existing Fleet dependency lock, no package install scripts, and matching native
  adapter closure after installation
- Hashes of the complete corrected harness, root provisioner and any explicitly
  approved disposable-runner prerequisite helper

The public remote readback and unchanged archive/manifest/qualification validators
must all pass before root provisioning. Missing fields, moved heads, failed or
incomplete native evidence stop the invocation. No branch or caller-supplied pin
is a replacement for these identities.

## Runner-derived paths, no caller overrides

The fixed matrix is `ubuntu-24.04`/X64 and `ubuntu-24.04-arm`/ARM64. Repository token
permissions are only `contents: read` and, if artifact downloading requires it,
`actions: read`. There are no workflow-dispatch inputs for paths, commits, archive
URLs, pins, executable choices or install destinations. No release, package,
production service or repository write permission is needed.

`runner_paths.py:runner_paths` validates genuine-context indicators, native
architecture, exact source/workflow commit equality, canonical existing owned
non-group/other-writable `GITHUB_WORKSPACE` and `RUNNER_TEMP`, and disjoint roots.
It rejects symlink aliases, existing output roots and lexical containment escapes
before any write. Environment indicators are guards, not host attestation.

All subsequent paths are derived, then checked again by preparation/qualification:

```text
HARNESS = GITHUB_WORKSPACE/local-runtime/alpha/native-qualification/provision
ROOT = RUNNER_TEMP/fleet-alpha-fixed-linux-x64       (or linux-arm64)
SOURCE = ROOT/source
DOWNLOADS = ROOT/downloads
TOOLS = ROOT/tools
PREPARATION = ROOT/preparation
EVIDENCE = ROOT/actual-evidence
```

`prepare.py:evidence_directory` is the shared source for the runner path and
approval command. The command packet also records `evidenceDirectory` and
`reportPath`; retained public report collection must use these exact paths
(`EVIDENCE/fixed-path.json`), with the private-state exclusions below. A
cross-component regression checks both architectures and shell quoting.

The `/opt` destination is never derived from these variables. It remains exclusively
`/opt/agi-fleet-alpha/NATIVE_TARGET/EXACT_ARCHIVE_SHA256`, with both fixed native
architecture parents. All variable values in actual shell commands must be quoted;
paths and exact hashes are recorded in the preparation and command packet.

## Fixed ordered job steps

1. Fetch only the exact approved harness/workflow commit with read-only access.
   Verify its complete tree and executable modes before using its helpers. Require
   `GITHUB_SHA == GITHUB_WORKFLOW_SHA` and verify those identities against the
   externally approved dispatch. Do not accept a moving branch checkout.
2. Run source-only negative regressions and `runner_paths`. Establish a new absent
   root beneath the validated runner temp directory. No `/opt` write occurs.
3. Fetch only the approved runtime commit into `SOURCE`; require the approved tree
   and no dirty/untracked source. Retain and verify the original null lock.
4. Download the two raw artifact ZIPs from the exact approved native run and IDs.
   Retain their ZIP bytes. An extracted/repacked artifact is not the API-digested
   ZIP. Download the official locked Node archive, verify SHA-256 before unpacking
   into `TOOLS`, and install only the exact Fleet dependency lock without scripts.
5. Perform explicitly approved hosted-runner prerequisites, if included in the final
   packet. The known candidate lane uses these root commands:

```sh
sudo apt-get update
sudo apt-get install -y bubblewrap util-linux apparmor-profiles binutils
sudo --preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,GITHUB_REPOSITORY \
  python3 "$SOURCE/local-runtime/prepare-engineering-host.py"
```

   These commands are a separate disclosed scope from fixed-path installation.
   The helper hash is bound to the exact runtime source. It loads Ubuntu's packaged
   capability-denying bwrap profile and records before/after namespace sysctls;
   it must not disable restrictions. Package metadata and installed package/tool
   identities must be retained. If this scope is excluded from final approval,
   require compatible existing prerequisites and stop if they are absent.
6. As the non-root runner, call `prepare.py` with only the fixed derived paths and
   immutable expectation. Validate remote evidence, archive trees, source,
   dependency closure and Node identity. Save preparation hash and concrete command
   packet. No synthetic fixture path or override is available in the CLI.
7. Within the same already-approved workflow invocation, execute exactly:

```sh
sudo --preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,GITHUB_REPOSITORY \
  "$PINNED_PYTHON" -B "$HARNESS/privileged.py" \
  --preparation "$PREPARATION" --expected-sha256 "$PREPARATION_SHA256"
```

   `PINNED_PYTHON` and the preparation hash are validated output values from the
   approved source-bound preparation. The wrapper rechecks them and all inputs,
   refuses any existing `/opt/agi-fleet-alpha`, creates only its absent fixed
   parents, and runs unchanged pinned `provision.mjs`. It never runs candidate
   payload code as root. No existing permissions or security settings are changed
   by this fixed-path step. Staging failures are retained; no overwrite or cleanup.
8. Run `run.py` non-root with the same preparation and hash and derived `EVIDENCE`.
   Run unchanged production doctor, activation, admission, grants, execution,
   receipts, STOP/revocation and drift checks. Preserve every failed attempt.
9. Retain only reviewed evidence outputs, raw hashes and command/host-policy
   receipts through the already hash-pinned upload action. Do not upload private
   runtime databases, temporary client tokens, or `drift.json`. Any native failure
   is a failed job. Fixture authority can never become production qualification.
10. Let the disposable runner end normally. No `/opt` deletion, authority reset,
    reconciliation, service registration, credentials, funding or external task
    execution occurs. Both matrix results must be reviewed independently before
    any separate proposal to populate real production pins.

The final workflow implementation must be independently reviewed against this
scope, run source-only tests, and have its exact source/hash approval recorded
before publication or dispatch. This document does not claim those steps exist or
have passed. Current privileged and actual-native statuses remain `NOT_RUN`.
