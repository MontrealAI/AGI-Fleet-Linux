# Fixed-path Alpha qualification proposal (not activated)

This source-only harness is unpublished and has no workflow hook. It has not run
`sudo`, provisioned `/opt`, activated an actor, or qualified native admission.
The repository's production lock stays `UNPROVISIONED` with two null targets.
Unit tests use conspicuously synthetic reports and cannot authenticate or qualify
an artifact. This proposal requires independent review and approval of the exact
one-time source/hash-bound workflow before publication or privileged execution. The approval
covers its fixed steps on both designated runners without a per-runner pause.
See WORKFLOW_PROPOSAL.md for runner-derived paths, prerequisite scope and remaining
activation gates.

## Authority and exact source

Current source-only proposal: PR 47 head
`2d5d62369d57db9abc9f622ccb4781e6cccd90d2`, tree
`7c52bc0cdd85b87f2219b46b6be6caeafa136b43`. `expected-pr47.json`
binds tested integration commit `847943561dcd6406824eb4d22a617bd52a18f381`
and native run `38716434461`, attempt 1. The project coordinator reported both
native IPC jobs successful on 2026-10-15. That upstream result does not establish
fixed-path provisioning or admission. The coordinator separately verified both
raw ZIP hashes and inner reports;
`reviewed-pr47-evidence.json` records the hash-bound reference metadata. This
source-only update rechecked that receipt and its saved report hashes without
downloading, extracting or preparing any artifact. Final review and action-time
approval remain separate gates. `APPROVAL_PR47.md` records the proposed
immutable raw artifact references, fixed paths, command scope and missing inputs.
The gate now pins all five expectation fields and both raw artifact
IDs/digests/lengths,
not merely the head/tree. No privileged execution, workflow publication or
approval is implied by these pins.

The preceding PR 46 proposal remains preserved in commit
`263036283ca4a7be5c055e25d306a5e851fbb4c7` and unchanged
`expected-pr46.json`: head `8140f79aa89f738034d064f5cb6c598d49c5bffd`,
tree `07b0590c970410e5870784657f5f532460e084bb`, tested integration
`89d7c6e9528b223d12cc82dbb2f7b5d6d59e5765`, run `38706720582`,
attempt 1. Its run was pending when that proposal was recorded. Neither it nor
the PR 42 expectation below is accepted as an alternative source or run.

The retained historical head pin is
`275a86df3b0e8a9740d5a5e463944d07e515e4c1`, tree
`0470b481c9a921863a7ef9dbe4d3afab964cae23`. `expected-pr42.json`
proposes integration commit `4b7b30f3a3613d794ba5ac03fc93249c44ed49d5`,
run `38663788540`, attempt 1. That run was still pending when the original source
was prepared. PR 42 has since moved, and the upstream Alpha arithmetic/fixture closure is changing. These
values are historical expectations, not current qualification or success evidence.
A later repaired head fails closed until a reviewed source pin update.

This harness worktree begins at `81c71b08f4d9e3e560b11d6b4493eef962e0fee2`.
The locally available commit `42fe876db9409d026f4a16613f905e3115816d25`
has exactly that historical reviewed tree `0470b481c9a921863a7ef9dbe4d3afab964cae23`.
Comparing it to that baseline changes only
`local-runtime/alpha/native-qualification/README.md` (the timing correction),
which is already outside the adapter closure. This explains the source-only test
lineage; it does not allow using the older checkout for actual preparation.
Actual `--source` must be the exact explicitly verified current head or tested
integration commit; it is never implicitly this harness worktree.

`prepare.py` reads the current fixed PR 47 and the specified successful workflow run and
attempt from the fixed public GitHub API repository. It requires both native
architecture jobs, an open same-repository PR, the exact head, and an integration
commit whose tree equals that reviewed head. It rejects missing/ambiguous/expired
artifacts, unavailable ZIP digests, pending or failed attempts, partial inventories,
changed source hashes, dirty native evidence, incomplete tests and cleanup.
The workflow path is fixed to `.github/workflows/alpha-native-ipc.yml`; a PR 40
candidate pass alone does not qualify this adapter/provisioning experiment.

Both downloaded GitHub ZIPs must match the frozen IDs and SHA-256s, plus the
API byte count. A rerun, replacement artifact or repacked ZIP is refused. Each must
contain the archive, historical manifest, candidate isolation report, IPC report
and reproduction receipt. Their source, immutable run/attempt, architecture,
archive/tree/input, qualifier and per-architecture adapter identities must agree.
Candidate and IPC Node identities must agree. All input bytes are retained and
hashed. No caller URL, authentication token, branch pin or fallback is accepted.
The CLI offers no synthetic reader; metadata injection exists only as a Python
unit-test seam, with no native or production claims.

Preparation rejects symlink/noncanonical output ancestry and resolved aliases into
protected source/preparation trees before any write, including missing-child paths.
The qualification evidence path receives the same checks. Preparation then creates
an absent output outside a clean exact source checkout using
`git archive` and a separate dependency copy, never links or modifications to the
source. The only checkout difference is its private fixture package lock. Both
architecture records are mandatory and have their own adapter hashes. The local
architecture's complete adapter closure is measured using the unchanged reviewed
source. Both archive trees, manifests and qualification records are checked using
unchanged production parsers, without running any candidate payload.

The generated qualification envelopes assert only prior artifact-native and
adapter-native observations. They contain no invented provisioning or admission
pass. `preparation.json`, `approval.json` and later actual-path reports explicitly
label `ISOLATED_TEST_LOCK_FROM_NATIVE_CANDIDATE_EVIDENCE; NEVER_PRODUCTION_APPROVAL`.
They keep production admission/provisioning/qualification false and the original
production trust state unprovisioned. No production lock or release is published.
The real runtime has no fixture option, environment pin or caller-selected path.

The harness belongs under the already-excluded `alpha/native-qualification`
directory so its own evidence/packaging does not introduce a circular adapter pin.
The test checkout is the prior exact qualified source; the reviewed harness runs
from its separate directory. The original source lock and fixture diff are saved.

## Unprivileged preparation, after exact native CI passes

On each fresh, single-tenant GitHub-hosted native architecture runner, provide:

- A clean checkout at the approved PR 47 head or tested integration commit
- The same locked Fleet dependencies, installed without package scripts
- Both complete downloaded GitHub artifact ZIPs, not reconstructed ZIPs
- The exact Node executable whose SHA-256 is in that architecture's native report
- A JSON expectation with only `headCommit`, `testedCommit`, `sourceTree`, `runId`
  and `runAttempt`, exactly matching `expected-pr47.json`; caller-selected
  alternate runs, attempts or integration commits are refused
- An absent absolute output outside that checkout, and this separately reviewed
  harness at its final path

Preparation command template (substitute the actual absolute paths and target):

```sh
python3 -B /ABSOLUTE/HARNESS/prepare.py \
  --source /ABSOLUTE/CLEAN/REVIEWED/SOURCE \
  --output /ABSOLUTE/ABSENT/PREPARATION \
  --node /ABSOLUTE/PINNED/NODE \
  --expected /ABSOLUTE/VERIFIED/expected.json \
  --x64-artifact /ABSOLUTE/DOWNLOAD/alpha-native-ipc-linux-x64.zip \
  --arm64-artifact /ABSOLUTE/DOWNLOAD/alpha-native-ipc-linux-arm64.zip \
  --native-target linux-x64
```

For ARM64 use `linux-arm64` and that architecture's Node/dependency bytes.
Preparation uses only public metadata reads and unprivileged local writes. It
never installs packages, invokes sudo, runs a sandbox or enables a workflow.
It retains incomplete output on failure and refuses to reuse its directory.

## Exact privileged proposal, not permission

Successful preparation writes `approval.json` containing concrete shell-quoted
absolute commands and all input hashes. It is a proposal, never an authorization
flag or an executable workflow. Review the complete command and identities and
include them in the final exact-workflow review and obtain approval for the one-time
workflow before invoking anything. Approval of that fixed workflow covers both
designated runners; do not add a per-runner approval pause.
No runnable exact approval packet exists until genuine preparation succeeds.

The one proposed root invocation has this shape:

```sh
sudo --preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,GITHUB_REPOSITORY \
  /ABSOLUTE/HASHED/PYTHON -B /ABSOLUTE/HARNESS/privileged.py \
  --preparation /ABSOLUTE/PREPARATION \
  --expected-sha256 EXACT_SHA256_OF_PREPARATION_JSON
```

The actual command contains no unexpanded variables. Its approved manifest binds:
source snapshot files, directory modes and dependency links; fixture and original
locks; source diff and remote metadata; Python and Node executable bytes; every
harness file; both complete evidence/archive sets; source head, integration commit,
tree, remote run/attempt; and the exact fixed installation path. The wrapper checks
these again before any `/opt` write. Hashes identify the exact approved bytes, not
a claim of adversarial atomic snapshot isolation: the premise is a single-tenant
disposable runner without concurrent untrusted modification. Environment guards
are misuse checks, not cryptographic proof that a host is GitHub-hosted.

The root wrapper performs only this ordered scope:

1. Check root identity and disposable hosted-runner environment. Verify the exact
   preparation, reviewed source/dependencies, evidence, harness and interpreter.
2. Require `/` and `/opt` to be real root-owned directories, not group/other
   writable. Refuse if `/opt/agi-fleet-alpha` exists, including a dangling symlink.
3. Run the exact pinned Node on `validate.mjs` against the exact private checkout
   and input directory. It validates without launching candidate code.
4. Atomically create these previously absent directories, root-owned mode 0755:
   `/opt/agi-fleet-alpha`, `/opt/agi-fleet-alpha/linux-x64`,
   `/opt/agi-fleet-alpha/linux-arm64`. There is no recursive chmod/chown.
5. Invoke the unchanged reviewed provisioner using the exact pinned Node:

```text
PINNED_NODE CHECKOUT/local-runtime/alpha/provision.mjs
  --archive PREPARATION/inputs/NATIVE_TARGET/candidate.tar.gz
  --manifest PREPARATION/inputs/NATIVE_TARGET/manifest.json
  --qualification PREPARATION/inputs/NATIVE_TARGET/qualification.json --confirm
```

The provisioner itself creates only a new `.staging-*` beneath the native parent,
extracts the hash-pinned archive with modes 0444/0555 and internal relative links,
and atomically renames it to:
`/opt/agi-fleet-alpha/NATIVE_TARGET/EXACT_ARCHIVE_SHA256`.
It returns `PROVISIONED_INACTIVE`; actor authority is still absent.
The other architecture parent stays empty. A failed staging path stays unselected
and is retained for inspection. There is no retry/overwrite/delete fallback.

This root scope changes no existing security settings: no AppArmor, sysctl, user,
group, permission on existing files, package installation, credential, service,
boot persistence or network setting. It assumes trusted root-owned bwrap/prlimit
and already compatible namespace policy. A new runner may need the previously
used distribution-tool/AppArmor preparation; that is explicitly outside this
proposal. If unavailable, stop and present a separate exact privileged proposal.
Do not silently run `prepare-engineering-host.py` or disable any security control.

## Later actual-path run (also NOT_RUN)

After approved provisioning, `approval.json` gives the concrete non-root command:

```sh
/ABSOLUTE/HASHED/PYTHON -B /ABSOLUTE/HARNESS/run.py \
  --preparation /ABSOLUTE/PREPARATION \
  --expected-sha256 EXACT_SHA256_OF_PREPARATION_JSON \
  --evidence /ABSOLUTE/ABSENT/ACTUAL_EVIDENCE
```

`actual.mjs` imports unchanged production `LinuxSandbox`, `LocalRuntime`, trust,
provisioned-runtime and admission code from the fixture checkout. There is no
backend injection, transport monkeypatch, candidate path mount or policy change.
It requires the actual verified root-owned fixed installation and records:

- Doctor, initially inactive actor, refused missing confirmation, explicit actor
  activation, native admission preview, prepared one-use grant and separate
  confirmation, then actual validator/work and exact retained receipt for each
  of the four work kinds
- Replayed-grant refusal, role/input/output-budget refusals and forged-host refusal
- Wrong source/adapter pins and changed archive/manifest/qualification bytes
  against unchanged production validators, using memory-only invalid inputs;
  these negative cases do not claim a privileged install attempt
- STOP, grant revocation and client revocation during an independently observed
  live real phase, followed by consumed-grant, uncertain-run and durable STOP
  retention and actual namespace disappearance
- Runtime/source drift using a separate checkout with changed fixture-lock
  whitespace and fresh private scenario state, preserving the installed bytes;
  stale activation and prepared grant must be rejected

An external Python observer accepts only the exact fixed Python argv and verifies
the opened executable inode/hash against the provisioned interpreter, PID/start-time
identity and private namespace. It skips prlimit/bwrap wrappers even though their
arguments contain launcher names; actual host-namespace payloads are rejected.
It compares the resulting observations to bwrap status. Every successful work phase
must have been observed live and then gone. A phase too short to observe is a
failed/inconclusive observation, never assumed success. Cancellation requests
carry a driver-generated nonce and the observed payload identity. The driver verifies exact argv, interpreter inode/hash, descendant chain,
PID/start-time and namespace immediately before applying the real stop/revoke.
Success requires the same retained RUN_CANCELLED native phase and non-successful
termination. A missing/reused PID, phase already ended, unrelated error, mismatched
receipt, or successful phase followed by late cancellation cannot count as a pass.
Failures are saved before assertions; no retry replaces them with success.

Whole `runtime.run` wall time is recorded. Static review counts 17 full
package/tree/adapter checks plus eight sandbox probes for the actual successful
grant, versus 15 full checks in the prior synthetic grant path. Counts are labelled
static, not instrumented measurements. No claim is made that the synthetic path
is a conservative actual-path performance estimate. The real shared 15-second
sequence deadline remains unchanged; deadline failures stay failures.

A completed report can say only `PASSED_FIXTURE_ONLY`. It cannot enable production
trust or claim production admission/provisioning qualified. Review of genuine
results and a separately authorized source change would be needed for real pins.

## Disposal and evidence

Only disposable GitHub-hosted runners are in scope, never a user machine or shared
workstation. End the whole hosted runner through its normal lifecycle after
collecting approved evidence. Do not delete `/opt/agi-fleet-alpha`, change an
existing installation, reconcile STOP, restore consumed grants or erase uncertain
journals. Local test operator/client tokens exist only in private retained fixture
state, do not grant provider/wallet access, and must not be published with evidence.
Artifact upload and workflow publication are separate authorization decisions.
There are no provider calls, wallet calls, funding, payments or settlement actions.

## Source-only checks

```sh
python3 -B -m unittest discover \
  -s local-runtime/alpha/native-qualification/provision -p 'test_*.py' -v
python3 -B -m unittest discover \
  -s local-runtime/alpha/native-qualification -p 'test_*.py' -v
node --test local-runtime/alpha/native-qualification/provision/cancellation.test.mjs
node --test local-runtime/tests/alpha-trust.test.mjs
node --check local-runtime/alpha/native-qualification/provision/actual.mjs
node --check local-runtime/alpha/native-qualification/provision/validate.mjs
```

These checks exercise parser, provenance, authority, source and immutable-input
rejections, plus namespace-evidence and privileged fail-before-write guards.
They do not contact GitHub, install anything or execute a native Alpha payload.
Full unprivileged preparation against genuine passed PR 47 evidence, root
provisioning, native fixed-path execution, both architectures and independent
review all remain separate gates. Nothing in a synthetic test result closes them.
