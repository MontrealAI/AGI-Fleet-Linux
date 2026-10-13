# Physical Linux qualification ledger

**This ledger begins with every physical gate `NOT_RUN`.** It records one exact release, host and role; neither native CI nor another machine's results can fill it in. Follow [fresh installation](FRESH_INSTALL.md) using distinct new signer and compute accounts. Check the [1.0.11 release notes](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.11-qualification) for native acceptance of the exact archive on your architecture before installing.

Copy [the blank JSON ledger](physical-qualification-template.json) into a private directory outside the application tree. Set `releaseSHA256` to the actual verified Fleet ZIP hash from the published checksum file; the template intentionally leaves it blank until verified. Record the host, role, versions, policy digest, timestamps and sanitized evidence references. Start a separate ledger for each host/role/release combination.

| Gate | Evidence needed before recording PASS | Initial status |
| --- | --- | --- |
| Release integrity | Exact ZIP hash; `Verify-Linux.sh` passes all seven inventories | NOT_RUN |
| Fresh setup | Distinct new nonadministrator accounts; setup transaction completes | NOT_RUN |
| Rootless runtime | Private compute socket; enforced memory, CPU, PID and cgroup v2 limits | NOT_RUN |
| Authentication | Each OAuth profile required by the role; successful real inference | NOT_RUN |
| Local document | Agent/Node `Qualify-Linux.sh` creates and rereads a DOCX in a real restricted container | NOT_RUN |
| Live work | Agent's synthetic document deliverables open correctly; Node independently checks/reviews real synthetic deliverables | NOT_RUN |
| Cleanup | Agent/Node positive base and browser postconditions after every live job; no unexplained containers or STOP | NOT_RUN |
| Reboot | Same authenticated identity and persisted approval; another live role workflow passes | NOT_RUN |
| Local repetition | Agent/Node 50 local cycles pass; no retained qualification containers | NOT_RUN |
| Endurance | 72 elapsed hours; observations at start, after reboot, at least every 12 hours and at end; live role workflows and applicable cleanup pass | NOT_RUN |
| Interruption | Suspend/restore and network interruption fail closed; retained diagnosis and reviewed recovery record before resuming | NOT_RUN |

## Record what happened

For each gate, use `NOT_RUN`, `PASS`, `FAIL` or `BLOCKED`, an observation timestamp and references to retained sanitized evidence. Record a failure immediately, including its stage and error code. A later attempt does not erase the earlier failed observation; retain it in the gate's notes or a separate referenced record. A started process, listening port, green local Docker test or successful installation is not a substitute for live tool evidence.

A useful observation includes the operation requested, its actual result, report path, timestamp and verified role/runtime identity. After each live job, retain positive cleanup evidence and current authenticated health. During endurance, also record memory/disk observations so stability can be assessed from actual measurements.

Do not delete STOP or alter approvals to obtain PASS. An interruption that leaves STOP blocks further work until the failure is diagnosed and recovery reviewed. See [troubleshooting](TROUBLESHOOTING.md). A completed 50-cycle local report does not establish 72 elapsed hours, provider inference, reboot persistence or cleanup of live OpenClaw jobs.

## Specialist roles

Moderator, Employer, Evidence and Recovery do not expose workstation tools or `Qualify-Linux.sh`. Preserve those boundaries:

- Record `NOT_APPLICABLE` with a written reason for local DOCX, local 50-cycle and base/browser workstation cleanup gates when the installed role registry confirms no workstation tools. This is a scope decision, not a PASS.
- Use the `liveDocuments` entry to record the actual synthetic **role workflow**, with its scope explicitly described in the notes. Verify the expected bounded action or read-only result without funding wallets or submitting live transactions.
- Reboot and endurance still require that role's authenticated health, live inference, identity persistence and applicable cleanup/resource observations.
- Evidence has no signing wallet. Record its read-only role and approval behavior; do not introduce a signing key to satisfy a generic signer instruction.

A specialist's ledger must be reviewed against its actual capabilities; it cannot stand in for Agent/Node tool qualification. Financial transactions, independently operated validators and public browsing remain separate qualification scopes.

## Keep the evidence private

Retain original setup, local qualification and cleanup reports locally. Share only reviewed, bounded sanitized observations. Do not include setup JSON, wallet/recovery material, bearer tokens, OAuth stores, raw service journals, provider responses or user documents.

The template deliberately retains `productionQualified: false`. Completing this physical ledger does not automatically enable production, funded work, public browsing or other roles; those require their own readiness and operator decisions. Preserve historical results under their original release identity.
