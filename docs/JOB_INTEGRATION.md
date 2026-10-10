# Fleet and AGIJobManager compatibility

Fleet executes jobs outside the contract. AGIJobManager holds USDC escrow, assigns a bonded Agent, records the completion URI, accepts bonded Node votes, enforces review deadlines, and settles or reserves deferred payments. A supported job requires explicit acceptance terms, a trusted buyer, authorized identities, adequate balances and budgets, and a verified contract deployment. Inference and publishing require configured, ready services.

The engineering baseline is Linux 1.0.9 and AGIJobManager commit `191cf3590e5cdc08df1bb0af500ee28a91c8b010` (package 1.13.0). Fleet's older `v1.1.0` source label is retained as provenance. All 11 production Solidity sources, ABI, creation/runtime bytecode, library links and immutable byte offsets match the freshly compiled baseline. This check fails when production source or contract artifacts change; an old label alone does not prove compatibility with a future manager.

Both architecture jobs passed in [main run 38052394030](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38052394030). The [hash-bound acceptance addendum](../validation/LINUX_1_0_9_JOB_INTEGRATION_ADDENDUM.md) records the independently audited results and permanent release evidence. On each architecture, all eight standalone scripts, the fresh-manager lifecycle and 777 manager regressions passed. This is additional coverage beyond the 3,897 native tests.

The supplied [Ethereum mainnet deployment](MAINNET_DEPLOYMENT.md) was independently observed against two RPC services. Its exact manager and eight-library runtimes match the same Fleet artifacts. That separate public-chain snapshot records paused intake and does not broaden the local integration evidence below.

## Reproduce locally

Use Ubuntu 24.04 x86-64 or ARM64, Python 3.12+, Git, network access and two absent directories under existing canonical parents:

```sh
python3 engineering/run-job-integration.py \
  --work /ABSOLUTE/PATH/integration-work \
  --evidence /ABSOLUTE/PATH/integration-evidence
```

The runner verifies and extracts the exact published Fleet ZIP, installs hash-pinned Node 24.21.0 in the engineering workspace, fetches the exact manager commit, installs locked development dependencies, applies the manager's compiler compatibility patch and compiles with zero warnings/errors. An existing Fleet ZIP can be passed with `--archive`. No administrator privileges or operator profile are needed. All financial transactions use deterministic test wallets, a mock ERC20 and an in-process chain with ID 31337.

It runs every standalone `integration*.mjs` script in Agent and Node, independently reproduces all 11 bundled contract artifacts, runs a new lifecycle against the freshly compiled manager, and executes the manager regression suite. New standalone scripts cause a coverage failure until deliberately included. Dev dependencies live outside the extracted release; all 4,816 inventoried source files and executable modes are rechecked after execution.

## Covered behavior

| Check | Evidence |
| --- | --- |
| Agent and Node standalone lifecycles | Observation, buyer/format gates, authorization revocation, exact bond approval, work submission, approve/reject/abstain, exposure limits, STOP and pause |
| Identity | Allowlist, blacklist, primary/secondary ENS ownership and approval, role-specific Merkle proofs and revocation |
| Three and seven voters | Actual finalization gas, 20% margin, gas/ETH limits, signing journal and restart receipt recovery |
| Budget recovery | Controller recovery, fresh encrypted backup and activation, preserved pending bytes, no repeated preparation or finalization |
| Image and computer jobs | Content-addressed fixture delivery, persistent preparation, three actual Node client votes and Agent finalization |
| Freshly compiled manager lifecycle | Default quorum three and seven-day window; Agent plus three Node clients; persisted approvals, votes and finalization; failed payouts, restart recovery of every client claim, conserved mock USDC, zero residual contract balance/exposure and no duplicate transactions |
| Manager regressions | Exact collected/executed/passed counts; forbidden pending/only tests; contract size checks |

The image/computer scripts retain old fixture labels in their output. The outer evidence records the actual saved release hash, current package versions, manager commit and Node runtime. The runner sets `AGI_NODE_ROOT` explicitly because those frozen scripts default to obsolete standalone package names.

## Continuous validation

[Integration CI](../.github/workflows/job-integration.yml) runs the pinned baseline on pull requests and relevant main changes on both Ubuntu 24.04 architectures. A weekly upstream probe fetches manager `main`, records its exact SHA, and fails if compatibility changes. Manual runs can select the baseline, another full manager commit, or `main`. Logs and hash-bound summaries are retained even on failure. An upstream compatibility probe does not replace the pinned release qualification.

This is local integration evidence. Generation, content transport and identities are fixtures; the two loopback RPC transports share one chain. Validators are separate clients and wallets under one test controller. Eight simulated days are not real-time endurance. No mainnet deployment, native USDC, public IPFS, paid inference, or independently operated validators are qualified here. Complete the [physical qualification ledger](PHYSICAL_QUALIFICATION.md) and verify the selected deployed code before enabling funded work. The release remains a prerelease.
