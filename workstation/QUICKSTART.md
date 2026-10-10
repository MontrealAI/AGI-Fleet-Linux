# Linux authorized workstation: start here

This development candidate adds a **dedicated Linux work account** for jobs that need real applications, signed-in services, keyboard/mouse control and confidential files. The account has the access you deliberately give it. The operator signs a specific job and its budget; the worker executes it and saves an encrypted result for review.

The candidate has automated tests and is **pilot-only**. Production grants are rejected: Linux-specific production qualification is not yet implemented, and inherited Mac qualification cannot enable it. **Live desktop control, paid inference, reboot persistence and customer-job competence still require physical qualification.** It does not replace the separately qualified public-work Fleet release or automatically settle private work through AGIJobManager.

## 1. Choose the right computer account

Use Ubuntu or another compatible **glibc Linux x86-64/ARM64 desktop**, a dedicated non-root account, **X11**, and Node.js 24.19 or later in the 24.x line. This candidate does not support Wayland, a root account, an administrator/sudo account, a headless SSH session, or multiple-display targeting. Control uses the primary display. Log into the task account normally; do not use `su`, `sudo -u` or a shared remote display. The account must own its private `/run/user/<uid>` runtime, desktop session bus and restrictive Xauthority file.

Keep the operator signing key in a **separate operator account**. Never put a wallet, seed phrase, operator signing key or unrelated personal browser profile in the task account. Sign into approved work applications manually in the task account. The system does not create or invent your account permissions.

**Permission modes:** `whole-account` means all applications reachable through this task desktop. An app inventory is an identity check, not a restriction preventing access to other apps. `observe-only` permits supported screen/window observations. `broker-scoped` permissions and `local-only` model processing are not implemented and are rejected. Model-visible task content is processed by the configured approved provider.

## 2. Open the guide or run the local preflight

From the repository root:

```sh
npm --prefix workstation start
npm --prefix workstation run workforce -- preflight
```

The menu offers setup, connection checks, application registration, one-job execution, stop/resume and an optional queue service. It asks for **file paths**, never pasted private keys or passwords. The preflight only inspects the local execution environment; it does not call a model, send messages or operate the desktop.

Use `npm --prefix workstation run workforce -- help` for the full command list.

## 3. Prepare OpenClaw in the task account

Install OpenClaw using its [official installation instructions](https://docs.openclaw.ai/install). Use a dedicated, authenticated loopback gateway and the **same inspected npm installation and version** for its Linux node. The configuration binds the exact installed OpenClaw version, package/dependency tree and running Node binary; there is no automatic upgrade or model fallback.

In the interactive X11 task session, follow the [official computer-use instructions](https://docs.openclaw.ai/nodes/computer-use):

```sh
openclaw plugins enable cua-computer
openclaw doctor --lint --only cua-computer/driver-artifacts
openclaw node run
```

The driver-artifact lint must report no findings. Complete OpenClaw's normal pairing approval, including the updated `computer.act` command. Keep the node running in this same task account and X11 session. Obtain the actual paired node id through OpenClaw's node controls; do not substitute an account name or a guessed id.

The gateway must bind to `loopback`, use token authentication and enable `gateway.http.endpoints.chatCompletions.enabled`. Its planner entry must have the chosen model with no fallbacks and `tools.deny: ["*"]`: the workstation runner authorizes desktop actions separately. The generated `openclaw-planner-fragment.json` in the next step supplies this planner entry. Merge that entry into your private OpenClaw configuration; preserve its other settings and credentials.

A version match is not remote binary attestation. The operator must ensure the paired node actually uses the inspected local installation.

## 4. Create signing and task-account files

In the **separate operator account**, create an empty private key directory:

```sh
npm --prefix workstation run workforce -- keygen \
  --dir /absolute/operator-only/keys
```

Transfer only `operator-public.pem` to the task account. Keep `operator-private.pem` in the operator account.

In the **task account**, create an empty workspace. Replace the installation path with the canonical directory containing the installed OpenClaw `package.json`:

```sh
npm --prefix workstation run workforce -- init \
  --dir /absolute/task-account/agi-workstation \
  --role agent \
  --operator-public-key /absolute/task-account/operator-public.pem \
  --installation /absolute/node_modules/openclaw
```

Use optional `--model MODEL_ID` to select an exact model available to your account; the default is `openai/gpt-6-astra` and its availability must be checked. This prepares a recipient encryption key, private configuration and planner fragment. It does not enable execution. Repeat with `--role reviewer` in a separately controlled reviewer environment when independent review is required.

Private configuration and key files must be owned by the account using them, mode `600`; their private folders need mode `700`. Exchange public recipient keys with authorized participants, using `add-recipient` before binding job specifications.

## 5. Bind the real installation, account and budgets

Merge the generated planner fragment into OpenClaw first. Use the actual private gateway configuration, paired node id and a readable path reserved for the operator-signed authority record.

The values below are **illustrative accounting reserves**. Replace them with limits appropriate to your provider and workload. They are admission controls and recorded reserves, not a provider billing hard cap.

```sh
npm --prefix workstation run workforce -- bind \
  --config /absolute/task-account/agi-workstation/native-config.json \
  --gateway-config /absolute/task-account/openclaw.json \
  --node-id ACTUAL_PAIRED_NODE_ID \
  --provider cua-computer \
  --account-label dedicated-task-account \
  --authority-file /absolute/authority/agent-authority.json \
  --model-call-reserve 0.10 \
  --action-reserve 0.001 \
  --fixed-run-reserve 0.10 \
  --daily-reserve 25
```

Binding inspects the Linux environment and records the installed package identity, exact version, gateway configuration, account resource and budgets. Subsequent changes require new descriptors, specifications and signed grants.

Register a required application by its canonical executable path:

```sh
npm --prefix workstation run workforce -- bind-app \
  --config /absolute/task-account/agi-workstation/native-config.json \
  --app /absolute/application/executable \
  --id application-name
```

Then inspect the current connection:

```sh
npm --prefix workstation run workforce -- status \
  --config /absolute/task-account/agi-workstation/native-config.json
npm --prefix workstation run workforce -- doctor \
  --config /absolute/task-account/agi-workstation/native-config.json \
  --out /absolute/task-account/agi-workstation/doctor.json
```

`doctor` checks the configured gateway, paired Linux provider, installed identities and supported controls. It does not perform a model inference or prove keyboard/mouse effects. Its `qualified: false` is intentional; retain separate evidence from actual commissioning.

## 6. Author, approve and run one job

A job specifies the goal, inputs, deliverables, independent acceptance criteria, Agent and reviewer runtime identities, account resources, time/cost budgets, recipient keys, retention and allowed actions. The Linux preview CLI accepts **`computer-work/v3` only**, including public-data pilot jobs. This ensures explicit per-action permissions, recipient/privacy policy and signed revocable authority are present. Export each runtime descriptor:

```sh
npm --prefix workstation run workforce -- descriptor \
  --config /absolute/task-account/agi-workstation/native-config.json \
  --out /absolute/task-account/agi-workstation/descriptor.json
```

Before drafting, use `add-recipient --config CONFIG --file OTHER_RECIPIENT_PUBLIC_KEY` to establish the **same approved recipient-key set in Agent and reviewer configurations**, then export fresh descriptors. No private recipient key is exchanged. The configuration and software must remain unchanged between descriptor export, signing and execution.

Create a valid editable first-job draft from the actual Agent configuration and reviewer descriptor:

```sh
npm --prefix workstation run workforce -- draft-job \
  --config /absolute/task-account/agi-workstation/native-config.json \
  --reviewer-descriptor /absolute/task-account/reviewer-descriptor.json \
  --chain-id 1 \
  --manager 0xCFA78f9980eA9B55c705B3E44467baE383cE1fA7 \
  --authority whole-account \
  --out /absolute/task-account/agi-workstation/job.json
```

The initial draft asks the Agent to inspect the synthetic test workspace and use a text editor to save a report. Creating that real file requires keyboard/mouse input, so the composer requires explicit `--authority whole-account`. Provide `--title`, `--prompt` and `--output` to describe different work. This requests account-wide authority for **both roles**; review each role’s permissions separately before signing. The default supplies real runtime hashes, matching recipient ids, current budgets and a 24-hour deadline. There are no dummy identities. Review and edit the goal, criteria, input hashes, outputs, privacy/retention requirements and limits before signing. A draft creates **no grant**, performs no desktop actions and submits no transaction. Settlement chain/address fields are metadata for later integration, not a live connection or payment instruction.

Transfer the configuration **without its token/key files**, public descriptors and permitted job inputs to the operator account. The configuration contains paths and public keys; its `gateway-token.txt`, recipient private key and live OpenClaw configuration stay private. The operator uses an unchanged copy of the worker configuration so runtime hashes match.

In the operator account, create the signed authority record. Increase `sequence` whenever you replace a record. Use `--disabled true` to revoke authority. Expired authority blocks further actions.

```sh
npm --prefix workstation run workforce -- authority-record \
  --config /absolute/operator/task-config-copy.json \
  --signing-key /absolute/operator-only/keys/operator-private.pem \
  --sequence 1 --disabled false \
  --out /absolute/operator/agent-authority.json
```

Install that signed record at the exact `--authority-file` path. For a pilot, a signed record can be copied there. The longer-term production design requires the authority file and **every parent directory** to be owned outside the compute account and non-writable by it. That requirement does not enable production in this preview; Linux-specific qualification and its reviewed evidence are still absent.

Prepare the encrypted job packet in the operator account:

```sh
npm --prefix workstation run workforce -- packet \
  --config /absolute/operator/task-config-copy.json \
  --spec /absolute/operator/job.json \
  --inputs /absolute/operator/approved-inputs \
  --signing-key /absolute/operator-only/keys/operator-private.pem \
  --mode pilot \
  --out /absolute/operator/job.encrypted.json
```

`packet` validates the specification/runtime binding and signer before producing a packet. It grants this exact job, not blanket future permission. Only `--mode pilot` is accepted in this preview; production execution remains unavailable. Transfer only the encrypted packet to the task account, then run:

```sh
npm --prefix workstation run workforce -- run \
  --config /absolute/task-account/agi-workstation/native-config.json \
  --packet /absolute/task-account/job.encrypted.json \
  --recipient-key /absolute/task-account/agi-workstation/recipient-private.pem
```

Observe the desktop during commissioning. Retain evidence for actual screenshots and input effects, approved account use, live inference, artifact creation, stop/cleanup, restarts without uncertain-action replay and independent review. The worker saves encrypted results and receipts. Reviewers require their own runtime, job role, signed grant and decryptable input handoff.

**Private work is not uploaded automatically to public job storage or submitted to AGIJobManager.** Keep confidential bytes, credentials and application sessions out of public repositories, IPFS and on-chain metadata. This candidate produces encrypted handoffs, receipts and commitments; the public settlement adapter remains a separate integration.

## 7. Stop, inspect and resume

Stop from another terminal or menu in the task account:

```sh
npm --prefix workstation run workforce -- stop \
  --config /absolute/task-account/agi-workstation/native-config.json
npm --prefix workstation run workforce -- operations \
  --config /absolute/task-account/agi-workstation/native-config.json
```

The durable `STOP` marker blocks new work and is observed by active authority checks. Cleanup is attempted; stopping cannot undo an external action already taken. Inspect the result and any recovery requirement. An uncertain action is never automatically replayed.

After the worker has stopped and you have resolved cleanup/recovery:

```sh
npm --prefix workstation run workforce -- resume \
  --config /absolute/task-account/agi-workstation/native-config.json \
  --acknowledge true
```

Resume refuses an active worker or unresolved recovery marker. It only clears `STOP`; it does not start execution, refresh authority, repeat the job or certify readiness.

## 8. Optional queue service

Only after the foreground workflow works on this physical desktop:

```sh
npm --prefix workstation run workforce -- install-service \
  --config /absolute/task-account/agi-workstation/native-config.json \
  --recipient-key /absolute/task-account/agi-workstation/recipient-private.pem
npm --prefix workstation run workforce -- enqueue \
  --config /absolute/task-account/agi-workstation/native-config.json \
  --packet /absolute/task-account/job.encrypted.json
npm --prefix workstation run workforce -- service-start \
  --config /absolute/task-account/agi-workstation/native-config.json
```

Installation creates a **systemd user service** but does not start it, enable startup on login, enable linger or grant new access. Start it explicitly from the same X11 login. It uses the recorded display, Xauthority (when present), private XDG runtime and desktop session bus, has no automatic restart and still requires the separately running OpenClaw gateway/node and valid signed jobs. An optional `service-stop` command writes `STOP` and stops the unit.

If your display or Xauthority path changes after logout/reboot, inspect and regenerate the service from the new verified session. The current installer refuses to overwrite an existing unit; remove only that exact reviewed inactive unit before reinstalling. A service starting is not evidence that the desktop or provider is ready.
