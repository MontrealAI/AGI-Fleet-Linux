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

The pinned inspector declares one `DISCOVERY_LAB_INSPECTION_CHECKS = 10000` charge per attempt. This is a bounded logical account, not a VM instruction count. The native fixture reserves its unchanged 4,096 admission allowance, that trusted declared charge, and the sum of current and ancestor charter checking caps. Its memory allowance keeps the original 1 MB floor and adds a source-derived upper bound when needed: raw admission bytes, four UTF-8 footprints for each committed-limits/request/payload/current-artifacts snapshot, and the inspector's 500,000-byte working reserve. Each report labels these terms. A maximum of 16 safe-integer iterations resolves the request's own encoded memory field before inspection; failure to converge fails closed. The committed safe-integer vector bounds the encoded width of the smaller remaining vector. This bound is conservative, not a claim of a minimal allocation or native heap measurement. `evidence/native-memory-refusal-daa8.json` retains the original 42/45 runs where the old 1 MB cap correctly made three ancestry cases inconclusive.

## Reproduce the boundary checks

```sh
node --test --test-reporter=tap discovery-lab/contract.test.mjs discovery-lab/receiver.test.mjs discovery-lab/qualify.test.mjs
python3 -m unittest discover -s engineering/tests -p test_discovery_lab.py -v
python3 engineering/check-repository.py --require-source
python3 engineering/check-successor-preservation.py
```

The engineering test shim also runs `qualify.test.mjs`, covering output containment and preservation, through the existing exact-source repository-review workflow without a workflow change. Existing review and release gates remain unchanged. No credentials, provider calls, payments, wallets, security changes, or paid runners are included.

## Pinned direct local semantic seam

`qualify.mjs` performs the actual finite local review through this receiver against public Alpha commit `daa8e3d8f0fbad4a5bc9b25393f566601b0baf31`, tree `77fbbe881c544749e7a3c8ff19288610451f0697`. This is an evidence-scoped development pin, not a final compatibility-set or released-installer claim. Later Alpha changes require a reviewed pin refresh and fresh execution.

`alpha-source-pin.json` independently commits all 26 files in Alpha’s generated browser catalog (`42b928d091dc60a6265836b1bbb641cb66dccea709583777cba0668685c83ebb`) and the six-file native inspector import closure. The union contains 29 regular files including the catalog and generated HTML page; the page SHA-256 is `2e9568507c04fe0cdc8b0870580848899f3fb94af181ac8d88e2141482244dc0`. Each SHA-256 and Git blob was compared with the exact public Git tree. The harness requires a clean tracked checkout at that exact commit, verifies the full maps before importing its fixed modules, and verifies them again afterward. Imported requests cannot choose source paths, inspectors, profiles, grants or code. This is a read-only development check, not a private source capture or a concurrent adversarial filesystem custody guarantee; it does not modify the separate native TI project or its review requirements.

The actual case bank checks all six stages on separate USDC and AGIALPHA branches of one frozen mission. It also retains invalid calibration, non-updatable memory, wrong-location capacity, hidden coupling, stale source context, forged response data, forged artifact inputs, omitted checkpoints, exhausted search/checking/storage, a cloned commission branch, unsupported/unprovisioned modes and accepted stronger control/checkpoint successors. The inspector reconstructs the current campaign and ancestry; a prior checker flag cannot stand in for current acceptance. Every request remains `DRAFT_NOT_SUBMITTED` with zero currency caps.

At this source, 45/45 semantic cases pass on the hash-pinned Fleet Node 24.21.0 Linux x64 runtime and separately on Alpha-compatible Node 22.17.1 Linux x64. These are direct local source-seam observations. No installed Fleet service, operator package, remote execution, protected holdout or eligible owner approval is established. The retained receipts keep those distinctions explicit. The earlier extraction failure is preserved in `evidence/runtime-extraction-recovery.json`: a truncated local binary was replaced only after the complete bytes matched the member streamed independently from the unchanged hash-pinned official archive.

Reproduce from a separate clean Alpha checkout; choose an absent evidence directory outside both repositories:

```sh
git clone https://github.com/MontrealAI/AGI-Alpha-Agent-v0.git /absolute/alpha-review
git -C /absolute/alpha-review checkout --detach daa8e3d8f0fbad4a5bc9b25393f566601b0baf31
/absolute/node-v24.21.0-linux-x64/bin/node discovery-lab/qualify.mjs --alpha-root /absolute/alpha-review --output /absolute/new-fleet-evidence
```

The runtime archive URL, SHA-256 and exact executable hash are in the pin. For the separately retained compatibility observation, invoke the pinned Node 22.17.1 executable with `--profile alpha-compatible-linux-x64`. The harness preserves actual receipts and reports failure if any expected outcome changes. `evidence/semantic-fleet24.json` retains all request digests/current receipts and eight full representative synthetic requests; `evidence/semantic-alpha22.json` retains the separate compatibility observations. Both are reproducible public authored cases, not independently protected evaluations.

The 37 contract/receiver/output regressions and all 179 engineering tests pass under Node 24.21.0; source inventory and successor preservation pass. The configured P2 review finding on head `26929d0` is retained in `evidence/budget-reproduction-before.json` and `evidence/budget-binding-before.tap`: zero checking allowance plus stale revision incorrectly produced a definitive rejection while charging one check. The correction is covered by 44 budget/binding combinations, a zero-context-read probe and 16 additional actual semantic requests.

Two later P2 corrections retain their own evidence. `evidence/nested-root-before.json` records a copied nested source directory passing the original checks; the harness now requires the physical Git worktree root before output validation. The shared parser rejects clearly oversized strings before UTF-8 allocation; canonical output also charges its aggregate code-unit lower bound before allocating the final encoding. `contract.test.mjs` covers encoder-free refusal and exact ASCII, escaped and multibyte boundaries; `evidence/contract-size-before.tap` retains the original failures and `evidence/contract-size-equivalence.json` records 1,048 unchanged admitted canonical encodings. `evidence/independent-root-guard-probes/` contains actual separate advisory checks and raw stdout.

The later direct-object width finding is covered by `evidence/object-width/`: own-key count and a serialized-size lower bound are checked before inspecting descriptors; descriptors are then checked individually. Wide non-enumerable keys on both arrays and objects are bounded, and the valid 99,999-child boundary is retained. Four new regressions fail the saved pre-fix canonical implementation and all 12 contract tests pass on both pinned runtimes. A reproducible comparison retains 1,055 admitted canonical encodings with identical bytes.

The current source's actual browser downloads are included unchanged in `evidence/browser-daa8-inputs/`, with byte counts, SHA-256, Git blob identities and source provenance in `manifest.json`. `evidence/browser-native-daa8-node24.json` and `browser-native-daa8-node22.json` record both route drafts passing through the actual receiver after fresh workspace replay. `evidence/browser-native-proof-daa8.mjs` reconstructs the exact pinned bridge policy from the selected campaign and its verified parent chain: 10,000 route-admission allowance, the trusted inspection charge, charter caps and the unchanged explicit 10 MB UI memory allowance. Imported request caps do not install authority. Use the bundled input directory to reproduce after the native harness:

```sh
/absolute/node-v24.21.0-linux-x64/bin/node discovery-lab/evidence/browser-native-proof-daa8.mjs /absolute/fleet-review /absolute/alpha-review /absolute/fleet-review/discovery-lab/evidence/browser-daa8-inputs /absolute/new-browser-evidence fleet-linux-x64
```

The historical exact-source Alpha1665 browser mission crossed the real receiver seam under Fleet source `c3105c5652f2aa2174bb2fd09563bfc30d3c1089`. `evidence/browser-native-1665-node24.json` and `browser-native-1665-node22.json` retain input hashes, fresh workspace replay, explicit independent local context and returned receipts. The original raw workspace and both route drafts are separately retained in the immutable [public Alpha evidence commit](https://github.com/MontrealAI/AGI-Alpha-Agent-v0/tree/a30ac0f183f79bf12a17f9b9d8a66f51fbca071c/evidence/discovery-lab-1665/local); receipt JSON alone does not retain those input bytes. The independently captured workspace SHA-256 is `cf79913210fc2bdfbdf216e119f577c20ae427cb32764e981c60c7c81fcd40d8`. The proof reconstructs expected payload/artifacts/commission from the unique verified accepted four-control campaign; imported request fields cannot install the checker or decide the local expected mission. Both raw drafts with a null installed context remain unprovisioned. To reproduce this historical proof, use Fleet `c3105c5652f2aa2174bb2fd09563bfc30d3c1089`, Alpha `1665cb83f09bde3962f80942e2f1e54b789d9708`, and the evidence commit’s `evidence/discovery-lab-1665/local` as the input directory for `evidence/browser-native-proof-1665.mjs`, with explicit Fleet/Alpha/input/output/profile arguments. The separate `hosted/` dataset is a different session. These old inspector receipts do not qualify the corrected current source.

The existing exact-source review workflow distributes the complete Git source archive, including this module, as review source. `evidence/review-source-10f.json` and `evidence/review-source-c310.json` qualify the actual downloaded hosted archives for their respective historical heads on both pinned runtimes; their exact archive identities and browser-draft receipts remain scoped to those bytes and older Alpha inspectors. The current candidate needs fresh hosted checks and archive evidence. The operator installers and `local-runtime/package.py` omit `discovery-lab/`. Direct extracted-source review does not establish operator installation, qualified publication or remote execution.

This PR changes local source and tests outside installer, authority/signer, workflow, release-auditor and runtime-vendor boundaries. CONTRIBUTING's eligible-owner rule is conditional on changes to those boundaries; PR #61's separate held lane does not impose it on this source-only PR. Existing ordinary repository, release-qualification, Pages, exact-source and current code/security review checks still apply. Any later operator-package integration needs a separate declared version/profile/inventory and the review and qualification rules applicable to that change.

## Shared contract source

`contract.mjs` is an identical Apache-2.0 copy of [Alpha's contract at `daa8e3d`](https://github.com/MontrealAI/AGI-Alpha-Agent-v0/blob/daa8e3d8f0fbad4a5bc9b25393f566601b0baf31/examples/successor-capability/discovery-lab-contract.mjs), developed in [Alpha #4851](https://github.com/MontrealAI/AGI-Alpha-Agent-v0/pull/4851). SHA-256: `9d2c99031d0b5c7ecd98ab3495c25ff48671eac3e94397b730ff93158bc21b71`. The local native pin matches this exact copy; each downstream repository qualifies its own synchronized source. The parser correction changes rejection timing and allocation bounds while preserving all admitted canonical bytes (1,048 compared cases retained). The common transport fixture is copied unchanged from Alpha's `fixtures/discovery-lab-request.json`. This draft makes no released-source or installed-package claim.
