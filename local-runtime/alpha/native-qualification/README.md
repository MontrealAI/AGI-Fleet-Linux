# Candidate native IPC qualification

This is a separate read-only evidence lane. Production trust targets stay null.
It never installs into `/opt`, changes ownership, generates credentials, activates
a real actor or publishes a release. Its synthetic authority fixtures cannot pass
native admission or the reviewed-runtime reconciliation gate.

Before executing candidate bytes, the Python harness independently rebuilds the
artifact from the existing hash-pinned official assets and immutable Alpha source,
compares the complete manifest, and extracts and verifies the saved archive. The
Node driver then exercises the same fixed IPC transport against that user-owned,
read-only candidate tree. Each invocation records exact adapter and artifact
identities. The existing candidate isolation lane still runs separately first.

## Required native checks (31)

- Four deterministic work kinds through validator then work, exact fixture parity
- The same four through disposable supervisor grants and retained receipts;
  authority is explicitly `SYNTHETIC_ISOLATED_QUALIFICATION_ONLY`
- Eight fixed probes: read-only/network isolation, detached-child normal exit,
  cancellation, cancellation after launcher exit, timeout, launcher death, hard
  five-second CPU termination, and output overflow
- One supervisor STOP-to-native-transport probe with a detached descendant;
  consumed grant, uncertain run and STOP must survive
- Fourteen malformed-input refusals across the two fixed phases

Every OS probe requires an actual live private namespace observed by the external
Python harness, exact agreement with bwrap's separate status channel, lifetime EOF
and subsequent namespace disappearance. CPU evidence is sampled from identified
live private-namespace processes with PID/start-time reuse protection. Launcher
rusage is not used as payload CPU. Failed attempts retain bounded observations,
errors and hashes before assertions; no failed artifact is replaced by success.

## Full verification cost

The driver adds four full manifest/tree/adapter checks per sequence boundary,
rather than timing only subprocess work. Grant receipts record fixture verification
calls/milliseconds, whole fixture grant wall time and the shared-deadline observation.
This is a partial workload simulation, not conservative production-path timing:
synthetic admission omits additional native package inspections before dispatch
and at final supervisor revalidation, and omits the ordinary Linux sandbox probe.
Root ownership/provisioning and genuine native admission remain unqualified.
Only a subsequent actual fixed-path provisioning/admission journey can establish
production-path timing. Cold-cache and arbitrary-host performance are not proved;
a fixture deadline failure remains a failed qualification.

## Running

Use the existing pinned Fleet Node runtime and locked Fleet dependencies, plus
Python stdlib, readelf, dpkg-deb, trusted root-owned bwrap/prlimit, and a compatible
non-root Linux engineering host. Run:

```
python3 -B local-runtime/alpha/native-qualification/qualify.py \
  --candidate /candidate-directory --cache /verified-asset-cache \
  --alpha-repository /pinned-alpha-git-object-repository \
  --evidence /absent/native-ipc.json
```

The proposed `.github/workflows/alpha-native-ipc.yml` runs both x64 and ARM64 and
uploads only candidate bytes and truthful evidence. It reuses the established
candidate workflow's disposable-runner prerequisite steps (`apt-get` and the
existing host preparation helper); it adds no privileged installation commands.
Publishing or activating that workflow remains a separate review step.

A passing report proves candidate transport and synthetic-authority integration,
not production provisioning/admission. A future reviewed qualification record may
be created only after actual production-path evidence and review. Do not populate
the production lock from the report's status flags.
