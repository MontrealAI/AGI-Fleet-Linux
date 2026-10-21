# Discovery Lab Fleet receiver — source development

Tracking: [integration #4850](https://github.com/MontrealAI/AGI-Alpha-Agent-v0/issues/4850), [Fleet #63](https://github.com/MontrealAI/AGI-Fleet-Linux/issues/63).

This additive receiver matches a bounded six-stage Discovery Lab request to an explicitly installed local semantic checker. Without that installation it returns `unprovisioned`. A supported envelope by itself establishes transport compatibility only. Actual finite semantic acceptance requires the installed checker to run again on the current campaign.

Ce récepteur additionnel associe une demande Discovery Lab bornée à un vérificateur sémantique local explicitement installé. Sans cette installation, le résultat reste `unprovisioned`. Un format reconnu ne prouve que la compatibilité du transport. L’acceptation sémantique exige une nouvelle vérification de la campagne courante.

Starting source is Fleet main `45759fb096faf8988f58ae5ea71248d0f35a97c7`. The native TI project path remains in active [PR #61](https://github.com/MontrealAI/AGI-Fleet-Linux/pull/61); none of that predecessor's runtime, recovery, vendor, publication or owner-review work is changed here. Reconcile the eventual qualified baseline before integration.

No second project-history database is introduced. The returned receipt belongs in Alpha’s existing mission history. Import grants no execution, review, payment, or promotion authority. Every receipt says `remoteExecution: unprovisioned`, `settlement: not-connected`, and `organizationalIndependence: false`. A local checker is not an eligible independent owner review, a protected holdout, or scientific/physical/economic acceptance.

## Interfaces

`inspectDiscoveryRequest(raw)` uses the common strict `successor-discovery-work-request/v1` language. All six discriminants are supported: `learn`, `think`, `design`, `strategise`, `execute`, `evolve`. It rejects duplicate names, hidden/accessor object data, malformed Unicode, non-integer or unsafe numbers, unknown fields, payload digest changes, mixed routes, positive currency caps, and a submitted status. The transport fixture in `fixtures/transport-request.json` has no accepted semantics or competent executor.

`admitDiscoveryReview(raw, installed)` checks the installed context and returns `{request, receipt, installedSnapshot}`. The snapshot is data, never an execution grant. The trusted application supplies the following configuration independently of imported mission JSON:

| Field | Meaning |
| --- | --- |
| `executorId` | Bounded installed local reviewer identity |
| `runtimeDigest`, `currentRuntimeDigest` | Required runtime identity and the host’s current independently obtained observation |
| `expected` | Exact mission/revision/purpose/charter/model/source/evaluator bindings |
| `expectedCommission` | Frozen logical commission `id`, `branch`, and one `route` |
| `stages` | Explicitly admitted stage discriminants |
| `resourceCapacity` | Eight-component installed capacity vector |
| `inspectCampaign` | Installed function, never code or a module path selected by imported data |

Missing configuration or capacity returns `unprovisioned`; unsupported stages return `unsupported`; changed mission/source/runtime or commission bindings return `rejected`. These are receiver admission decisions, not proofs that the scientific task is infeasible.

`reviewDiscoveryRequest(raw, installed)` always performs a fresh semantic check. The installed inspector receives `(payload, {request, limits})`; `request` retains the immutable original total budget and `limits` is the remaining vector after receiver overhead and receipt reservation. It returns exactly `{accepted, resourceUsed, reasons}`. It must independently check the complete campaign against the bound finite semantics and honor those remaining limits. Success fixtures in the boundary tests use an explicitly named fake inspector and establish the receiver contract only.

The checker output is copied through the strict data language before use. A modified request, changed installed context, failed checker, malformed response, exhausted/truncated check, or unrepresentable receipt cost returns `inconclusive`. Completed negative semantic checks return `rejected-local-review`. Completed positive checks within limits return `accepted-local-review`. Reason codes ending `BUDGET_EXHAUSTED`, `SEARCH_TRUNCATED`, or `CHECK_INCOMPLETE` always remain inconclusive, including an exact-budget tie.

## Accounting and limits

The resource vector uses acquisitions, search operations, checking operations, memory bytes, serialized storage bytes, simultaneous worker capacity, installations, and measured elapsed milliseconds. The receiver charges one envelope check, the UTF-8 input footprint, its serialized receipt, and measured elapsed time. Semantic model costs reported by the installed finite checker are added once. Memory/storage byte figures describe the bounded data/model account; they are not native heap or disk allocation measurements. Failed inspectors preserve known costs explicitly as lower bounds rather than treating unavailable counters as zero total cost. Oversized malformed input preserves a lower-bound input cost and has no claimed request digest.

Before semantic work, 8,192 bytes are reserved for the receipt and existing input/checking/elapsed overhead is deducted. The output receipt’s exact serialized size is counted instead of charging the reservation. An over-budget completed result remains inconclusive. The trusted checker must itself bound its finite work; this adapter is not an operating-system process limiter and cannot preempt synchronous JavaScript. Remote execution and resource provisioning remain absent.

## Reproduce the boundary checks

```sh
node --test --test-reporter=tap discovery-lab/receiver.test.mjs
python3 -m unittest discover -s engineering/tests -p test_discovery_lab.py -v
python3 engineering/check-repository.py --require-source
python3 engineering/check-successor-preservation.py
```

The engineering test shim lets the existing exact-source repository-review workflow run these tests without a workflow change. Source tests do not establish publication, native installer acceptance, or the pending actual-campaign cross-repository integration. Existing review and release gates remain unchanged. No credentials, provider calls, payments, wallets, security changes, or paid runners are included.

## Shared contract source

`contract.mjs` is an identical Apache-2.0 copy of Alpha’s additive `examples/successor-capability/discovery-lab-contract.mjs`, being developed in [Alpha #4851](https://github.com/MontrealAI/AGI-Alpha-Agent-v0/pull/4851). SHA-256: `bfa38a9312a90730f7f35eaed3d5d5dcca2b1c0cc7e51657413670145d2da2e3`. The common transport fixture is copied unchanged from Alpha’s `fixtures/discovery-lab-request.json`. Exact public source-commit pin and actual semantic integration remain pending; this draft makes no released-source or installed-package claim.
