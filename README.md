# AGI Fleet Linux

Linux engineering and qualification workspace for AGI Fleet.

**Status: qualification candidate; not production-qualified.** The existing Linux 1.0.6 release remains frozen. Its restricted validation recorded 3,826 passing tests, 44 failures and six skips, with no timeouts.

## Current scope

**Runner capability: PASS on Ubuntu 24.04 x86-64 and ARM64.** [Run 37997464388](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/37997464388) verified all four native capabilities. The [retained JSON](validation/runner-capability-37997464388.json) records the exact workflow commit, architectures and checks. Release tests executed by this run: **zero**.

This repository initially contains a native runner capability workflow. It verifies real Unix-domain socket communication, crash-left sockets, hard links and disposable foreign ownership on fresh GitHub-hosted Ubuntu 24.04 x86-64 and ARM64 VMs. Each run retains a separate JSON evidence artifact. A green capability job establishes runner capability only; it does not mean any of the 44 failures or six skips has passed.

The Fleet implementation, release archives and historical fixtures are not yet published here. Public release of those previously privately distributed materials requires an explicit publication decision. No operator profile, wallet, OAuth material, setup JSON or user document belongs in this repository.

## Acceptance sequence

1. Confirm native runner capabilities.
2. Make the exact frozen release and engineering fixtures available through an approved distribution path; verify archive hashes, Node 24.21.0 and OpenClaw 2026.9.5.
3. Run all 14 files containing the outstanding 44 failures and six skips, then the complete suite. Preserve the original restricted results and each capable run separately.
4. Investigate remaining failures. Any release-code change requires a new version and saved-archive validation. An unchanged passing release gets a validation addendum bound to its existing hash.
5. Qualify fresh physical Linux installation, OAuth/inference, real document creation, positive base/browser cleanup, identity approval after reboot and endurance. M1 and M2 are separate qualification targets.

Ownership checks and fail-closed STOP semantics remain mandatory. Operator signer and compute accounts are never engineering fixtures.

## Frozen candidate

- File: `AGI_Fleet_Linux_v1.0.6.zip`
- Size: 402,016,636 bytes
- SHA-256: `c3faed24d51472a7a69dede9f9d015c433e5b5c7e09aab331b61a02e681340e1`
- Distribution limit: every supplied file stays below 450,000,000 bytes.
