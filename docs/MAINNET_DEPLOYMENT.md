# Ethereum mainnet deployment

**Prepare and verify; keep funded work disabled until commissioning is complete.** The deployment and ENS connection have dated evidence. Neither a published Fleet archive nor a passing contract observation closes the physical-machine, participant, service and activation requirements below. Start with the [Mac setup companion](https://montrealai.github.io/AGI-Fleet-Linux/install-mac.html) or [Linux installation guide](FRESH_INSTALL.md) if you are setting up a computer.

The latest retained [Fleet core observation](../validation/mainnet-2026-10-11.json), completed **2026-10-11 15:47:54 UTC**, passed at block **26,170,203**, hash `0x75cd6f8322e899627027ab9115728b442ddc4cd94b3fe122439aad247e4d7f03`. Two distinct RPC services agreed on all nine production runtimes, 42 manager getters and the sampled native-USDC state. It confirms the attached helper address below, paused intake, open settlement, zero jobs and zero USDC balance/reserves at that block. The [SHA-256 anchor](../engineering/mainnet-observation.json) binds this new record without changing the earlier snapshot. No transaction was sent, wallet loaded or operator profile changed.

The manager supplied on 10 October 2026 is compatible with the frozen Linux 1.0.9 contract artifacts. The preserved earlier [deployment snapshot](../validation/mainnet-cfa78f9980ea9b55c705b3e44467bae383ce1fa7.json) verifies the manager and all eight linked libraries against two distinct RPC services at block **26,162,266**, hash `0xc64e19f4a94765d181ff48a89a19e2240415128ab773fcb6f3ff752255fc84e7`. Observation time: **2026-10-10 13:15:32 UTC**. Each record describes its own block; recheck before operating.

**Job intake was paused.** `createJob` and new applications require unpaused intake. Settlement was open. The manager had no jobs, USDC balance or reserved exposure. Deployment compatibility does not establish a working operator installation, participant eligibility or funded-job readiness.

## Deployment inputs

| Fleet setup field | Value |
| --- | --- |
| Network / chain ID | Ethereum mainnet / `1` |
| Manager contract address | `0xCFA78f9980eA9B55c705B3E44467baE383cE1fA7` |
| Deployment block | `26159468` |
| Creation transaction hash | `0xaf1cffdb5b95c788eaaf148f02493ee92f390333c0999e36e2c8cc7a54fbf8e8` |
| Native USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, six decimals |

[Manager source on Etherscan](https://etherscan.io/address/0xCFA78f9980eA9B55c705B3E44467baE383cE1fA7#code) · [Creation transaction](https://etherscan.io/tx/0xaf1cffdb5b95c788eaaf148f02493ee92f390333c0999e36e2c8cc7a54fbf8e8) · [Circle's native USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).

After the [Linux installation](FRESH_INSTALL.md) or [Mac installation](../macos/docs/FRESH_INSTALL.md) and the edition's physical qualification, use the stopped signer's Setup panel to save the network, manager address and deployment block. Alternatively, its creation-transaction lookup accepts the hash above and discovers the address and block. Configure approved buyers and your own RPC connections, then use the application's contract verification. The application must create its own deployment enrollment and preserve its encrypted recovery records. The public engineering snapshot is reference evidence, not an importable operator approval.

Keep previews and workstation qualification separate from signing. Each role still needs an authorized participant identity, a bounded spending policy, approved compute and delivery services, recovery, and its required independent RPC checks. Public endpoint availability during this observation does not qualify an operator's RPC service or historical reads. In particular, the secondary service refused historical creation-code reads without an archive API credential; the primary verified the creation boundary. The application checks remain unchanged.

## Earlier core observation — block 26,162,266

| Setting | At block 26,162,266 |
| --- | --- |
| Accepted owner | `0xa9eD0539c2fbc5C6BC15a2E168bd9BCd07c01201` |
| Pending owner | Zero address |
| Fee wallet 30 | `0xd76AD27a1Bcf8652e7e46BE603FA742FD1c10A99` |
| Fee wallet 10 | `0xA204b14eD9bc09501e3A47CDde379279FcD5D743` |
| Intake / settlement | Paused / open |
| Vote quorum; approve / reject thresholds | `3`; `3` / `3` |
| Completion / dispute / post-approval challenge periods | 7 days / 14 days / 1 day |
| Agent bond minimum / proportion | 1 USDC / 500 basis points |
| Validator bond minimum / proportion | 10 USDC / 1,500 basis points |
| Validator slashing | 8,000 basis points |
| Active jobs per Agent | `3` |
| ENS roots | `club.agi.eth`, `alpha.club.agi.eth`, `agent.agi.eth`, `alpha.agent.agi.eth` |
| Agent / validator Merkle roots | Both zero |
| Identity configuration locked / NFT required | `false` / `false` |
| ENS job-pages helper | Zero address |
| Jobs / USDC balance / all five reserve classes | All zero |
| USDC issuer status | Unpaused; manager, accepted owner and both fee wallets not blacklisted |

The snapshot contains all 42 manager getters, complete runtime bytes and their Keccak hashes, canonical native-USDC checks, receipt agreement, finalized creation and block identity checks. The manager's token immutable and each library's links/self-address are checked against the frozen artifacts. Code absent immediately before block 26,159,468 and present in that block proves the configured creation boundary on the primary RPC.

Admission paths and mutable policy still require live review. Zero Merkle roots and disabled NFT requirements do not authorize an arbitrary Agent or Node. The owner controls contract intake; a Fleet signing control cannot unpause it. Contract activation requires the accepted owner's explicit on-chain action after the deployment runbook and operational review. This verification sends no transaction, loads no wallet and changes no operator profile.

## Later ENS commissioning — block 26,165,026

AGIJobManager's [dated deployment record](https://github.com/MontrealAI/AGIJobManager/blob/5f296a14727f3497128f3a49bd628c1f09a96221/docs/deployments/MAINNET_USDC_2026-10-10.md) and [public evidence projection](https://github.com/MontrealAI/AGIJobManager/blob/5f296a14727f3497128f3a49bd628c1f09a96221/config/mainnet/agi-jobs-usdc.json) record a later connected state on 10 October 2026. This is operator-supplied evidence preserved in the manager repository, distinct from Fleet's earlier two-RPC observation.

| Recorded item | Later observation |
| --- | --- |
| Block | `26165026` |
| Block hash | `0x6d9d1af91485b6e1567cea4f905087051b3beb921024e90b4573b5361d814fa3` |
| Connected ENS helper | `0x6EE7A600C56C1Bfd12c482190d5dAbDD7194CDBC` |
| Job namespace | `job-` under `usdc.jobs.agi.eth` |
| Manager / helper administrator | `0xa9eD0539c2fbc5C6BC15a2E168bd9BCd07c01201` |
| Root owner | `0xd57243B80FBc5CFB2560E5a644651FEcd7Dc2512` |
| Intake / settlement / job count | Paused / open / zero |
| Activation decision | `HOLD_INTAKE_ACTIVATION`; production readiness not certified |

The earlier zero helper address is historical. The later record contains deployment, configuration, ownership, approval and attachment receipts; do not redeploy or repeat these transactions as part of Fleet setup. The root owner's NameWrapper approval is wallet-wide, not restricted to this root. The manager's read-only connection checker covers the connected helper; Fleet's observer below reads the helper address but does not qualify the helper's runtime, custody or approvals.

## Operate the existing instance with manager 1.15.0

Use the [v1.15.0 commissioning guide](https://github.com/MontrealAI/AGIJobManager/blob/3958cbc3b01aa459de16cf39e1ab0985b5fa56c3/docs/OPERATIONS/COMMISSIONING.md) from a fresh engineering checkout at `3958cbc3b01aa459de16cf39e1ab0985b5fa56c3`. Preserve the original private deployment workspace. The manager guide requires its own Node **22.23.2** and locked dependencies; this does not change Fleet's pinned Node **24.21.0** verifier or the installed Mac/Linux runtime. Version 1.15.0 changes operator tooling and adds regression coverage; production Solidity and compiler settings are unchanged, so this update needs no contract migration.

Start with `npm run mainnet:evidence` for the offline historical record. After preparing the guide's clean shell, private report directory and read-only HTTPS RPC connection, use `npm run mainnet:inspect` or `npm run ens:inspect` with the explicit `--instance recorded-2026-10-10` and a new private `--out` file. Do not route this connected instance through fresh deployment. The commands neither load a signing wallet nor authorize activation.

The current inspection collects policy, USDC, reserves, identity and ENS state at one canonical block hash. Complete NFT enumeration needs the original reviewed build/receipt bundle; full approval history and real participant checks need explicit inputs. Missing inputs remain **NOT_RUN / NEEDS_OPERATOR_INPUT**, never an empty registry or approval. Single-provider inspection is distinct from Fleet's two-provider core observation. Keep original artifacts and private reports private.

The same guide provides `ens:rehearse` for an isolated chain-31337 fork, `ens:recover` for read-only reconciliation of the original private journal, and `activation:review` for A1–A5 evidence collection. A passing rehearsal uses synthetic participants and funds; a complete collection still needs a separate signed owner decision. Original build artifacts, archive access, real participants and physical workstation qualification remain operator inputs.

**Check the actual ENS records.** The manager accepts specification URIs up to **2,048 bytes** and completion URIs up to **1,024 bytes**, but its fixed **500,000-gas** ENS hook cannot guarantee mirroring every permitted input. The 1.15.0 regression reproduces long-record failures with its test resolver even when the outer hook reports success; cancellation, settlement and completion NFT recovery are checked separately. Review both event layers and resolver records, and rehearse the actual URI lengths/resolver under activation gate A3. The short-URI fork rehearsal is not qualification for every permitted input.

## What must close before funded operation

Use the manager's [production activation runbook](https://github.com/MontrealAI/AGIJobManager/blob/3958cbc3b01aa459de16cf39e1ab0985b5fa56c3/docs/OPERATIONS/PRODUCTION_ACTIVATION.md) and [current commissioning workflow](https://github.com/MontrealAI/AGIJobManager/blob/3958cbc3b01aa459de16cf39e1ab0985b5fa56c3/docs/OPERATIONS/COMMISSIONING.md) for the exact evidence and owner decisions. The five recorded activation gates remain open in that dated record:

| Requirement | Evidence needed |
| --- | --- |
| Launch scope and limits | Approved operating scope and current on-chain policy readback. Existing public intake has no employer invitation gate or aggregate exposure cap; a per-job limit is not a total budget. |
| Financial, issuer and mutable policy | Fresh, coherent-block balances, all five reserves, issuer restrictions, complete NFT registry and identity/policy settings. The ENS connection check alone does not provide these. |
| Actual participants and recovery | Real participant eligibility, funding and available signers, independent review, dispute coverage and recovery. Local fixture tests do not establish this. |
| Authority and incident response | Full operator-approval history, privileged control and recovery, monitoring and a demonstrated human response. Preserve existing custody and approvals until separately reviewed. |
| Operating information | Adopted deployment-specific terms, fees, data/IP handling, accountable contacts and review of the actual UI/runtime. |

Separately complete the [Linux physical ledger](PHYSICAL_QUALIFICATION.md) or [Mac physical ledger](../macos/docs/PHYSICAL_QUALIFICATION.md), including real Docker, OAuth/inference, cleanup, restart and 72-hour endurance. Native hosted-runner tests do not commission a physical M1/M2. Mac Developer ID signing and notarization remain incomplete. Fleet controls and this documentation do not enforce or authorize contract activation.

## Deployment log reconciliation

The operator-provided terminal transcript ends with `checksPassed: true` at block 26,161,848 after verification recovery and 185 passing installed preflight tests. Its accepted owner, recipients, identity roots, paused intake, zero accounting and all nine runtime hashes agree with the later independent Fleet observation. These are reported operator results; Fleet's engineering work does not rerun that private installed preflight or authenticate its deployment journal.

The earlier path/configuration errors, explorer source-comparison failures and empty-NFT-registry enumeration revert precede that successful final check. The transcript reports an in-memory compiler-derived registry length of zero and successful source verification recorded in the recovered receipt. This does not require replacing the deployed manager to establish Fleet bytecode compatibility. The private log and local configuration remain outside this public repository.

## Reproduce the read-only observation

Materialize the complete **frozen Linux 1.0.9** ZIP using the [development guide](DEVELOPMENT.md#reproduce-the-preserved-109-baseline). This is an isolated engineering verifier, including when the operator edition is Mac 1.20.2 or Linux 1.0.10. Do not pass a newer archive, source-only checkout or installed operator profile. Use Python 3.12+ and the release-pinned Node 24.21.0; Fleet dependencies are supplied by the verified ZIP.

First check the materialization without any RPC connection:

```sh
/ABSOLUTE/PATH/node-v24.21.0/bin/node engineering/verify-mainnet-source.mjs \
  --fleet /ABSOLUTE/PATH/baseline-materialized/AGI_Fleet_Linux_v1.0.9
```

This authenticates the fixed root manifest and all **32,900** listed files, including dependencies, and checks the **4,816** source records and executable modes. Missing, changed, extra or symlinked files fail before Fleet imports. The inventory comes from the materialized release, so updating the repository's 1.0.10 source mirror cannot invalidate or substitute the frozen verifier.

For a live observation, supply two distinct HTTPS RPC hosts through environment variables. The primary needs creation-block archive reads; both need the recent observation block and finalized heads. Keep any API credentials private.

```sh
/ABSOLUTE/PATH/node-v24.21.0/bin/node engineering/verify-mainnet-deployment.mjs \
  --fleet /ABSOLUTE/PATH/AGI_Fleet_Linux_v1.0.9 \
  --manager 0xCFA78f9980eA9B55c705B3E44467baE383cE1fA7 \
  --creation-tx 0xaf1cffdb5b95c788eaaf148f02493ee92f390333c0999e36e2c8cc7a54fbf8e8 \
  --primary-env AGI_MAINNET_RPC_PRIMARY \
  --secondary-env AGI_MAINNET_RPC_SECONDARY \
  --out /ABSOLUTE/PATH/absent-observation.json
```

The output must be absent. The observer repeats the complete materialization check before importing Fleet's own runtime verifier. It allows only read-only RPC methods, bounds transport size/time, rejects redirects, requires both services to agree at a fixed block, and refuses stale or inconsistent results. No report is written on failure. Only RPC hostnames and selected public chain data are retained; endpoint URLs, credentials, block transaction lists and unrelated logs are excluded. A `PASS` proves this bounded observation; it does not close the activation requirements above.

Repository checks replay both retained observations' public receipt/block identities, getter values, USDC checks and all nine full runtimes without network access or signing. Each snapshot has its own SHA-256 anchor; the historical 1.0.9 acceptance metadata is preserved. The newer report also records the complete materialization check. Both preserve `productionQualified: false`. This is dated evidence, not a scheduled readiness monitor. Complete the applicable physical ledger and activation requirements before production qualification.
