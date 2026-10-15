# PR 47 fixed-path workflow approval packet (inactive proposal)

Status: **NOT_AUTHORIZED_NOT_EXECUTED**. Source-only proposal for independent
review and later user action-time approval. No genuine preparation.json or approval.json exists
from this work. There is no installed workflow, dispatch, download, extraction,
privileged action or actual fixed-path pass in this source update.

## Immutable candidate references

Repository: `MontrealAI/AGI-Fleet-Linux`.

- PR: [47](https://github.com/MontrealAI/AGI-Fleet-Linux/pull/47)
- Reviewed runtime head: `2d5d62369d57db9abc9f622ccb4781e6cccd90d2`
- Reviewed head/tested integration tree: `7c52bc0cdd85b87f2219b46b6be6caeafa136b43`
- Tested integration commit: `847943561dcd6406824eb4d22a617bd52a18f381`
- Native workflow: `.github/workflows/alpha-native-ipc.yml`
- [Run 38716434461, attempt 1](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38716434461/attempts/1)
- x64 raw artifact `alpha-native-ipc-linux-x64`, ID `11969784543`, 59,946,774 bytes (`59946774`), SHA-256
  `76af4122a07217651573a45aa00694ccca66d38ff4f8600637bcfae8ab3f32bd`
- ARM64 raw artifact `alpha-native-ipc-linux-arm64`, ID `11968950893`, 53,807,545 bytes (`53807545`), SHA-256
  `3e7a1bfee0db3cfb15b364f71a8443db1c9c4a5eb63276e0ab66683f5b7055af`

The coordinator verified both raw API ZIP hashes/lengths and streamed the inner
candidate archive hashes without rootfs extraction. Its verification receipt hash
is `eb6aa0b2b13e4d663ace3844468c14609ae28e6ed97df865ad063be0693d5884`.
This source update rechecked that receipt and all six saved report hashes; their
reference metadata is in `reviewed-pr47-evidence.json`. Each architecture has 31
passed IPC cases and the candidate report has five probe attempts plus 28 cases.
Reproduction records the exact run/attempt and two identical builds. The frozen
Alpha source is `94f6faf461c90ff9f35db5cd7b461bde416ebea4`. Candidate-native
and IPC-native success establish only their stated evidence classes. Both reports
still refuse production provisioning/admission authority.

Before any execution, recheck current remote source/run/job metadata, raw ZIP
hashes and lengths, and complete inner candidate/reproduction/IPC reports. The
unchanged real validators must bind archive bytes/tree, manifests, dependency
closure, adapter and Node hashes. `prepare.py` rejects a changed source, merge,
run, attempt, artifact ID, digest or length; there is no fallback to PR 42/46,
another successful attempt, or repacked ZIPs.

### Concrete fixed installations from the verified inner archives

- x64 archive SHA-256:
  `bd87c72c175637407f96663f712ce55e0eda43f52e8732e833f59c10fa0721f9`
- x64 installation:
  `/opt/agi-fleet-alpha/linux-x64/bd87c72c175637407f96663f712ce55e0eda43f52e8732e833f59c10fa0721f9`
- ARM64 archive SHA-256:
  `1eab22d3f173befac1a28ec8f4a884ce68ec544a1883ea762e12a691fe9e7592`
- ARM64 installation:
  `/opt/agi-fleet-alpha/linux-arm64/1eab22d3f173befac1a28ec8f4a884ce68ec544a1883ea762e12a691fe9e7592`
- Adapter hash recorded separately in both architecture reports:
  `b694c494edb611d280bb098fc05266900689a5f654326d790a6abf6e2d361327`
- x64 Node executable:
  `7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c`
- ARM64 Node executable:
  `0f8949d1028f6d61506b2d5bc57e7e6fe893d7b1997509b7847294fc9c616584`

Archive tree, Alpha input and individual report hashes are retained in
`reviewed-pr47-evidence.json`; these are reference values, not an installation
or a fixture-lock preparation result.

Preserved prior proposals: original harness `6318400`, path-alignment repair
`9e3faa0`, PR 46 binding `263036283ca4a7be5c055e25d306a5e851fbb4c7`,
`expected-pr42.json` and `expected-pr46.json`. They are historical evidence only.

## Locked runtime input closure

`reviewed-pr47-evidence.json` also binds the following Git blobs read from the
exact reviewed tree `7c52bc0cdd85b87f2219b46b6be6caeafa136b43`: the Fleet dependency
lock, Node artifact lock, production provisioner and optional prerequisite helper.
The locally available commit has the same tree; it was used only to read these
metadata blobs. It is not an alternative accepted `--source` checkout. Actual
preparation still requires the PR 47 head or tested merge named above.

The coordinator's retained manifest metadata binds x64 archive length 58,797,220
bytes and manifest SHA-256
`d44408c660a7f09a6db5040c3581148a3864b6063112ede08c9d6b343a088357`;
ARM64 archive length 52,638,830 bytes and manifest SHA-256
`65360c48f72d5d3e1692310a15b3d78c75f9f6cb88ce6d7517b5ba15e2324bb2`.

Official Node 24.21.0 archives (download/installation not performed here):

- x64 URL: `https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz`
  SHA-256: `fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6`
- ARM64 URL: `https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.xz`
  SHA-256: `6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2`

## Final approval fields still required

- Final implementation workflow/harness commit, tree and exact action hashes,
  independently reviewed before publication or dispatch
- Confirm the exact Fleet/Node lock, provisioner and optional prerequisite helper
  hashes in `reviewed-pr47-evidence.json` in the final implementation review; no
  package scripts or dependency/source substitution
- The approval record for the final one-time workflow, covering both designated
  fresh hosted runners and its explicitly enumerated root commands

Runner-specific absolute paths, Python executable hash, preparation digest and
fixture-lock digest are derived by the reviewed workflow, verified before use,
and retained with its command packet. They are not caller inputs and cannot be
filled here with guessed paths or synthetic hashes. No new per-runner approval
pause is added after the one-time exact workflow receives action-time approval.
Any material source, workflow, destination or privilege change needs fresh approval.

## Fixed paths and command scope

Only fresh disposable GitHub-hosted `ubuntu-24.04`/X64 and
`ubuntu-24.04-arm`/ARM64 runners are in scope. `runner_paths.py` must validate the
canonical owned workspace/temp roots and exact workflow/source equality first.
The fixed derived paths are:

```text
HARNESS = GITHUB_WORKSPACE/local-runtime/alpha/native-qualification/provision
ROOT = RUNNER_TEMP/fleet-alpha-fixed-linux-x64  (or linux-arm64)
SOURCE = ROOT/source
DOWNLOADS = ROOT/downloads
TOOLS = ROOT/tools
PREPARATION = ROOT/preparation
EVIDENCE = ROOT/actual-evidence
PUBLIC_REPORT = EVIDENCE/fixed-path.json
```

The non-root preparer uses only `expected-pr47.json`, the clean exact runtime
checkout, the two fixed raw artifact ZIPs and the pinned native Node executable.
Its concrete generated `approval.json` must contain these root/non-root command
shapes, resolved to validated absolute paths with shell quoting:

```sh
sudo --preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,GITHUB_REPOSITORY \
  "$PINNED_PYTHON" -B "$HARNESS/privileged.py" \
  --preparation "$PREPARATION" --expected-sha256 "$PREPARATION_SHA256"

"$PINNED_PYTHON" -B "$HARNESS/run.py" \
  --preparation "$PREPARATION" --expected-sha256 "$PREPARATION_SHA256" \
  --evidence "$EVIDENCE"
```

Those strings are a proposal, never permission. The reviewed root wrapper:

1. Rechecks the manifest, all source/input/harness/interpreter bytes and fixed path.
2. Refuses any existing `/opt/agi-fleet-alpha`, including dangling symlinks.
3. Runs the unchanged pure validator before root writes, without candidate execution.
4. Creates only absent root-owned mode-0755 `/opt/agi-fleet-alpha`,
   `/opt/agi-fleet-alpha/linux-x64`, `/opt/agi-fleet-alpha/linux-arm64`.
5. Runs the exact Node executable on the unchanged reviewed
   `CHECKOUT/local-runtime/alpha/provision.mjs`, with exactly
   `--archive PREPARATION/inputs/NATIVE_TARGET/candidate.tar.gz`,
   `--manifest PREPARATION/inputs/NATIVE_TARGET/manifest.json`,
   `--qualification PREPARATION/inputs/NATIVE_TARGET/qualification.json --confirm`.
   The provisioner creates `.staging-*` only beneath the native parent and renames
   into `/opt/agi-fleet-alpha/NATIVE_TARGET/EXACT_ARCHIVE_SHA256`. The hash must come
   from verified inner artifact bytes; the raw GitHub ZIP hash is not that hash.

Candidate payload execution is non-root through unchanged real LinuxSandbox and
LocalRuntime. The fixture lock is isolated; production targets stay null.

## Existing security settings and disposal

The fixed-path root step changes **no existing security settings or permissions**.
No recursive chmod/chown, overwrite, `/opt` deletion, service, credential, funding,
provider call, wallet access or STOP/journal reset is permitted. Compatible trusted
root-owned bwrap/prlimit and namespace policy are prerequisites.

Package installation and the host-policy helper are **outside this fixed-path
command scope**. WORKFLOW_PROPOSAL.md separately discloses the candidate lane's
apt and `prepare-engineering-host.py` commands. If the final workflow includes
those, its approval must explicitly include the exact helper and package scope,
including loading the packaged capability-denying bwrap AppArmor policy and
retaining before/after policy/sysctl evidence. That helper cannot be described as
no security-policy change. It must not disable restrictions or change sysctls.
If prerequisite approval is absent or prerequisites are incompatible, stop.

Retain public report/command/hash and policy evidence at the approved paths,
including failed attempts. Do not upload private runtime databases, tokens, or
`drift.json`. Dispose only of the entire hosted runner through its normal lifecycle.
Do not delete installed paths or restore consumed grants, STOP or uncertain state.

## Evidence limits

Actual provisioning, admission, doctor/activation/grants, four-kind execution,
STOP/revocation and fixed-path timing remain **NOT_RUN** for this proposal.
Synthetic unit tests are parser/guard regressions, not native qualification.
Even a later successful experiment reports only `PASSED_FIXTURE_ONLY` with
`ISOLATED_TEST_LOCK_FROM_NATIVE_CANDIDATE_EVIDENCE; NEVER_PRODUCTION_APPROVAL`.
Independent review and a separate authorized source change remain required for
any production pin proposal. No production qualification is manufactured here.
