# The Mac and Linux editions

**The Mac edition contains the complete six-role Fleet, with the platform-specific machinery Mac needs.** Mac 1.20.2 is derived from the shared Fleet source used by Linux 1.0.10, with an explicit Mac distribution and qualification boundary. Features being present is different from those features having passed physical qualification.

## Roles included

| Role | Useful purpose | Model sign-in stores | Signing boundary |
| --- | --- | --- | --- |
| Agent | Makes and checks documents, files, code and permitted computer work | Creator, Checker, Reviewer | Separate signer approves bounded job/claim actions; compute has no wallet |
| Node | Reviews original inputs and actual delivered work | Checker, Reviewer | Separate signer approves bounded validation/claim actions |
| Moderator | Handles appointed, conflict-free disputes after formal checks | Moderator | Separate bounded dispute signer; model veto does not override formal rules |
| Employer | Operates its explicitly scoped jobs and buyer decisions | Employer | Separate bounded acceptance/dispute/funding signer |
| Evidence | Observes and packages evidence | Evidence | Read-only; no signing key or settlement authority |
| Recovery | Performs scoped protocol recovery after deadlines | Recovery | Separate bounded expiry/finalization/refund/claim signer |

Recovery does not mean recovering lost seed words. Each role uses its own identity, policy and evidence. Separate OAuth stores are isolation measures; independent review also needs independent operator control.

## What is shared, and what changes on Mac

| Capability | Mac equivalent |
| --- | --- |
| Guided introduction and readable documentation | Mac-specific online onboarding plus packaged offline welcome, setup, help, qualification and release notes |
| Clean installation | New Standard signer and compute accounts; private setup JSON; pinned runtime; exact approval; authenticated completion |
| Runtime | Native arm64 Node 24.21.0 preferred, supported 24.19+ within 24.x; private OpenClaw 2026.9.5 |
| Isolated desktop, files, Office and code | Docker Desktop 4.93.0 user context and bounded disposable workspaces instead of Linux rootless Docker/systemd |
| Agent creation and Node review | Included Studio, original file delivery and role-specific review flows; actual usefulness must be measured |
| Wallet recovery and address handling | Signer-only 12/24-word seed-wallet flows, recovery-copy confirmation, encrypted backups and copy-address controls; Evidence has no wallet |
| Secrets and service startup | macOS account/Keychain and launch-agent paths replace Linux desktop keyring/service paths; physical login/reboot still needs testing |
| Limits and approval | Role/run/image limits, provider isolation, separate signer authority, policy identity, stop controls, authenticated readiness and retained journals |
| Failure recovery | Bounded read-only support reports; state-aware continuation/repair procedures; failed attempts and STOP preserved |
| AGIJobManager integration | Shared verification and role policy; exact deployment, independent RPC/review and financial qualification remain separate |
| Native Mac computer use | Included native workforce pilot with signed task grants and dedicated account permissions; separate from the container workstation |
| Release verification | Mac-specific manifests, hashes, archive size checks, native CI and physical-evidence gates; unsigned/notarized status disclosed |

## Native macOS work is an additional track

`Launch-Native-Workforce.command` opens the native-workforce menu. The complete Fleet archive includes `workforce/`, the CLI and its advanced guide at `docs/NATIVE_WORKFORCE.html`. Agent and Node folders within that same archive also include the corresponding guide and launcher. This is a controlled pilot for a dedicated Mac account, with explicit screen/accessibility permissions and reviewed task grants.

It does not authorize access to a personal desktop, transfer a wallet into compute or automatically publish private/encrypted work to an on-chain job. Production mode requires its own signed qualification evidence. Preserve the approval account, independent reviewer, runtime identity, encrypted evidence and operator spending controls.

## Evidence boundaries

- Native macOS CI can verify code and package regressions on its runner. It does not demonstrate a physical M1/M2 user's Docker GUI, OAuth, FileVault, Safari, Screen Sharing, actual job settlement or endurance.
- A Linux test result does not qualify macOS. An M1 result does not qualify M2, and one role cannot qualify the other five.
- The 8 GB M1 configuration, throughput, production economics and billion-user capacity are not established by feature parity.
- The Mac package is a qualification candidate until the exact release's [physical evidence](PHYSICAL_QUALIFICATION.md) and operating gates are accepted.

Begin with [Fresh Mac setup](FRESH_INSTALL.md). If you only want to prepare a job, use the [employer welcome](https://montrealai.github.io/AGIJobManager/) without installing a worker.
