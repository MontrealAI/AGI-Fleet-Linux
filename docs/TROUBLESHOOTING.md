# Troubleshooting, stopping and lifecycle

Use this guide with the [fresh installation procedure](FRESH_INSTALL.md). Run Linux `.sh` entry points from the exact installed release. Historical Mac `.command` launchers, rollback scripts and migration fixtures are not the Linux operator path.

## First response to a failure

**Stop at the failed step and preserve the attempt.** Note the release ZIP hash, account/role, stage, timestamp and sanitized error code. Preserve profiles, Docker state, `compute-journal`, setup/cleanup reports, service files and any `COMPUTE_STOP`. Do not remove a STOP, change ownership guards or weaken AppArmor to obtain a passing result.

If installation completed, run the role's `Inspect.sh` from its compute desktop. For Agent in this release:

```bash
/opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.4/packages/AGI_Agent/Inspect.sh
```

Inspect reports filtered policy, host and authenticated health information. Its exit code alone is insufficient: inspect `policy`, `host`, `computeSTOP` and `health`. If no valid compute settings exist yet, Inspect may also fail. Retain the original installation's error and printed sanitized report path; do not create settings manually just to make Inspect work.

## Find your symptom

| Symptom or code | Meaning and next action |
| --- | --- |
| ZIP checksum differs; `Verify-Linux.sh` fails | Stop before installing. Preserve the failed download, download the exact release assets again into another directory, and verify them. Do not edit manifests or mix files from releases. |
| Existing extraction destination | Preserve it. Do not extract over it. Determine whether it is an approved installation or a partial attempt before choosing a new installation. |
| `EXISTING_CONTAINER_INSTALLATION_PRESERVED` / `EXISTING_DOCKER_REPOSITORY_PRESERVED` | The clean-host helper found existing container software or Docker apt configuration. It refuses to replace it. Use a separately prepared clean host; do not remove the environment simply to bypass this guard. |
| `ACCOUNT_ALREADY_EXISTS` / `HOME_ALREADY_EXISTS` | Preparation requires unused names and homes. Preserve the existing accounts. A partial preparation needs diagnosis before another attempt. |
| `PINNED_DOCKER_PACKAGE_UNAVAILABLE` | The required Docker 29.8.2 package is not available from the configured signed repository. Retain the error and report it. Do not install an arbitrary version or edit the version check. |
| `UBUNTU_24_04_REQUIRED` / `LINUX_ARCHITECTURE_REQUIRED` | Use Ubuntu Desktop 24.04 on x86-64 or ARM64. Changing a version check does not qualify another OS. |
| `STANDARD_ACCOUNT_REQUIRED` / `LINUX_STANDARD_ACCOUNT_REQUIRED` | A role must run as its own unprivileged account, not root or an administrator. Return to that account's desktop; never add it to the Docker group. |
| `DESKTOP_LOGIN_REQUIRED` / `LOGIN_HOME_REQUIRED` | Log in through Ubuntu's login screen. A switched-user shell does not supply the required login identity, D-Bus and private runtime directory. |
| `PRIVATE_PATH_REQUIRED` / `LINUX_PRIVATE_PATH_REQUIRED` / `CANONICAL_PATH_REQUIRED` | An ownership, permissions or path-identity check failed. Preserve the failing path and report the code; do not apply recursive permission or ownership changes to a profile. |
| `PRIVATE_SETUP_KIT_REQUIRED` / `SETUP_KIT_INVALID` / `SETUP_KIT_CHANGED` | Use the untouched export from the matching role's signer and the transfer helper. Preserve the original privately. Do not edit the JSON or share it for diagnosis. |
| Transfer refuses an existing destination | `AGI-Setup` is created once; the helper does not overwrite an earlier handoff. Diagnose that attempt before producing a new one. |
| `ROOTLESS_DOCKER_REQUIRED` / `CGROUP_LIMITS_REQUIRED` / `ROOT_DOCKER_ACCESS_FORBIDDEN` | Rootless mode, private socket or resource enforcement did not meet policy. Keep the root daemon inaccessible and preserve the failed checks; do not substitute root Docker. |
| `NODE_ARCHIVE_INTEGRITY` / `NODE_RUNTIME_CHANGED` | Downloaded or installed Node does not match its pinned identity. Do not substitute a system Node or modify the receipt. Preserve the attempt for diagnosis. |
| OAuth or provider error | Complete the role's own prompts in compute. Record the stage and sanitized code. No paid-provider fallback is implied. Do not copy OAuth stores between accounts or post them in a report. |
| `health: null`, a failed policy/host field, or `policyCurrent: false` | Readiness is not established. Use the setup report and error code to diagnose; a listening port alone is not approval. |
| `COMPUTE_STOP_REQUIRES_RECONCILIATION` or `computeSTOP: true` | Work is blocked. Preserve the STOP and its triggering evidence. `Start-Approved.sh` cannot clear it; there is no automatic cleanup reconciliation in this candidate. |
| `COMPUTE_SANDBOX_CLEANUP_FAILED` / `SETUP_SERVICE_STOP_UNCONFIRMED` | Cleanup or shutdown could not be positively proved. Preserve the bounded cleanup/stop report and Docker state. Do not force-remove containers or pretend the absence of an error proves cleanup. |
| `LINUX_DOCUMENT_CHECK_FAILED` / `LINUX_DOCUMENT_OWNERSHIP_FAILED` | Local qualification failed. Keep its printed report and generated files private. A local rerun does not authorize clearing STOP. |
| `LINUX_ARGUMENT_INVALID` / `LINUX_CYCLE_LIMIT` | Use the documented launcher and flags. Agent/Node qualification accepts an integer from 1 to 50 with `--cycles`; specialist roles have no local workstation qualification command. |

Preparation can make some changes before a later failure. A second invocation is not a rollback or a guaranteed retry. A corrected candidate may require new unused accounts on a clean host; keep the prior attempt intact until diagnosed.

## Stop intentionally

In the installed role's compute desktop, for example Agent:

```bash
/opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.4/packages/AGI_Agent/Stop-Compute.sh
```

The command first writes `OPERATOR_REQUESTED_STOP` if no STOP already exists. It then checks service termination, closed role ports and recognized socket absence. Only a passed stop report confirms those postconditions. A failure means shutdown remains unconfirmed; retain its evidence and escalate diagnosis.

This command does **not** delete the profile, wallet, OAuth, journals, Docker data or installed code. It does not serve as a routine pause. A stopped process and a stopped job are different observations, and existing STOP continues to block work after reboot.

`Start-Approved.sh` is only for approved, STOP-free services that are currently stopped. It asks for `START APPROVED`, rechecks host and policy, and starts services. Afterwards verify authenticated identity and health from the signer. It is not the inverse of the safety stop and cannot resume a failed cleanup.

## Update or replace a release

This qualification line has **no supported in-place upgrade or automatic profile migration**. In particular:

1. Preserve the current archive/checksum, immutable installation path and private profiles. Record any open on-chain obligations before retiring a signer.
2. Use the new release's own notes, native acceptance, checksums and install guide. Historical PASS results apply only to their recorded source and environment.
3. Install the new candidate separately on a clean target with new accounts. Never overlay its files onto an approved tree or point an approved service at newly edited code.
4. Requalify the new host/role and obtain its own authenticated runtime approval. Do not copy a wallet, OAuth store, bearer-token setup kit or old approval into compute.
5. Keep the prior installation inactive and preserved until replacement and any outstanding obligations have been reviewed.

Do not use the retained `update-signer.mjs`, Mac repair/rollback launchers or engineering materialization scripts as an operator Linux update mechanism. Their presence in the source archive is not qualification of that path.

## Decommission or uninstall

There is **no automatic Linux uninstaller** in this candidate. Decommissioning and deletion are separate decisions:

- Stop new signer work using the role UI. Review open obligations before disabling an account that may still need to sign settlement or recovery actions.
- Turn off any signer background-login option that you explicitly enabled. Stop compute with the role helper and retain its positive stop report.
- Preserve recovery material, encrypted wallet backups and local evidence in private storage controlled by the operator. Evidence-role profiles have no signing wallet.
- Ask the administrator to review the dedicated account pair and its lingering/services before retiring it. Docker packages, the signed apt source and systemd delegation are host changes; they are not removed by stopping compute.
- Delete accounts, profiles, Docker data or release directories only after that review and a separate explicit decision to delete them. Do not use a general Docker prune, a recursive home deletion or a system-wide Docker removal as a troubleshooting step.

If stopping was unconfirmed or an earlier STOP is unresolved, keep the machine out of work and preserve it for diagnosis. Deleting the evidence is not a successful uninstall or recovery proof.

## Prepare a useful support report

Include this small, sanitized record:

```text
Release and exact ZIP SHA-256:
Ubuntu version / architecture:
RAM / available disk:
Role and failed step:
Observed timestamp and timezone:
Sanitized error code:
Inspect policy / host / computeSTOP / filtered health:
Sanitized setup, local qualification or cleanup report:
What happened immediately before the failure:
```

The installer prints `setup-diagnostics.json`'s path. Local qualification prints its report directory. Retain original evidence privately and review even sanitized output before sharing. Bounded cleanup evidence records command class, phase, target, exit/signal and timing; historical raw stderr is not necessarily available.

Never attach a setup JSON, seed/recovery phrase, private key, encrypted wallet, OAuth/token store, raw service journal, provider response, private user document or full home archive. Do not run broad recursive diagnostic searches that could print these secrets. A concise stage and error code is a useful first report.
