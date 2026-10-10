# Set up a fresh M1 or M2 Mac

**Start with one Agent, one small task and two new Standard accounts.** This guide is for Mac 1.20.1, a qualification candidate. Installation does not establish physical reliability or authorize funded jobs.

You can ask a trusted helper to perform the preparation with you. Keep this page open or print it. Stop at any unexplained error and use [Help and recovery](TROUBLESHOOTING.md).

## 1. Check the Mac

Choose **Apple menu → About This Mac**. This edition targets M1/M2, native Apple silicon execution and macOS 15 or later. The installer rejects an Intel/Rosetta runtime or an older macOS. Use the Apple silicon edition of every dependency.

Prefer 16 GB RAM or more; 8 GB operation is unqualified. Allow at least 40 GB free storage as a starting planning allowance, plus space for images, downloads and completed work. Docker's virtual machine has its own memory setting; record it. A workstation sandbox permits 4 GiB and two CPUs, while the gateway has its own memory needs. A larger Mac does not by itself prove throughput or capacity.

Keep reliable power and internet throughout setup. Keep the compute desktop session logged in with Docker running during qualification. Arrange sleep settings deliberately and record them; a closed laptop, sleep or a logged-out account can interrupt work.

## 2. Download and check the package

Use the Mac release linked from the [official repository](https://github.com/MontrealAI/AGI-Fleet-Linux). Download the complete **Mac Fleet ZIP** together with its published checksum file. This single archive contains all six role folders; there is no separate role download to find. Do not substitute the Ubuntu archive or GitHub's automatic source-code ZIP.

Before opening downloaded code, have your helper compare the archive's SHA-256 with the published value. In Terminal, type the following with a space after `256`, drag the downloaded ZIP into the window, and press Return:

```sh
shasum -a 256 
```

The 64-character result must match the entry for that exact filename. If it differs, stop. A checksum detects changed bytes; it is not a developer signature.

Double-click the ZIP to extract it. Keep the entire extracted folder together in a permanent location in each account that uses it. Do not move just the application or run from inside the ZIP. Open `START_HERE.html` for the offline welcome.

The release is not developer-signed or notarized. Only proceed with a verified package from the official release using macOS's normal, file-specific approval process. If macOS blocks it, follow [Help and recovery](TROUBLESHOOTING.md); never disable Gatekeeper globally or remove quarantine from a whole directory tree.

## 3. Have your helper prepare separate accounts

From an administrator account, open **System Settings → Users & Groups** and create two new **Standard** accounts with different passwords:

| Account | What belongs here |
| --- | --- |
| Signer / approval account | Role application, encrypted wallet if needed, private recovery copy, signing records and your explicit approvals. |
| Compute / worker account | Docker Desktop, private OpenClaw runtime, provider sign-ins and the isolated work environment. No wallet or recovery words. |

For example, use `agisigner120` and `agicompute120`. The exact names are your choice. Both must remain Standard, and the compute account must not be promoted to administrator. Use separate fresh compute accounts for independently operated roles. Do not erase or reuse an incident account to make it look fresh.

## 4. Prepare Docker in the compute account

This candidate targets **Docker Desktop 4.93.0 for Apple silicon**. Use the [pinned official Apple silicon download](https://desktop.docker.com/mac/main/arm64/240920/Docker.dmg) and [Docker installation instructions](https://docs.docker.com/desktop/setup/install/mac-install/); do not silently substitute a newer version. Review the applicable terms and subscription requirements yourself.

Your helper must check the downloaded `Docker.dmg` against the runtime lock's SHA-256 before opening it:

```text
bf062f45334c711bd2fc2ed47a5588d050fbb950be3ae3aa4ac9826f04ad4dba
```

1. Have the administrator place the verified Docker application in `/Applications` if required.
2. Log in to the new Standard **compute** account and open Docker Desktop there.
3. Keep Docker's default **User** CLI installation at `$HOME/.docker/bin`; confirm it in **Settings → Advanced** if needed. Keep the user Docker context; do not add the compute account to an administrator group or install a second system-wide daemon.
4. Personally accept Docker's terms. Wait until Docker reports that its engine is running.

If a requested privileged feature cannot be completed in the Standard account, ask the administrator to review that specific feature. Do not run the Fleet installer with `sudo`.

## 5. Prepare the approval app

Log in to the new Standard **signer** account. Open the launcher for your role from the extracted Mac edition:

| Role | Fleet launcher |
| --- | --- |
| Agent | `Launch-AGI-Agent.command` |
| Node | `Launch-AGI-Node.command` |
| Moderator | `Launch-Moderator.command` |
| Employer | `Launch-Employer.command` |
| Evidence | `Launch-Evidence.command` |
| Recovery | `Launch-Recovery.command` |

Each role folder inside the extracted Fleet also includes its own local launcher. On first launch, the app can download and verify a private **Node 24.21.0** runtime in this Standard account if a supported runtime is absent. Keep the internet connection available and wait for preparation to finish. No administrator Node installer is needed. A supported existing runtime is Node **24.19 or later within 24.x**, running natively as arm64; do not substitute another major version.

For a new wallet, use the matching **Seed-Wallet** launcher and the app's **Create wallet** flow. Select 12 or 24 recovery words, write them down privately, and complete the recovery-copy check. Keep the words and any optional BIP-39 passphrase exclusively in your protected signer records. Never put them into chat, a support report, the setup JSON or the compute account. **Evidence is read-only and has no signing wallet.**

Do not fund the wallet during installation qualification. The new signer profile must not reuse an operational owner/admin wallet. A wallet address is not proof that a contract, provider or job has been qualified.

In the role's connection panel, select the intended supported model and choose **Download private setup file** (Node: **Download my private setup file**). This JSON includes a connection secret. Transfer only that file privately to the compute account; do not use a public/shared folder or upload it to GitHub.

A helper can use an encrypted removable drive, copy the JSON into the compute account's own private folder while logged in as that user, and eject the drive. The resulting file must be owned by the compute user and readable only by that user. In the compute account's Terminal, type `chmod 600 `, drag **only the copied setup JSON** after the space, and press Return. The clean installer checks ownership and these private permissions before reading the file. This changes that file's access permissions; it does not print its secrets.

## 6. Install the worker

Return to the new Standard **compute** account. Verify Docker is still running.

1. Double-click **`Install.command`** in the extracted Fleet or matching role folder.
2. When asked, drag the private setup JSON into the Terminal window and press Return. The Fleet installer selects the role from this file.
3. Read the account-separation confirmation. The installer prepares its own hash-checked private **Node 24.21.0** and **OpenClaw 2026.9.5** runtime. It does not need a global OpenClaw install.
4. Complete each displayed provider sign-in in this compute account. Agent uses Creator, Checker and Reviewer stores; Node uses Checker and Reviewer; each specialist role has one role-specific store. Separate stores are not proof of independent human control.
5. Review the exact authority, role and limits. Enter the displayed **APPROVE** phrase only when they match your intent. The service cannot activate without approval.
6. Wait for authenticated readiness, verified policy and **`transaction: complete`**. Keep the setup report. A listening port or a single green connection indicator is not the completion criterion.

The fresh defaults are **256 compute runs and signer requests per rolling 24 hours**. Agent and Node allow **32 image attempts**; the other roles allow zero. These limits are ceilings, not a guarantee of available quota, quality, throughput or a provider-enforced spending cap. Set the provider's own approved usage/spending limits and reconcile actual usage.

If the private setup file must be retained for a specifically reviewed continuation, keep the original unchanged in private storage. Otherwise remove unnecessary transfer copies after setup. Never include it in support evidence.

## 7. Make and inspect one small example

Back in the signer app, review the authenticated compute identity and approve only the intended bounded connection test.

For Agent, choose **Test my connection**, then **Create test documents**. Open the actual downloaded files and check their content. Studio lets you define a small public task and choose **Create & check the work**; this uses your connected model allowance but does not itself publish a job or send a transaction.

For Node, use the corresponding review workflow with the original inputs and the actual delivery. A Node's result needs its own observations; an Agent pass cannot stand in for it. Specialist roles need the formal, role-specific tests in the [qualification checklist](PHYSICAL_QUALIFICATION.md).

Require positive removal evidence for both base and browser work containers, observer persistence and workspace finalization. If cleanup fails or `COMPUTE_STOP` appears, keep the stopped state and use [Help and recovery](TROUBLESHOOTING.md). Do not delete the stop marker or rerun until it disappears.

## 8. Record what actually worked

Complete the [physical qualification checklist](PHYSICAL_QUALIFICATION.md), including stop/restart, reboot and 72 uninterrupted observed hours. Keep funded work disabled until its separate contract, independent-review, financial and operating checks are accepted. Public browsing and native control of macOS each require their own explicit permissions and qualification.

Upgrading an existing installation is an advanced, separate track. This guide does not authorize migration, account deletion, automatic repair, loss of evidence or a wallet change.

## All six roles

Use the matching role folder inside the extracted Fleet archive. `Install.command` works from the Fleet root or role folder; it is not necessary to locate a second workstation download.

| Role | Fleet package folder | Provider sign-in stores |
| --- | --- | --- |
| Agent | `packages/AGI_Agent` | Creator, Checker, Reviewer |
| Node | `packages/AGI_Node` | Checker, Reviewer |
| Moderator | `packages/AGI_Moderator` | Moderator |
| Employer | `packages/AGI_Employer` | Employer |
| Evidence | `packages/AGI_Evidence` | Evidence |
| Recovery | `packages/AGI_Recovery` | Recovery |

Each role needs its own setup JSON, policy and qualification. See [the role comparison](PARITY.md) before configuring a specialist service.
