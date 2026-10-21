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

Receiver overhead is checked immediately after a valid request is parsed, before inspecting installed context or deciding any binding mismatch. Missing overhead allowance returns `inconclusive`; no stale binding can turn an over-budget attempt into a definitive rejection. Every parsed admission receipt is also checked against the original limits after its actual receipt size is known. With sufficient allowance, missing configuration or capacity returns `unprovisioned`; unsupported stages return `unsupported`; changed mission/source/runtime or commission bindings return `rejected`. These are receiver admission decisions, not proofs that the scientific task is infeasible.

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

The engineering test shim also runs `qualify.test.mjs`, covering output containment and preservation, through the existing exact-source repository-review workflow without a workflow change. Existing review and release gates remain unchanged. No credentials, provider calls, payments, wallets, security changes, or paid runners are included.

## Pinned direct local semantic seam

`qualify.mjs` performs the actual finite local review through this receiver against public Alpha commit `91ee90a2d093043b9dff7d115320b181e89cdd46`, tree `db890530bd8c12cf18f642c9bcae0adda38a20c8`. This is an evidence-scoped development pin, not a final compatibility-set or released-installer claim. Later Alpha changes require a reviewed pin refresh and fresh execution.

`alpha-source-pin.json` independently commits all 26 files in Alpha’s generated browser catalog (`ca447b4ee3a9d2eb0dd764c1d9e478f2d2610c9e694dffe105b3c70e3fd26142`) and the six-file native inspector import closure. The union contains 28 regular files including the catalog itself. Each SHA-256 and Git blob was compared with the exact public Git tree. The harness requires a clean tracked checkout at that exact commit, verifies the full maps before importing its fixed modules, and verifies them again afterward. Imported requests cannot choose source paths, inspectors, profiles, grants or code. This is a read-only development check, not a private source capture or a concurrent adversarial filesystem custody guarantee; it does not modify the separate native TI project or its review requirements.

The actual case bank checks all six stages on separate USDC and AGIALPHA branches of one frozen mission. It also retains invalid calibration, non-updatable memory, wrong-location capacity, hidden coupling, stale source context, forged response data, forged artifact inputs, omitted checkpoints, exhausted search/checking/storage, a cloned commission branch, unsupported/unprovisioned modes and accepted stronger control/checkpoint successors. The inspector reconstructs the current campaign and ancestry; a prior checker flag cannot stand in for current acceptance. Every request remains `DRAFT_NOT_SUBMITTED` with zero currency caps.

At this source, 45/45 semantic cases pass on the hash-pinned Fleet Node 24.21.0 Linux x64 runtime and separately on Alpha-compatible Node 22.17.1 Linux x64. These are direct local source-seam observations. No installed Fleet service, operator package, remote execution, protected holdout or eligible owner approval is established. The retained receipts keep those distinctions explicit. The earlier extraction failure is preserved in `evidence/runtime-extraction-recovery.json`: a truncated local binary was replaced only after the complete bytes matched the member streamed independently from the unchanged hash-pinned official archive.

Reproduce from a separate clean Alpha checkout; choose an absent evidence directory outside both repositories:

```sh
git clone https://github.com/MontrealAI/AGI-Alpha-Agent-v0.git /absolute/alpha-review
git -C /absolute/alpha-review checkout --detach 91ee90a2d093043b9dff7d115320b181e89cdd46
/absolute/node-v24.21.0-linux-x64/bin/node discovery-lab/qualify.mjs --alpha-root /absolute/alpha-review --output /absolute/new-fleet-evidence
```

The runtime archive URL, SHA-256 and exact executable hash are in the pin. For the separately retained compatibility observation, invoke the pinned Node 22.17.1 executable with `--profile alpha-compatible-linux-x64`. The harness preserves actual receipts and reports failure if any expected outcome changes. `evidence/semantic-fleet24.json` retains all request digests/current receipts and eight full representative synthetic requests; `evidence/semantic-alpha22.json` retains the separate compatibility observations. Both are reproducible public authored cases, not independently protected evaluations.

The 24 receiver/output regressions and all 179 engineering tests pass under Node 24.21.0; source inventory and successor preservation pass. The configured P2 review finding on head `26929d0` is retained in `evidence/budget-reproduction-before.json` and `evidence/budget-binding-before.tap`: zero checking allowance plus stale revision incorrectly produced a definitive rejection while charging one check. The correction is covered by 44 budget/binding combinations, a zero-context-read probe and 16 additional actual semantic requests. Exact hosted CI, current-source review, predecessor reconciliation, any required eligible owner review, publication and installed-package qualification remain separate gates. These source files are not included in a currently published Fleet installer.

## Shared contract source

`contract.mjs` is an identical Apache-2.0 copy of [Alpha’s additive contract at `91ee90a`](https://github.com/MontrealAI/AGI-Alpha-Agent-v0/blob/91ee90a2d093043b9dff7d115320b181e89cdd46/examples/successor-capability/discovery-lab-contract.mjs), developed in [Alpha #4851](https://github.com/MontrealAI/AGI-Alpha-Agent-v0/pull/4851). SHA-256: `bfa38a9312a90730f7f35eaed3d5d5dcca2b1c0cc7e51657413670145d2da2e3`. The common transport fixture is copied unchanged from Alpha’s `fixtures/discovery-lab-request.json`. This draft makes no released-source or installed-package claim.
