# Ethereum mainnet deployment

The manager supplied on 10 October 2026 is compatible with the frozen Linux 1.0.9 contract artifacts. The read-only [deployment snapshot](../validation/mainnet-cfa78f9980ea9b55c705b3e44467bae383ce1fa7.json) verifies the manager and all eight linked libraries against two distinct RPC services at block **26,162,266**, hash `0xc64e19f4a94765d181ff48a89a19e2240415128ab773fcb6f3ff752255fc84e7`. Observation time: **2026-10-10 13:15:32 UTC**. This records that block's state; recheck before operating.

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

After the [fresh installation and physical qualification](FRESH_INSTALL.md), use the stopped signer's Setup panel to save the network, manager address and deployment block. Alternatively, its creation-transaction lookup accepts the hash above and discovers the address and block. Configure approved buyers and your own RPC connections, then use the application's contract verification. The application must create its own deployment enrollment and preserve its encrypted recovery records. The public engineering snapshot is reference evidence, not an importable operator approval.

Keep previews and workstation qualification separate from signing. Each role still needs an authorized participant identity, a bounded spending policy, approved compute and delivery services, recovery, and its required independent RPC checks. Public endpoint availability during this observation does not qualify an operator's RPC service or historical reads. In particular, the secondary service refused historical creation-code reads without an archive API credential; the primary verified the creation boundary. The application checks remain unchanged.

## Observed configuration

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

## Deployment log reconciliation

The operator-provided terminal transcript ends with `checksPassed: true` at block 26,161,848 after verification recovery and 185 passing installed preflight tests. Its accepted owner, recipients, identity roots, paused intake, zero accounting and all nine runtime hashes agree with the later independent Fleet observation. These are reported operator results; Fleet's engineering work does not rerun that private installed preflight or authenticate its deployment journal.

The earlier path/configuration errors, explorer source-comparison failures and empty-NFT-registry enumeration revert precede that successful final check. The transcript reports an in-memory compiler-derived registry length of zero and successful source verification recorded in the recovered receipt. This does not require replacing the deployed manager to establish Fleet bytecode compatibility. The private log and local configuration remain outside this public repository.

## Reproduce the read-only observation

Materialize the complete verified Fleet ZIP using the [development guide](DEVELOPMENT.md). Use Python 3.12+, its dependencies and the release-pinned Node 24.21.0. Supply two distinct HTTPS RPC hosts through environment variables. The primary needs creation-block archive reads; both need the recent observation block and finalized heads. Keep any API credentials private.

```sh
/ABSOLUTE/PATH/node-v24.21.0/bin/node engineering/verify-mainnet-deployment.mjs \
  --fleet /ABSOLUTE/PATH/AGI_Fleet_Linux_v1.0.9 \
  --manager 0xCFA78f9980eA9B55c705B3E44467baE383cE1fA7 \
  --creation-tx 0xaf1cffdb5b95c788eaaf148f02493ee92f390333c0999e36e2c8cc7a54fbf8e8 \
  --primary-env AGI_MAINNET_RPC_PRIMARY \
  --secondary-env AGI_MAINNET_RPC_SECONDARY \
  --out /ABSOLUTE/PATH/absent-observation.json
```

The output must be absent. The observer checks all 4,816 materialized source files and executable modes before importing Fleet's own runtime verifier. It allows only read-only RPC methods, bounds transport size/time, rejects redirects, requires both services to agree at a fixed block, and refuses stale or inconsistent results. No report is written on failure. Only RPC hostnames and selected public chain data are retained; endpoint URLs, credentials, block transaction lists and unrelated logs are excluded.

Repository checks replay retained public receipt/block identities, getter values, USDC checks and all nine full runtimes without network access or signing. They bind the snapshot's SHA-256 through the current-release metadata and preserve `productionQualified: false`. This is historic evidence, not a scheduled readiness monitor. Complete the [physical qualification ledger](PHYSICAL_QUALIFICATION.md) before production qualification.
