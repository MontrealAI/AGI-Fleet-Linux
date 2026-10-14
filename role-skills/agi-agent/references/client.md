# Local client v1

Install one reviewed Fleet Local Runtime separately. Installing this skill executes nothing. The runtime requires Node 24 (>=24.19, <25; evaluated target 24.21.0). The default state is outside the installation. Do not select or copy a Dedicated Fleet/OpenClaw profile.

A local operator starts the runtime, creates and activates an actor, then issues an actor-scoped client using the `client` operation. The operator gives the assistant a protected credential-file path through the supported local integration. Never paste the credential into conversation, task input, URLs, evidence or exports. A credential file must be owned by the caller with mode 0600.

Use the installed `local-runtime/cli/main.mjs` entry point. Set `AGI_LOCAL_STATE` to the prepared state directory and `AGI_LOCAL_TOKEN_FILE` to the scoped client credential file. Do not use the operator token in a model-controlled environment.

```sh
node local-runtime/cli/main.mjs status
node local-runtime/cli/main.mjs request prepare /absolute/private-request.json
```

The request is a strict JSON object with `actor` and `task`. Task fields: `schema` = `agi-fleet/local-task/v1`, an allowed `action`, `workspace` = `files`, the action-specific `input`, `review` = `none` or `internal`, and `sourceActor` / `sourceController` = null except for Node checks. Examples and schemas ship in `local-runtime/examples` and `local-runtime/schemas`. Match the actor’s role.

`prepare` returns a grant ID, full input, limits, expiry and commitment. Show this exact scope to the operator. The operator uses their own dashboard/credential to authorize; the scoped assistant cannot authorize or activate itself. After authorization, send `run` with the exact actor and grant. Retry `QUEUE_CAPACITY` only before dispatch and before expiry. Never retry consumed or uncertain grants. `output` and `cancel` require the same actor and run ID.

Return the real receipt, output files and limitations. A file hash means exact bytes, not correctness. Keep inspection, execution, review, version choice, import and activation separate. Importing a portable role yields a new inactive local actor with no credential, binding, grant or signer authority. Ordinary exports contain approved role configuration only; retain deliverables separately.

Missing runtime: explain that Fleet Local Runtime must be installed and started by the operator. Do not install anything, change system settings, reuse another actor’s token, invoke an unrestricted shell, or pretend the task ran. Native isolation failures must block execution. Live OpenClaw/provider, browser, desktop, macOS local execution and independent market review are not qualified in this development preview. Existing Dedicated Fleet workflows remain available in their own qualified scope.
