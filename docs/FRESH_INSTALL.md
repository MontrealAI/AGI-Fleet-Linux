# Fresh Linux installation

**Start with Agent on a dedicated Ubuntu Desktop 24.04 LTS host.** This guide is for **Linux 1.1.1**, a qualification prerelease. Download the complete Fleet archive from the [1.1.1 release page](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.1-qualification), and check that its release notes report completed native acceptance for your architecture before installing. Historical 1.0.9 or 1.1.0 results do not qualify this new archive. If the 1.1.1 release or its exact acceptance evidence is absent, stop: this source guide is not permission to install an unpublished candidate. The prior 1.1.0 guide remains available at its frozen release tag.

A successful installation is the start of physical qualification. Real OAuth/inference, live documents, cleanup, reboot and 72-hour endurance require observations on your machine. Record them in the [physical ledger](PHYSICAL_QUALIFICATION.md). Installation does not enable funded jobs or establish production readiness.

## Before you begin

| Requirement | What to prepare |
| --- | --- |
| Host | Dedicated clean Ubuntu **Desktop 24.04 LTS**, x86-64 or ARM64; GNOME login, systemd and cgroup v2 |
| Resources | At least 8 GB RAM; 16 GB recommended. Reserve at least 40 GB free; compute admission requires 20 GiB available |
| Administrator | One existing administrator account to prepare the machine and transfer the setup kit |
| New accounts | Two unused names, such as `agisignerlinux1` and `agicomputelinux1`; the helper creates both |
| Internet | Access to Ubuntu/Docker packages, pinned Node/OpenClaw downloads, image builds and OAuth |
| Container software | No existing Docker/container packages or Docker apt sources; preparation preserves and refuses existing installations |
| Provider access | Access for the role's prompted OAuth logins; provider use remains subject to your subscription and approved budget |

Ubuntu 22.04/26.04, other distributions, WSL, containers, headless substitutes and Macs are outside this qualification target. A supported ARM64 architecture alone does not qualify a particular physical device.

**Keep old installations inactive and preserved.** Use fresh accounts and a clean host. Do not uninstall an existing Docker environment to force preparation to accept it. There is no migration prerequisite, and the release's engineering fixtures are not installation inputs.

The signer holds its encrypted wallet; compute never receives that wallet. Both accounts remain nonadministrators outside `sudo`, `docker`, `lxd`, `incus` and other privileged groups. Compute uses its own rootless Docker socket. All steps below use local desktop sessions, with the account for each step explicitly identified.

## 1. Download and verify — administrator

Download these two assets together from the [release page](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.1-qualification):

- `AGI_Fleet_Linux_v1.1.1.zip` — the complete application, including all six roles.
- `SHA256SUMS-v1.1.1.txt` — published checksums.

Use a new download directory. Do not select GitHub's automatically generated **Source code** ZIP or a native evidence archive for installation. Each supplied archive is below 450,000,000 bytes.

Open Terminal in the download directory and run:

```bash
sha256sum --check --ignore-missing SHA256SUMS-v1.1.1.txt
```

**Continue only when `AGI_Fleet_Linux_v1.1.1.zip: OK` appears and the command succeeds.** Missing evidence archives may be ignored; the Fleet ZIP may not. A checksum detects changed bytes; it is not independent publisher authentication.

Ubuntu needs `unzip` for the next step. If it is missing, the administrator can install it:

```bash
sudo apt-get update && sudo apt-get install --yes unzip
```

Extract into a new, stable directory. The following block stops at the first failed command; if the destination already exists, it does nothing. Preserve an existing destination and diagnose it before proceeding.

```bash
sudo test ! -e /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1 &&
sudo mkdir -p /opt/agi-fleet-linux &&
sudo unzip -n AGI_Fleet_Linux_v1.1.1.zip -d /opt/agi-fleet-linux &&
sudo chown -R root:root /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1 &&
sudo chmod -R go-w /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1 &&
/opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1/Verify-Linux.sh
```

**Expected:** `status: PASS` and `editions: 7`, covering the Fleet and six role manifests/inventories. Preserve the original ZIP and checksum outside the application tree. Do not move or edit installed code after approval; its location and bytes form part of the runtime identity.

## 2. Prepare new accounts — administrator

Use new, unused account names. These examples are used throughout this guide; replace both names consistently if you choose others.

```bash
sudo /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1/Prepare-Ubuntu.sh agisignerlinux1 agicomputelinux1
```

Review the proposed changes and type `PREPARE`. The helper verifies Docker's signing key, installs prerequisites and Docker Engine/CLI/rootless extras **29.8.2**, creates private `0700` homes, prompts for both account passwords, disables the newly installed root Docker service, and enables compute-only lingering with CPU/memory/PID delegation. It does not weaken AppArmor or grant access to the root Docker socket.

**Expected:** `Preparation complete.` A failure preserves the attempt. Do not rerun a partially completed preparation blindly: existing packages, accounts or homes intentionally cause a refusal. See [troubleshooting](TROUBLESHOOTING.md).

## 3. Create the setup kit — signer desktop

Use Ubuntu's login screen to log into **agisignerlinux1**. Open Terminal and run without `sudo`:

```bash
/opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1/packages/AGI_Agent/Launch.sh
```

The launcher installs hash-verified Node **24.21.0** privately and opens the local signer UI. Create a new encrypted seed wallet and preserve its recovery information using the application's workflow. Do not import or fund an existing operator wallet for qualification. Native GNOME Secret Service support is available; a missing or locked keyring does not permit plaintext key storage.

In the **stopped, unlocked** signer, select workstation compute and export its private OpenClaw setup JSON into this signer's private home, such as `Downloads`. The kit contains a bearer token and public approval material. It contains no wallet, but is still sensitive: do not paste it into chat or a support issue. Leave the signer stopped after export.

## 4. Transfer the setup kit — administrator

Switch to the administrator desktop. Replace `ACTUAL_SETUP_FILENAME.json` with the exported filename; quote the full path if it contains spaces.

```bash
sudo /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1/Transfer-Setup.sh "/home/agisignerlinux1/Downloads/ACTUAL_SETUP_FILENAME.json" agicomputelinux1
```

**Expected:** the helper copies only the kit to `/home/agicomputelinux1/AGI-Setup/OpenClaw-Setup.json`, owned by compute with mode `0600`. It validates ownership, private paths, schema and distinct signer/compute identities. It refuses an existing `AGI-Setup` destination. Keep wallet files in the signer account; do not copy the signer's home or OAuth data.

## 5. Install compute — compute desktop

Use Ubuntu's login screen to log into **agicomputelinux1**. Do not use `su`, `sudo -u` or a root terminal; a real session and D-Bus are required. Run the first command and continue only after it reports success:

```bash
/opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1/Prepare-Compute.sh
```

**Expected:** `Rootless Docker ready.` Then run:

```bash
/opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1/packages/AGI_Agent/Install.sh --file /home/agicomputelinux1/AGI-Setup/OpenClaw-Setup.json
```

The installer independently checks the account, rootless socket, resource controls, disk, images and desktop. It prepares pinned OpenClaw **2026.9.5**. Follow the Agent's separate **Creator, Checker and Reviewer** OAuth prompts in this compute session. Review the exact policy digest before approving it. Other roles have different OAuth profiles; see the table below.

**Expected:** the setup transaction completes and prints the path to `setup-diagnostics.json`. Two policy-bound systemd **user** services provide authenticated Gateway readiness and compute health on `127.0.0.1`. The installer may clear only its own temporary setup STOP; it cannot clear an earlier cleanup STOP.

Accept removal of the imported temporary kit if offered after success. After both endpoints work, return to the signer and delete its temporary exported kit through the file manager. Keep the wallet, OpenClaw state, journals and setup reports.

## 6. Qualify tools and live work

In the compute desktop, run:

```bash
/opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1/packages/AGI_Agent/Inspect.sh
/opt/agi-fleet-linux/AGI_Fleet_Linux_v1.1.1/packages/AGI_Agent/Qualify-Linux.sh --cycles 1
```

Read `Inspect.sh`'s fields, not just its exit status. Before work, expect `policy: PASS`, `host: PASS`, `computeSTOP: false`, and authenticated health with the correct role, `policyCurrent: true` and `stopped: false`. `health: null` is not readiness. Inspect can print a failed check while exiting successfully.

Local qualification creates and rereads a real DOCX inside a restricted Docker container, checks the desktop, verifies host ownership and memory/CPU/PID limits, then positively confirms test-container removal. **It makes no provider call and accesses no wallet.** Its private report path is printed. Any failure writes or preserves `COMPUTE_STOP`.

Return to the signer and complete the live checks:

1. Test the compute connection; review the authenticated identity and explicitly approve the bounded test. Confirm the approval persists.
2. Run real OAuth-backed inference.
3. Use **Create test documents** with synthetic content. Open the returned files and inspect their contents.
4. Confirm positive **base and browser** sandbox cleanup postconditions in `compute-journal`, current authenticated health, no STOP and no unexplained containers after the job.

A local Docker PASS does not prove OpenClaw live cleanup. If tools remain `NOT_TESTED`, health is absent, or any check is ambiguous, record the result and stop advancement. Protected public browsing starts disabled and requires separate explicit policy review and exact-host qualification; do not enable it to complete the offline document check.

New profiles allow 256 runs in a rolling 24 hours. Agent/Node allow 32 image attempts; specialist roles allow zero. Work is serial and retains resource limits, budget controls and signer approvals. Stay within approved provider use; keep wallet funding, paid jobs and transactions disabled during engineering qualification.

## 7. Reboot, repeat and record endurance

Record the exact release ZIP hash, OS/architecture, role, runtime versions and policy digest in a private copy of the [physical ledger](PHYSICAL_QUALIFICATION.md). After a successful live cycle:

1. Reboot normally. Compute's lingering user services should return without running a stop/start helper.
2. Log into the signer. Verify unchanged authenticated identity and persisted approval. Repeat inspection, inference, live document/review and both cleanup checks.
3. For Agent/Node, run `Qualify-Linux.sh --cycles 50` from the compute account.
4. Observe **72 elapsed hours**. Retain a sanitized health observation and a live synthetic role workflow at the start, after reboot, at least every 12 hours, and at the end. Check cleanup after every live job, stable memory/disk use, and no STOP, identity drift or orphaned containers.
5. Record suspend/restore and network interruption behavior. A fail-closed interruption must be diagnosed and reconciled with retained evidence before work resumes.

Fifty local cycles do not substitute for 72 hours of live observations. If an interruption causes STOP, there is no automatic cleanup reconciliation in this candidate. Do not remove it to finish the ledger.

The [AGIJobManager integration guide](JOB_INTEGRATION.md) and [mainnet deployment record](MAINNET_DEPLOYMENT.md) cover later contract configuration. Check current on-chain state and complete independent role/RPC qualification before funded operation; a deployment snapshot does not authorize signing or open intake.

## All six roles

Use the package column in place of `packages/AGI_Agent` in the launch/install/inspect paths. Use each role's own exported kit and separate fresh accounts. **Additional account-pair provisioning on a host that already has Docker is not automated.** Qualify additional roles on separately prepared clean hosts; `Prepare-Ubuntu.sh` intentionally refuses existing Docker installations.

| Role | Package | OAuth profiles | Work and qualification scope |
| --- | --- | --- | --- |
| Agent | `packages/AGI_Agent` | Creator, Checker, Reviewer | Sandboxed workstation creation; local DOCX and live tools |
| Node | `packages/AGI_Node` | Checker, Reviewer | Independent checking/review; local DOCX and live review tools |
| Moderator | `packages/AGI_Moderator` | Moderator | Appointed, conflict-free dispute work within policy; no workstation tools |
| Employer | `packages/AGI_Employer` | Employer | Own scoped jobs and bounded buyer actions; no workstation tools |
| Evidence | `packages/AGI_Evidence` | Evidence | Read-only evidence; **no signing wallet** or workstation tools |
| Recovery | `packages/AGI_Recovery` | Recovery | Scoped protocol recovery after deadlines; no workstation tools |

All six packages have `Launch.sh`, `Install.sh`, `Inspect.sh`, `Stop-Compute.sh` and `Start-Approved.sh`. Only Agent/Node have `Qualify-Linux.sh`; do not substitute an Agent PASS for a specialist's live workflow. For Evidence, use its read-only UI and setup export without creating a wallet. See the ledger's specialist guidance when a workstation gate is inapplicable.

## Everyday operation, stopping and updates

Normal reboot does not require an operator STOP. Use the signer's explicit background-login option if you want that behavior; merely launching the UI does not authorize unattended work.

`Stop-Compute.sh` deliberately writes `COMPUTE_STOP` and attempts to prove services, ports and recognized sockets stopped. **It is a safety stop, not a reversible pause.** `Start-Approved.sh` starts an already approved, STOP-free profile only; it cannot undo `Stop-Compute.sh` or a cleanup failure.

For diagnosis, decommissioning or a newer release, follow [troubleshooting and lifecycle guidance](TROUBLESHOOTING.md). No supported in-place upgrade or automatic uninstall is provided. Preserve the old release and profiles; do not overwrite approved code or run historical Mac repair/update launchers.
