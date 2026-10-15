# Inactive exact-source workflow implementation

**NOT_AUTHORIZED_NOT_EXECUTED.** This is the concrete implementation proposal
requested after review of harness commit `4ebd6f3938eb5ac5212fb3038b367a32b8d3edd7`.
All files remain outside `.github/workflows`; no workflow is installed, published
or dispatched. No real input download/extraction, package installation, root step,
fixture preparation, actor activation or native execution occurred in this work.
The existing `APPROVAL_PR47.md` and independent-review baseline remain unchanged.

## Source binding without a self-referential commit

Three independently identified checkouts are intentional:

1. **Workflow implementation:** the eventual published workflow commit, checked
   out at `GITHUB_WORKSPACE` by full `GITHUB_SHA`. It must equal
   `GITHUB_WORKFLOW_SHA` and the exact workflow source reference. The dispatcher
   must independently verify that commit/tree against the user's action-time
   approval before dispatch. The file in `.github/workflows/alpha-fixed-path.yml`
   must byte-match `alpha-fixed-path.workflow.yml`; the implementation manifest
   hashes this YAML, helper, tests and document. A clean exact checkout and its
   complete Git tree bind `implementation.json` itself. No file contains its own
   commit/hash. The helper does not invent approval from an environment boolean.
2. **Frozen reviewed harness:** published inert PR 48 commit
   `076360c836d55ebc25d175bf3119ec88f740c1da`, tree
   `573430501e15cd46461a6a77ff838890a0d7ae19`. Its complete provision subtree is byte-identical
   to independently reviewed `34e603c`, including the narrowly verified merged-PR
   lifecycle guard. Its ancestry preserves exact PR 47; runtime source is unchanged.
3. **Actual runtime source:** PR 47 head
   `2d5d62369d57db9abc9f622ccb4781e6cccd90d2`, tree
   `7c52bc0cdd85b87f2219b46b6be6caeafa136b43`. Its frozen expectation also requires
   tested merge `847943561dcd6406824eb4d22a617bd52a18f381`, successful native run
   `38716434461`, attempt 1, and both exact raw artifact IDs/hashes/lengths.

The harness checkout is never substituted for the exact PR 47 runtime. Only the
harness directory supplies preparation/observation code; production code and
independently installed dependencies come from the separate exact PR 47 checkout.
The inert harness source was published with approval as
[PR 48](https://github.com/MontrealAI/AGI-Fleet-Linux/pull/48). That publication
did not add a workflow or change runtime/trust. Publishing the final workflow still
requires approval. A local prototype commit is not an already approved published
workflow commit.

The final published commit/tree, unchanged implementation-file hashes and
`.github` byte copy must be reviewed before the one-time dispatch. A changed
source, action, helper, privilege or destination requires renewed approval.
There is no second per-runner pause inside that approved invocation. The job has
no dispatch inputs and rejects attempt 2 or later; no automatic retries occur.

## Fixed matrix, permissions and actions

- `ubuntu-24.04` / X64 / `linux-x64`
- `ubuntu-24.04-arm` / ARM64 / `linux-arm64`
- Repository token permissions: `contents: read`, `actions: read`
- Sole third-party action:
  `actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f`
  (the exact action already used by the reviewed PR 47 native workflow)
- Git fetches use the fixed public repository URL and full commit, with no saved
  checkout credential or GitHub token in the subprocess environment.

The ephemeral read-only workflow token is available only during raw API ZIP
fetching. It is sent only to the fixed repository's GitHub artifact API. A signed
HTTPS storage redirect receives no Authorization header. Neither token nor signed
URL is placed in command records, subprocess environments or public evidence.
No credential is created or configured for persistent access.

## Derived paths

`driver.paths` validates owned canonical workspace/temp roots, disjoint ancestry,
hosted environment, exact workflow equality, event, attempt and native matrix.
It rejects all symlink aliases, including missing-child and retained-output paths.
Before creating the experiment root, the fetched immutable harness's own
`runner_paths` independently confirms the six common derived paths.

```text
WORKFLOW_SOURCE = GITHUB_WORKSPACE
HARNESS_SOURCE = RUNNER_TEMP/fleet-alpha-fixed-harness-linux-x64  (or linux-arm64)
HARNESS = HARNESS_SOURCE/local-runtime/alpha/native-qualification/provision
ROOT = RUNNER_TEMP/fleet-alpha-fixed-linux-x64                  (or linux-arm64)
SOURCE = ROOT/source
DOWNLOADS = ROOT/downloads
TOOLS = ROOT/tools
PREPARATION = ROOT/preparation
EVIDENCE = ROOT/actual-evidence
PUBLIC_STAGE_METADATA = ROOT/public
PRIVATE_LOGS = ROOT/private
UPLOAD_SET = ROOT/retained
```

This concrete two-source layout supersedes only the preliminary design's
`HARNESS = GITHUB_WORKSPACE/...` assumption. The frozen harness's preparation and
`actual-evidence/fixed-path.json` command/retention binding remains unchanged.
No path, executable, source pin or archive choice is accepted as a dispatch input.

## Fixed stages and exact privilege scope

The source guards run first. Inputs are fetched only after exact remote PR/run/job
verification. Both original API ZIPs must match frozen IDs, SHA-256s and lengths.
The Node 24.21.0 archive is selected from the exact runtime's verified lock and
must match the native report's executable hash. Tar member checks precede
extraction. The exact Fleet lock is installed with `npm ci --ignore-scripts
--omit=dev --no-audit --no-fund`, without inherited npm configuration or credentials.
The 54 frozen Python harness and 10 cancellation regressions run before privilege.

This implementation **includes** the following separately enumerated prerequisite
scope, rather than assuming a prepared runner:

```sh
sudo apt-get update
sudo apt-get install -y bubblewrap util-linux apparmor-profiles binutils
sudo --preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,GITHUB_REPOSITORY \
  "$VERIFIED_HOST_PYTHON" -B "$SOURCE/local-runtime/prepare-engineering-host.py"
```

The helper SHA-256 is
`a0984ced7d3e04c49e65bb30f69386591e4603f7ff12409b58ed764a4734ccdf`.
Before each root command, the unchanged workflow Python hash, exact runtime source
and absence of `/opt/agi-fleet-alpha` are rechecked. The helper loads Ubuntu's
packaged capability-denying `bwrap-userns-restrict` profile using
`apparmor_parser -r`. **This changes loaded AppArmor policy.** It must not disable
restrictions; namespace sysctls must compare equal before/after. No sysctl write,
recursive chmod/chown, user/group change or service registration is requested.
The final user approval must include this prerequisite scope explicitly.

Apt packages are resolved from the hosted runner's configured Ubuntu repositories
at execution time; this is not a hash-pinned reproducible apt closure. Exact package
inventories before/after and host-policy hashes/unchanged sysctls are retained.
There is no `apt upgrade` command or fallback policy relaxation. If this package
resolution scope is unacceptable, revise and independently review the proposal
before approval; do not silently omit prerequisites or add an alternative installer.

The next stage runs the frozen non-root `prepare.py` with exact derived source,
Node, expectation and both ZIP paths. Its generated manifest/command packet are
rechecked by the frozen implementation. The root fixed-path command is exactly
that packet's shell-tokenized command, never evaluated with a shell:

```sh
sudo --preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,GITHUB_REPOSITORY \
  "$VERIFIED_HOST_PYTHON" -B "$HARNESS/privileged.py" \
  --preparation "$PREPARATION" --expected-sha256 "$PREPARATION_SHA256"
```

It creates only the absent fixed root parents and native installation described
in `APPROVAL_PR47.md`. This fixed-path step itself changes no existing security
setting. Both exact archive-derived installation paths are verified again before
execution. Existing installations, partial staging and failed attempts are never
overwritten, removed or retried. Candidate code never runs as root.

Finally the packet's non-root `run.py` command executes unchanged real runtime
checks at `EVIDENCE`. The shared sequence deadline and production policy are not
modified. Fixture success can only be `PASSED_FIXTURE_ONLY`; production targets
remain null and production admission/provisioning flags false.

## Always-attempted retention and whole-runner disposal

Collection has `if: always()`. It builds a new `ROOT/retained` directory from a
finite allowlist, never from recursive source/evidence globs:

- Invocation/source/input hashes, exact command/exit records and stage outcomes
- Package inventory before/after and host-policy/sysctl receipt
- Preparation manifest/hash, proposed commands, original null lock/diff and remote
  provenance
- `fixed-path.json`, eight numbered attempt reports and the two drift result reports

Private runtime databases, `state-*`, drift checkout/state, `drift.json`, tokens,
raw subprocess logs and arbitrary added files cannot enter that upload set.
Incomplete, private-field or linked report files are excluded with an explicit
retention reason; available failure/stage receipts remain. Raw subprocess output
stays private on the runner; public command records retain its hash and exit code.

Upload also uses `always()` but requires successful safe collection. A refused
collection path is never uploaded. Bootstrap failure before a usable checkout,
collection refusal, runner loss or forced cancellation can prevent an artifact;
ordinary GitHub job logs remain the diagnostic source when available. This is not
a guarantee against loss of a terminated runner. Failures are not changed to green
and no retry overwrites prior evidence. Evidence retention is 30 days.

There is no cleanup step. End the disposable hosted runner normally after its
retention attempt. Never delete `/opt/agi-fleet-alpha`, reconcile STOP, restore
consumed grants, erase uncertain journals, register a service, fund an actor or
call providers/wallets. Both native matrix results need independent review before
any separately authorized proposal for production trust.

## Source-only validation

Run `python3 -B -m unittest discover -s
local-runtime/alpha/native-qualification/provision/workflow -p 'test_*.py' -v`.
The 22 tests use synthetic contexts and transfer bytes, mocked subprocess/network
adapters, pure tar-member validation and temporary retention fixtures. No workflow
stage, extraction, actual download, sudo or native payload is executed.
YAML structure and embedded Python syntax are checked separately. These results
do not qualify GitHub expression execution or a native fixed-path run; those remain
NOT_RUN pending independent review, publication approval and user action-time
approval of the exact workflow invocation.
