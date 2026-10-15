# Alpha runtime provisioning, inactive by default

The shipped package lock remains `UNPROVISIONED`, with both targets null. No
manifest, task, environment variable, command-line pin or downloaded evidence can
activate execution. Current provisioning attempts stop before reading input paths
or writing an installation. Neither architecture is enabled by this source work.

## Required review before an installation can be selected

Fleet must review and ship an `agi-fleet/alpha-reviewed-target/v1` descriptor for
both supported architectures. Each descriptor binds the exact compressed archive,
manifest bytes, full tree, source commit, build inputs, execution-adapter source
identity and a separate qualification record. Historical candidate manifests keep
their original `NOT_RUN`/unqualified build observations; they are not rewritten to
claim that their later tests passed. The separate record must bind successful
native artifact and exact-adapter evidence. Qualification fields in a supplied
record have no authority without its digest in the Fleet-shipped lock.

`alphaAdapterIdentity()` covers the fixed loader, installer, IPC, supervisor,
contract, role policy and reused security logic. A changed covered file requires
new qualification. An installation's complete runtime identity additionally binds
the shipped lock and target. Source and host binding remain independent checks.

## Offline operator installation

After that review, a separately authorized operator must prepare root-owned,
non-group/other-writable `/opt/agi-fleet-alpha` and its `linux-x64`/`linux-arm64`
parent. The provisioner does not create those parents, request privileges, change
system security settings, fetch anything, install credentials or activate actors.

The fixed command is `node local-runtime/alpha/provision.mjs --archive FILE
--manifest FILE --qualification FILE --confirm`. These paths are offline input
files only, never a task API or executable selection. The destination is derived
solely from the shipped architecture/archive pin. An existing destination is not
overwritten. Failed staging directories remain unselected for operator inspection.

The installer checks exact archive bytes before decompression, rejects unsafe tar
nodes/paths, checks every manifest entry and extracts into a new same-filesystem
staging directory. Links cannot redirect writes. File/directory contents are
flushed before atomic publication. Directories are 0555, files 0444/0555 and links
are internal relative links. Runtime verification checks every byte, mode, link,
owner, hardlink count, extra and missing entry at the fixed root-owned location.
The trusted-root model excludes a malicious root administrator; it does not claim
to defend against privileged changes after a check.

Successful installation returns `PROVISIONED_INACTIVE`. Actor activation and new
one-use grants are still required. No old grant, wallet, provider or settlement
permission is restored. Manager USDC and Jobs v0 AGIALPHA remain separate.

## Evidence limits

The archive/manifest regression tests use explicitly synthetic authority fixtures.
Static checks against the known x64/ARM64 candidate archives test parser and full
tree parity only. They do not qualify execution. This executor cannot run the
required native sandbox; real architecture CI remains mandatory before activation.

## Fixed two-phase IPC and cleanup

Native dispatch uses only `/usr/bin/prlimit`, `/usr/bin/bwrap`, the verified rootfs
and its two reviewed launchers. Both phases receive separate copies of the exact
UTF-8 work-spec on stdin. No task value becomes argv, a mount, path or environment
variable. The validator must pass exact-byte and independent normalization checks
before work can start; the complete work result is checked again by the supervisor.

The phases share a 15-second monotonic deadline, with hard/soft CPU limits of five
seconds per fixed phase. The 4 GiB address-space ceiling matches the existing Linux
backend; it is distinct from the ordinary Node worker's 128 MiB JavaScript heap.
The validator and result stdout caps derive from the pre-admitted mission's
conservative output budget, with bounded stderr and private status channels.
CPU rlimits are per process; the pinned deterministic work implementation creates
no arbitrary task-controlled subprocesses. Native CPU and detached-child probes
remain required, and parent-process rusage is never reported as payload CPU usage.

The supervisor rechecks the consumed grant, principal, generation, package,
source, host, boot and runtime identity before each phase and before retaining a
receipt. STOP/revocation/cancellation aborts the active process group; any uncertain
result preserves the consumed grant and durable STOP.

The transport keeps bwrap's JSON status and lifetime channels separate from task
stdout. It requires new PID/network/mount/IPC/UTS namespace identities, exact exit
status, process-group disappearance and lifetime EOF. Upstream bubblewrap v0.9
closes the lifetime FD in the monitor and payload; only its private PID-1 init
holds it through `do_init`. The status FD is closed by the namespace child before
payload execution. The native qualification harness must also compare these
observations with actual namespace disappearance, including detached-child exit
and cancellation. Synthetic EOF tests alone cannot qualify cleanup.

Upstream reference: https://github.com/containers/bubblewrap/blob/v0.9.0/bubblewrap.c
(`monitor_child`, `do_init`, `namespace_ids_write` and the pre-exec FD closures).

Failed two-phase attempts retain completed and failed phase observations. Explicit
no-success reconciliation accepts Alpha closure only when the saved admission,
host and observation bind the same reviewed runtime identity and every recorded
native phase has private namespace status, lifetime EOF and confirmed cleanup.
Synthetic authority, missing phase evidence or a bare EOF cannot satisfy that
rule. Reconciliation retains STOP and the consumed grant; it cannot turn failure
into successful work or restore budget or execution authority.
