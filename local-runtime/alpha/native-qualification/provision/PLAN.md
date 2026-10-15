# Fixed-path provisioning qualification plan (inactive)

This tranche is source preparation only. It contains a reviewed-command proposal
and an inactive privileged wrapper, neither executed nor connected to a workflow.
Production package-lock targets remain null. See README.md for the exact bounded
proposal, authority limits, source-only tests and remaining native gates.

## Preconditions

1. Exact saved candidate and native IPC evidence from the reviewed PR 47 source
   must pass on both native architectures. Verify remote run/attempt, source
   commit, artifact bytes, manifest, complete adapter closure and evidence hashes.
2. Independently review the production provisioner, admission and this harness.
3. Obtain approval for the final one-time source/hash-bound workflow, covering
   its exact privileged commands on both designated disposable runners without
   a per-runner pause. An existing /opt/agi-fleet-alpha path makes the experiment refuse;
   it must never overwrite, remove, chmod or chown an existing installation.

## Evidence bootstrap

Keep the source checkout and shipped null production lock unchanged. Create an
isolated test checkout whose only semantic difference is a test lock assembled
from the genuine successful candidate and IPC evidence. Bind both architecture
records to their own adapter hashes. Record original source, fixture lock bytes,
full diff and input evidence. Test records must explicitly state that the lock is
fixture authority; they cannot be published as production approval.

The fixture qualification envelope can attest only the two preceding facts:
artifactNative and adapterNative. It must not invent prior provisioning/admission
qualification. The new run establishes or rejects those facts independently.
After successful native tests and review, a separate source change may propose
real release pins bound to the accumulated evidence; this experiment cannot
approve or publish them.

## Planned privileged scope, pending exact commands and approval

On a fresh GitHub-hosted disposable Ubuntu runner only:
- Verify that /opt/agi-fleet-alpha is absent and /opt is root-owned, non-writable
  by group/others and not a symlink.
- Create /opt/agi-fleet-alpha and its two architecture parents with root owner
  and mode0755. Do not use recursive chown/chmod or modify existing paths.
- Invoke the exact hash-verified Node runtime on the reviewed provision.mjs with
  exact local archive, manifest, qualification paths and --confirm.
- No credentials, user-machine installation, provider access, wallet, production
  service registration, boot persistence, AppArmor/security-setting changes or
  post-test path deletion. Dispose of the entire hosted runner normally.

The runtime tests themselves run non-root. They use unmodified LinuxSandbox,
readReviewedAlphaTarget, requireAlphaRuntime and LocalRuntime, rather than a
synthetic backend. Candidate trees are not mounted through caller-selected paths.

## Required actual-path tests

- Provision only the native architecture and verify root ownership, exact tree,
  mode/link checks, fixed path, null initial actor authority and runtime identity.
- Doctor, explicit actor activation, bounded admission preview, separately
  confirmed one-use grant, fixed validation/work execution, exact receipt hash.
- Four work kinds, actual full grant wall time, and output/input boundary refusals.
- Rejected role, forged host descriptor, wrong archive/manifest/qualification,
  and wrong adapter/source pins fail before launch.
- STOP and client/grant revocation preserve consumed authority and uncertain
  state; real namespace disappearance and no wallet/provider calls are observed.
- Runtime identity change invalidates activation and any prepared grant. Do not
  mutate installed trusted files; exercise this through a separate test checkout
  with different reviewed fixture lock bytes and fresh private runtime state.
- Record installation and native admission evidence separately from candidate
  transport proof; never mark productionQualified true from fixture authority.
