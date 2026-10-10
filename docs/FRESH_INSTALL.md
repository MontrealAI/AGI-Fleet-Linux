# Fresh Linux installation and physical qualification

Start this procedure only after the native validation addendum records complete-suite PASS for your architecture. A targeted-only or runner-capability PASS does not open this installation gate.

Linux 1.0.8 is a controlled qualification candidate. Native regression results and the exact frozen archive identity are recorded in the repository validation addendum. Physical installation, real OAuth/inference, document creation, cleanup, reboot identity persistence and endurance are separate gates and have not yet been completed by engineering.

Use this one fresh-install path. Prior installations stay inactive and preserved. No migration, historical fixtures or manual state editing is required. The engineering regression fixtures published alongside the release are not operator installation inputs.

## Supported Target
Ubuntu Desktop 24.04 LTS on x86-64 or ARM64, systemd, cgroup v2 and a normal GNOME desktop login. Minimum 8 GB RAM; 16 GB or more recommended. Reserve at least 40 GB free for the release, pinned runtimes and Docker images; compute admission requires 20 GiB available. Internet is needed for signed Ubuntu/Docker packages, hash-pinned Node, lockfile-pinned OpenClaw, image builds and OAuth. This edition is not qualified for Ubuntu 22.04/26.04, other distributions, WSL, containers, headless desktop substitutes or Mac.

## What Is Included
Agent, Node, Moderator, Employer, Evidence and Recovery applications. Agent executes sandboxed workstation work; Node independently checks/reviews. The four specialist roles keep their existing bounded role authority. Evidence has no signing wallet. Start with Agent; qualify Node and each additional role independently in another dedicated signer/compute pair. Do not treat one role's success as qualification of the other roles.

New profiles default to 256 runs in a rolling 24 hours. Agent and Node allow 32 image attempts; specialist roles allow zero. Work remains serial, with explicit sandbox CPU/memory/PID limits and a 4 GiB gateway heap. Existing budget controls and explicit signer approvals remain in force. No paid-provider fallback, wallet spending or funded job submission is authorized by installing or running local qualification.

## Account And Data Model
An existing administrator prepares the machine. NEW nonadministrator accounts hold the signer and compute separately. Neither joins sudo, docker, lxd, incus or another privileged group. Only the signer holds its encrypted wallet. Compute uses its own rootless Docker socket under /run/user/UID. It never receives the wallet. System services use the installed immutable code and private home profiles. Native GNOME Secret Service support is available; an unavailable/locked keyring never causes plaintext key storage. Login background service remains an explicit UI choice.

Keep previous installations inactive and preserved. Do not use an old signer/compute home as a fixture. This preparation script intentionally refuses pre-existing Docker/container packages or Docker apt sources: it will not replace or stop an existing Docker installation. If this preflight refuses, use an otherwise clean dedicated Ubuntu host and report the refusal; do not uninstall an existing environment to force acceptance. No migration, engineering fixtures or manual profile/state edits are required.

## 1. Verify And Place The Complete Release — Administrator
Download `AGI_Fleet_Linux_v1.0.8.zip` from the [frozen prerelease](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.0.8-qualification) and read the current validation addendum. The expected ZIP SHA-256 is `fa2bafdf957c3b3ecf36639ecd47adb4f7bf33c2ddfb13a99500fdd4625f4fb8`. Verify it before extraction:

    printf '%s  %s\n' fa2bafdf957c3b3ecf36639ecd47adb4f7bf33c2ddfb13a99500fdd4625f4fb8 AGI_Fleet_Linux_v1.0.8.zip | sha256sum --check

Extract the entire ZIP into a new directory; do not extract an individual role. A stable read-only location shared by the new accounts is /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8. From the directory containing the ZIP:

    sudo mkdir -p /opt/agi-fleet-linux
    sudo unzip AGI_Fleet_Linux_v1.0.8.zip -d /opt/agi-fleet-linux
    sudo chown -R root:root /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8
    sudo chmod -R go-w /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8
    /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8/Verify-Linux.sh

Use an absent destination. If it already exists, stop and preserve it. Verification must report PASS, including all seven manifests/source inventories. Checksums establish integrity, not independent publisher authentication. Keep the code at this path after approval; moving or editing it changes the approved runtime identity.

## 2. Prepare New Accounts — Administrator
Use new, unused account names. Example:

    sudo /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8/Prepare-Ubuntu.sh agisignerlinux1 agicomputelinux1

Review the printed changes and type PREPARE. The helper installs Ubuntu prerequisites and Docker Engine/CLI/rootless extras exactly 29.8.2 from Docker's signed Noble repository. It verifies Docker's signing-key fingerprint, creates private 0700 homes, asks you to set both account passwords, disables the newly installed root Docker service, and enables compute-only lingering plus UID-scoped CPU/memory/PID delegation. It does not lower AppArmor restrictions or grant access to the root Docker socket. A failure stops the sequence and preserves the attempt. Do not blindly rerun a partly completed preparation or repurpose those accounts.

## 3. Create The Signer Setup Kit — New Signer Desktop Login
Log into agisignerlinux1 using Ubuntu's login screen. Open Terminal; never launch the signer with sudo:

    /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8/packages/AGI_Agent/Launch.sh

The launcher installs verified Node 24.21.0 privately, then opens the local signer UI in its seed-wallet profile. Create a new encrypted wallet and preserve the recovery information using the application's recovery workflow. Do not import or fund an operator's existing wallet for qualification. For Evidence, the corresponding launcher opens its read-only profile without a wallet.

In the stopped, unlocked signer, select workstation compute and export the private OpenClaw setup JSON. This file carries a bearer token and public approval material, not the wallet. Keep it inside this signer's private home, such as Downloads. Never paste it into chat, attach it to a support report, place it in a shared folder or print its contents. Leave the signer stopped after export.

## 4. Transfer Only The Setup Json — Administrator
Switch to the administrator desktop. Supply the actual exported filename:

    sudo /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8/Transfer-Setup.sh /home/agisignerlinux1/Downloads/ACTUAL_SETUP_FILENAME.json agicomputelinux1

The helper checks source ownership, the private signer home, canonical parent directories, bounded schema and distinct signer/compute UIDs. It creates /home/agicomputelinux1/AGI-Setup/OpenClaw-Setup.json with compute ownership and mode 0600. It refuses an existing destination. Only this setup JSON is copied. Preserve wallet files in the signer account.

## 5. Prepare And Install Compute — New Compute Desktop Login
Log into agicomputelinux1 using the login screen. Do not use su, sudo -u or a root terminal; a real user session and D-Bus are required. In Terminal:

    /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8/Prepare-Compute.sh
    /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8/packages/AGI_Agent/Install.sh --file /home/agicomputelinux1/AGI-Setup/OpenClaw-Setup.json

Prepare-Compute installs the user rootless Docker service and verifies exact Docker version and cgroup enforcement. Install independently rechecks the account, private socket, runtime, free disk, images and desktop. It prepares pinned OpenClaw 2026.9.5, performs real OAuth separately for Creator/Checker/Reviewer, then asks you to review and approve the exact policy digest. Follow the OAuth prompts in the compute session; do not copy OAuth secrets to the signer.

The installer creates two policy-bound systemd user services, authenticates Gateway readiness and compute health, and completes its transaction before clearing only its own temporary setup STOP. It cannot reconcile an earlier cleanup STOP. Both services remain local to 127.0.0.1. Standard setup success establishes transport and policy identity; it does not prove live tools or production readiness.

Accept removal of the imported temporary setup kit when offered after success. Return to the signer and delete its temporary exported kit through the file manager after both endpoints are working. Do not delete the wallet, OpenClaw state, journals or setup reports.

## 6. Local Tools And Live Work — Qualification
From compute, run:

    /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8/packages/AGI_Agent/Inspect.sh
    /opt/agi-fleet-linux/AGI_Fleet_Linux_v1.0.8/packages/AGI_Agent/Qualify-Linux.sh --cycles 1

Inspect is read-only and prints filtered policy/host/health status. Local qualification creates and rereads a real DOCX in a real restricted Docker container, verifies host ownership and actual memory/CPU/PID controls, checks the desktop, and positively verifies test-container removal. It makes no model call and accesses no wallet. Its private report is saved to the printed .agi-linux-qualification-* directory. A local failure writes/preserves COMPUTE_STOP and stops qualification.

Switch to the signer. Test the connection, review the authenticated compute identity, explicitly approve its bounded test, and confirm that the exact approval is persisted. Run real OAuth-backed inference. Then use Create test documents with an actual synthetic document request. Open and inspect the returned deliverables. This live workflow must use real tools/files and record positive base AND browser sandbox cleanup postconditions in compute-journal. A green local Docker check alone does not qualify OpenClaw job cleanup.

No unexplained sandbox containers may remain; COMPUTE_STOP must be absent; authenticated health must remain current. If tools remain NOT_TESTED or any check is ambiguous, do not advance the ledger. Repeat for Node's independent workflow using its own separate account pair. Protected public browsing starts disabled. Configure-Public-Browser.sh and Import-Public-Browser-Qualification.sh support explicit policy review and exact-host evidence, but require their own independent native qualification; do not enable it merely to complete the offline document test.

## 7. Reboot And Endurance
After a successful live cycle, record the exact release ZIP hash, OS/architecture, Node/OpenClaw/Docker versions, role, policy digest and sanitized qualification results. Reboot normally. Log into the signer again. The compute account's lingering user services should return on their own. Confirm authenticated identity is unchanged and its approval persisted; rerun inspection, inference, a document workflow and both cleanup checks. Unexpected identity change requires review; do not bypass it by editing state.

Run 50 local cycles with Qualify-Linux.sh --cycles 50. Separately perform the documented 72-hour host endurance period: record authenticated health and a synthetic live document/checker cycle at the beginning, after reboot, at least every 12 hours, and at the end. Verify cleanup after every live job, no STOP, no identity drift, no orphaned containers, and stable memory/disk use. Keep provider activity within approved subscriptions/budgets and leave paid jobs, transactions and wallet funding disabled during engineering qualification. Suspend/restore and network interruption must fail closed and be reconciled only with retained evidence. A completed 50-cycle local check does not substitute for the 72-hour live endurance period.

Native test acceptance is recorded in the hash-bound addendum for this exact archive: the expanded 23-file targeted selection followed by all 342 test files on suitably permitted isolated x64 and ARM64 engineering runners. Do not start this procedure while either required result is pending or failed. These fixtures are engineering-only and are not required by this installation procedure. Do not use your signer/compute accounts for those tests. Restricted-run results, capable-run results and your physical Linux-host ledger must remain separate.

## Failure, Stop And Reporting
Stop on any failure. Preserve the new accounts, Docker state, compute-journal, OpenClaw profile, service files, support report, setup report and COMPUTE_STOP. Do not run Mac repair/restart/rollback launchers, remove STOP manually, replace ownership guards, weaken AppArmor or substitute a root Docker daemon. An installation failure may require a diagnosed new candidate and new unused accounts; there is no automatic same-release cleanup reconciliation in this edition.

Stop-Compute.sh deliberately writes an operator STOP and proves services, ports and recognized sockets stopped. Start-Approved.sh is only for an already approved STOP-free profile; it cannot undo Stop-Compute. Normal reboot does not require either command. A listening service is not work authority when STOP exists.

Report: release hash, Ubuntu version and architecture, RAM/free disk, role, failing stage, sanitized error code, Inspect output, local qualification report and the bounded sanitized setup/cleanup reports. Never attach setup JSON, wallet material, OAuth/token stores, raw service journals, provider responses or user documents. Existing durable cleanup evidence records sanitized command class, phase, target, exit/signal and timing; retain the original local records for engineering diagnosis. Do not post full home archives.

## All Six Roles
For each additional role substitute packages/AGI_Node, packages/AGI_Moderator, packages/AGI_Employer, packages/AGI_Evidence or packages/AGI_Recovery in the launch/install/inspect commands, and use distinct fresh signer/compute accounts. Prepare-Ubuntu is the first clean-host preparation; it deliberately refuses subsequent existing Docker packages. Additional account-pair provisioning on the same host is not automated by this candidate: qualify additional roles on separately prepared clean hosts. Qualify-Linux.sh is provided for Agent and Node because the four specialist roles do not expose workstation tools.

## Reference Material
The full package retains historical source, Mac launchers, fixtures metadata and prior reports for engineering traceability. They are not the Linux installation path. Use only this guide and the .sh entry points named here. A historical PASS, a help-only launcher probe or a syntax check is not native Linux acceptance. Linux 1.0.8 has its own hashes and requires its own validation addendum. No release in this package is represented as flawless, production-qualified or physically qualified on M1/M2.
