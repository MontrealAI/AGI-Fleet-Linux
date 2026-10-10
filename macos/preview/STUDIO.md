# Public Studio preview on a Mac

This guide is for the larger **public** Agent/Node Studio in the generated developer source copy. It is outside the Mac 1.20.0 ZIP and inherits no acceptance or physical qualification. The native desktop menu has its own [setup guide](QUICKSTART.md); it is not the Docker compute setup procedure.

## Open isolated test profiles

Prepare the copy using the repository-only commands in [README.md](README.md). Then, in the **generated copy's top directory**, install its exact locked dependencies:

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

Choose two new absolute profile paths outside operational installations. Replace the sample paths below before running them, and verify each path does not already exist. Keep profiles private. Run the Agent and Node commands in separate terminals, each from that same top directory:

```sh
npm --prefix packages/AGI_Agent start -- --home /absolute/path/to/new-agent-preview-profile
npm --prefix packages/AGI_Node start -- --home /absolute/path/to/new-node-preview-profile
```

Use only unfunded test wallets and nonsensitive test files. Do not import an operational wallet, seed, backup or existing profile. The app opens a private loopback page; do not forward its port or share its private launch URL. Starting a preview page grants no compute or desktop authority.

## Prepare actual compute separately

The connection panel retains the original setup-kit and authenticated readiness workflow. It needs separate Standard signer and compute accounts, a private setup JSON transferred to the compute account without wallet material, the reviewed Docker Desktop arm64 runtime running there, and actual runtime/provider identities. Docker's isolated public workspace is separate from the whole-account native Mac workflow.

Use the [Mac fresh-install procedure](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/macos/docs/FRESH_INSTALL.md) for the account, pinned Docker, setup-kit transfer and compute prerequisites. That procedure describes the released distribution; **this source fixture is not its installer**. Do not substitute the preview tree into an operational installation or reuse the release's readiness, qualification or acceptance as proof for changed sources. A developer conducting end-to-end preview work must retain fresh setup/readiness evidence bound to this exact source and configured services before approving test execution. Preserve STOP markers and every failed attempt. The preview's physical gates remain `NOT_RUN`.

## Import a larger public task

In Agent Studio, import a reviewed `computer-work/v2` specification and its declared files. The shared implementation accepts arbitrary declared formats, at most **64 files** and **64 MiB total**, subject to its validation and resource limits. Runtime identities, permissions, criteria, budgets and deadlines must describe the actual configured services. Importing a specification does not grant execution authority, create funds or certify completion. The quick editor still produces the existing v1 format.

Use Node Studio to review the exact handoff bytes, record findings and return revision feedback. These public tasks must use public data and isolated-workspace authority. Private files, signed-in accounts and native desktop control belong to the separate native workflow; do not upload them here.

## Keep large work when backing up a wallet

Download the completed files and review handoffs separately. If large Studio work exceeds the wallet backup limit, deliberately choose **Exclude Studio work from this wallet backup**. The wallet and operational-state backup stays bounded; excluded Studio files will not return when it is restored. Check your separate export before relying on the backup.

Automated tests cover the real import controllers, exact handoffs, bounded encrypted backup/restore and browser import contract. They do not demonstrate actual model work, Docker Desktop permissions, a physical M1/M2 run or 72-hour endurance.
