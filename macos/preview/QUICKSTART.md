# A guided native workspace on your Mac

**A controlled source preview for M1/M2, macOS 15+ and native arm64 Node 24.19+ within 24.x.** This guide accompanies the generated developer copy. It is outside the Mac 1.20.0 ZIP and has no inherited qualification. Production execution is disabled.

Ask a trusted technical helper to prepare it with you. The menu reduces command entry; it does not create account permissions, pair a provider or certify an installation. Stop at an unexplained error and preserve your files and operating records.

## 1. Use separate accounts

Use a new **Standard task account** for native work, a separate signing operator account, and an independently controlled reviewer environment. Keep your personal desktop, wallet, signing private key and unrelated accounts out of the task account. The account check rejects administrator/root accounts.

Native computer control can reach the whole dedicated account, including its signed-in applications. App registration identifies software; it does not confine control to that app. Log in to approved services yourself. Task screens and files may reach the configured model provider. Encrypted handoffs protect recipients during transport/storage; they do not hide content from the model provider.

## 2. Open the Mac menu

In the new source fixture created by `macos/preview/materialize.py`, open **Launch-Native-Workforce.command**. It uses an existing supported Node or prepares verified private Node 24.21.0 in that account. It checks native Apple silicon/macOS before opening the menu. Do not run it with `sudo` or bypass macOS protections.

Choose **Check this Mac account**. This only observes the host and account; it calls no model and performs no desktop input. Hosted test results do not replace this check on your actual Mac.

## 3. Prepare the native provider

The required desktop provider is the separately installed, signed **OpenClaw 2026.9.5 Mac app**, normally `/Applications/OpenClaw.app`, with a dedicated authenticated loopback gateway and an approved paired Mac computer-use node. The Fleet's npm compute runtime is not the native Mac app. Use OpenClaw's normal device pairing and macOS Screen Recording/Accessibility approvals; the preview cannot approve itself. Keep FileVault and normal macOS protections enabled.

The gateway must expose protocol 4 and the paired provider must advertise computer-use contract 2, `screen.snapshot`, `computer.act` and a stable provider generation. Record the actual approved node and provider IDs. A running gateway or connected node does not prove keyboard, pointer or capture effects.

In the signing account, generate operator keys with `npm run workforce -- keygen --dir NEW_PRIVATE_DIRECTORY`. Transfer only `operator-public.pem` to the task account. Keep the private signing key in the operator account.

In the menu choose **Create a private task workspace**. Supply file paths, role `agent` or `reviewer`, the public key, signed app path and exact provider model ID. It writes protected configuration, recipient keys and a planner fragment; it grants no execution authority. Merge that planner fragment into the dedicated gateway's configuration: exact model, no fallback, all planner tools denied, no elevated execution. Enable the chat-completions endpoint with token authentication on loopback.

Choose **Connect the Mac provider and set budgets** with actual gateway JSON, approved node/provider IDs, a dedicated-account label, the future signed authority-record path, and reviewed model/action/daily cost reserves. These reserves are accounting admission limits, not a provider billing hard cap. Use your provider's separate spending limits and retain bills.

Choose **Check connection status**, then explicitly request the live provider check. `doctor` verifies the signed Mac installation, gateway and paired provider. Capture, keyboard, pointer, live-model and reboot evidence remain separate physical checks. No successful model work is inferred.

## 4. Prepare a bounded draft

Exchange authorized recipient **public** keys with `add-recipient`; Agent and reviewer must have the same approved recipient set. If the job names additional application identities, choose **Register a signed Mac application** before exporting descriptors. Registration verifies identity; it does not restrict whole-account control. Choose **Export a runtime descriptor** on both sides after configuration is final. App or recipient changes require fresh descriptors and grants.

Choose **Draft a job for Agent and reviewer**. Supply the real reviewer descriptor, reviewed settlement metadata, clear goal, filename and output location. Creating a file requires explicitly typing `whole-account`; the draft requests that access for both roles. The result is a valid `computer-work/v3` specification with actual runtime hashes, recipients, budgets and deadlines. It contains no grant and performs no payment or desktop action. Review each role's permissions, inputs, criteria, time/cost limits and data processing before signing. Unsupported broker-scoped or local-only execution remains rejected.

In the separate operator account, prepare the current revocable authority record and the exact encrypted pilot packet:

```sh
npm run workforce -- authority-record --config CONFIG --signing-key OPERATOR_PRIVATE_KEY --sequence 1 --disabled false --out AUTHORITY_RECORD
npm run workforce -- packet --config CONFIG --spec REVIEWED_JOB --inputs APPROVED_INPUT_DIRECTORY --signing-key OPERATOR_PRIVATE_KEY --mode pilot --out ENCRYPTED_PACKET
```

Use absolute file paths for the placeholders. Transfer the unchanged configuration/public descriptors needed for signing without gateway tokens, private recipient keys or live gateway configuration. Install the signed authority record at the configured path. Increase its sequence when replacing or revoking it. The task account receives only its approved encrypted packet and signed authority record, never the signing private key.

For reviewer packets, include `--delivery DECRYPTED_DELIVERY` in the separate signing environment. Its grant binds the exact delivered bytes. A reviewer needs independent control and must inspect actual inputs/results rather than repeat the Agent's claims.

## 5. Run, stop and inspect

Choose **Run one approved encrypted pilot job** and type `RUN` only after reviewing the packet. The job must remain within its signed grants, current revocation record and limits. Results are encrypted. Signed receipts bind the execution and encrypted result through identifiers and hashes. Private work is not automatically uploaded, posted as a public job or settled through AGIJobManager. Production-mode packets are refused even if historical Mac qualification files are supplied.

Use **Stop work** from another terminal/menu to create durable `STOP`. Active work observes it before its next action/model request and attempts cleanup. A stop cannot undo an external action already taken. Uncertain input is never automatically replayed.

Use **Review operating records**. Preserve failed attempts, encrypted outputs and `RECOVERY_REQUIRED.json`. Resolve the original execution with the existing `recover` command if needed. **Resume after reviewing a stop** refuses an active worker or unresolved recovery. Typing `RESUME` only clears STOP; it starts no worker, renews no grant and proves no readiness.

Optional native queue and project tools remain advanced Mac CLI workflows. Establish the foreground pilot first. This preview adds no automatic startup, service registration or new login permission through its menu.

## 6. Keep physical evidence separate

Record M1 and M2 independently: exact sources/runtime/provider, standard account, actual screen and input effects, real useful file creation, independent review, stop/cleanup, uncertain-action recovery, reboot and permissions. Preserve every failure. All preview physical gates begin at `NOT_RUN`; synthetic tests and a source inventory do not promote them.

For large **public Studio** tasks, use [the separate Studio preview guide](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/macos/preview/STUDIO.md). That workflow uses an isolated container and separate signer/compute preparation, not this native desktop provider.
