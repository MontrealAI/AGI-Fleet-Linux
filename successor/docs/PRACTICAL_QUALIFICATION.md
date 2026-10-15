# Practical usefulness qualification — engine 2 implementation preview

Start in the existing [SUCCESSOR Ω + Fleet guide](GUIDE.md). Existing installation and guided context-building workflows remain the entry points. This change is an implementation preview, not measured evidence of a turnkey workforce.

## First useful result and a safer second task

Open the rebuilt `My-SUCCESSOR-Omega-en.html` or French edition. Select public data, supply `id,category,value` text, confirm source rights, run and inspect the downloadable report and exact result JSON. Original counts every row; improved counts identical IDs once and refuses conflicting duplicates. Choose the policy that matches the task; correct arithmetic under another policy is not business acceptance.

Select **Keep this version**, try a checked improvement, inspect it, and explicitly keep it if appropriate. Next choose **Use this method on new data**. Change the input, confirm public rights and the new mission, then run. Retain the automatically downloaded parent capsule beside the new capsule. Both remain independently recoverable. The next mission records the parent capsule/mission/candidate hashes and retains the selected method, with no carried outputs, plans, review, permission or funding. New results still require inspection and explicit selection.

Engine 1 capsules keep their original bytes and checker through an explicit compatibility path. The interface labels their assurance as historical and limited. Reuse with changed inputs creates engine 2 work. Historical local results do not qualify new data or a new runtime.

For other exports, expand **Map columns from another export**. Choose the ID, category and decimal-text columns; preview and approve the exact mapping. Keep the original bytes and mapping receipt downloaded when applied. JSON numeric values, comma decimals, thousands separators and currency/unit conversions require deliberate source preparation; they are not guessed. The engine keeps exact decimal arithmetic and conflicting-duplicate refusal. Browser uploads use `file.text()`; this change does not claim a browser BOM defect.

At narrow widths, focus the labelled report region and use arrow keys to scroll. Numeric values do not wrap. The page stays within the screen; all columns remain available, including print. Rendering evidence is a separate check from the component's approved-presentation check.

**Français.** Ouvrez la version française du Builder. Vérifiez les droits des données, lancez la méthode fixe et examinez les fichiers. Choisissez explicitement la politique des doublons et la version. Pour la tâche suivante, utilisez **Utiliser cette méthode sur de nouvelles données**, modifiez les entrées, confirmez et relancez. Conservez le fichier parent et le nouveau fichier. Pour d’autres colonnes, prévisualisez et approuvez les trois champs texte. Les montants restent entiers dans un tableau accessible par défilement au clavier. Ni autorité ni revue précédente ne sont transférées.

## Keep working when history fills

At 90 events, the EN/FR Builder warns that the current segment is nearly full. At 100, inspection, restore, export and explicit method reuse remain available; changes that add events stop. Restore preserves the exact state and uses no history slot.

Download a checkpoint and explicitly confirm **Continue history**. The new capsule preserves every prior event in a verified archive and opens a segment. Retain both capsules. Up to ten archives of 100 events plus the current segment are supported, within a four-megabyte capsule limit. At that finite limit, preserve/export the work and explicitly reuse the method for a new task. Candidate and plan capacity are separate; a full list does not prevent inspection or rerunning an existing candidate. Updated Builder code is required to read archival capsules; older readers reject that new format. Authority is never restored.

**Français.** À 90 événements, un avertissement apparaît. À 100, vous pouvez encore examiner, restaurer et exporter le travail. Confirmez **Continuer l’historique** pour télécharger le point de contrôle et conserver les événements dans une archive vérifiée. Gardez les deux fichiers. Dix archives de 100 événements, plus le segment actuel, sont permises dans la limite de quatre mégaoctets. À la limite finale, exportez le travail et réutilisez explicitement la méthode pour une nouvelle tâche. Aucune autorisation n’est restaurée.

## What is checked

| Layer | Engine 2 claim | Limit |
|---|---|---|
| Integrity | Hashes and deterministic rebuild on capsule inspection | No authorship or independent controller attestation |
| Method | Independent arithmetic, exact row/column associations, cardinality, locale, method metadata, approved presentation | Fixed all-category operation; purpose prose is not an executable specification |
| Business acceptance | Not evaluated by fixed-template checks | Additional instructions require typed acceptance in a custom qualified work path |
| Internal review | Separate local checker | No independently controlled operator |
| Independent review | Unverified unless separately established | A different process/model alone does not establish eligible control |
| Rendering | Browser tests on actual artifacts | No claim of observed ordinary-user or assistive-technology sessions |
| Historical restore | Original bytes retained and reproduced | No new permissions or current qualification |

The authenticated Agent → Studio → Companion → ComputeWorker → separately authorized Node → checked capsule path remains. Host/Origin/CSRF/action tickets, signer separation, STOP, immutable inputs, deadlines and existing call/resource controls remain mandatory. USDC planning allowances are not attested provider billing limits. No provider/model selection or pricing changed in this implementation.

## Append-only attempt observations

Installed execution now records reserved, dispatched and blocked/uncertain attempts in the private `successor-outcomes/attempts.jsonl` store. STOP and result inspection add observations without executing another action. Repeated result downloads may add observations; they do not create a new attempt or multiply a charge. Result exports retain observations for that attempt in a new local hash chain, with no other attempt’s payload or predecessor link. The selected attempt view shows its goal, input/output names, observed state, runtime/model route, declared time/USDC planning bounds, review assertions, cost uncertainty and safe recovery. Raw details remain behind an expandable section. Locked views withhold attempt history and outcome summaries. The ledger uses exclusive append locking, a hash chain, strict schemas, private regular files and fsync; torn history or an uncleared append lock fails closed. Preserve and reconcile evidence before repairing a damaged store. A hash chain is not external attestation.

Actual provider charges are **unknown** until billing evidence is recorded. Estimated, metered, invoiced, subscription-allocated and unknown values stay separate by currency; the ledger does not sum them as a fully loaded cost. Each expense ID binds one category and currency within an attempt; a repeated basis rejects accidental duplication. A newer basis for the same expense ID may reconcile an unknown or estimated charge. The selected expense total chooses one basis in this order: invoiced, metered, subscription-allocated, estimated. Original observations remain available by basis, so do not sum those columns. Different expense IDs denote distinct charges; it is the recorder’s responsibility to use the same ID for the same expense, including `provider-billing-unavailable` when resolving the automatic placeholder. Unknowns, missing costs and mixed bases preclude a fully loaded economic claim. Active and waiting seconds are separate for setup, preparation, authorization, monitoring, review, repair, support and recovery. An optional closed `actor` field distinguishes operator, reviewer, support, founder and engineer interventions; older observations retain the unspecified actor. These are recorded observations, never automatically inferred from wall-clock execution. Record human observations with their evidence hash and `observed` or `operator-reported` basis:

```sh
node fleet/successor/outcome-cli.mjs --store /ABSOLUTE/PRIVATE/successor-outcomes --event observation.json
node fleet/successor/outcome-cli.mjs --store /ABSOLUTE/PRIVATE/successor-outcomes --summary
node fleet/successor/outcome-cli.mjs --store /ABSOLUTE/PRIVATE/successor-outcomes --attempt ATTEMPT_SHA256 --summary
node fleet/successor/outcome-cli.mjs --store /ABSOLUTE/PRIVATE/successor-outcomes --attempt ATTEMPT_SHA256 --export
```

Each event has `attempt` (hash), `type`, `at` (milliseconds), `evidenceSha256` and typed `data`. See `outcomes.mjs` for the closed schema. Billing observations require a unique ID, category, basis, currency, exact nonnegative `amountMicros` string (or null when unknown), and billing-reference hash. Human-time observations require stage, activeSeconds, waitingSeconds and measurement basis. No payment or runtime authority follows from any record.

The hash-only `funnel` event records `taskSha256`, stage (offered/admissible/attempted/repaired/rejected/abandoned/repeated), family, role, `attemptOrdinal` and optional parent task hash. The parent hash is required for a repeated task. Summaries count distinct task hashes and exclude Node review work from the task funnel. Offered/admissible observations are automatically recorded only after valid request compilation and before/after runtime admission; arbitrary uploads, compiler refusals and earlier STOP refusals are outside that automatic denominator and must be captured as de-identified manual campaign observations. No refusal or completion flag counts as acceptance. First-pass accepted counts are **review assertions** with ordinal one and no declared repair/repeat; other asserted acceptance stays classified by internal, unverified or externally attested control. Missing funnel metadata remains unclassified. Distinct tasks are not evidence of distinct customers, and repeat tasks are not independent useful outcomes. Predeclare ordinals, rubric, fixed task set and repair allowance in the evaluation protocol.

Eligibility-audit events bind a verdict to review and audit evidence hashes. They record external audit assertions; a recorder can make a false assertion, so the external evidence, fixed rubric and actual reviewer eligibility still need inspection. `independentlyAcceptedUsefulOutcomes` remains null. Logs accept only the closed schema, identifiers, hashes and bounded numeric observations; do not put payloads, credentials, participant names or private billing text in IDs/method labels. Portable observations preserve that same boundary and cannot revive authority.

Failed, uncertain and abandoned attempts remain in the ledger. Review assertions do not establish eligibility: even externally attested entries require separate audit. Cost and active minutes per independently accepted outcome remain null while that audit and complete observations are absent. Allocate setup with a disclosed amortization; choose one economic basis for each expense and avoid double-counting billed review and reviewer labor.

## Predeclared live campaign

The manifest [pilot-plan.json](pilot-plan.json) freezes proposed thresholds before observation. The operational owner must approve task definitions, paired baselines, repair allowance and independent acceptance criteria before starting. Use 100 distinct tasks across data reconciliation, informational websites/changes and public repository fixes/tests; include externally authored tasks and admissible unexpected inputs. Keep fixture repetitions outside live results. Retain every attempted task, timeout, failure, repair, abortion and accepted artifact with exact identities. Report first-pass, post-repair, per-family and per-platform distributions.

Compare the same inputs and acceptance quality against competent direct tools and a supervised standalone assistant. Observe ten consenting nontechnical users covering EN/FR, assistance, recovery and changed second inputs. Keep only de-identified evidence. Measure all preparation, approvals, interventions, review and repair. Paired second-task effort must be observed, not inferred from faster code or fewer interface steps. Compare total cost over all attempts to independently accepted outcomes; unknown charges cannot become zero.

| Gate | Current status | Required resource/owner |
|---|---|---|
| Full saved-archive Linux x64/ARM64 engineering campaign | Pending CI | Release CI and exact-head audit |
| Physical Ubuntu x64/ARM64, isolation, cleanup, reboot, 72-hour endurance | NOT_RUN | Dedicated qualified hosts and authorized operators |
| Native Apple silicon commissioning, signing/notarization | NOT_RUN | Mac release owner and physical supported machines |
| 100 distinct live tasks / actual provider billing | NOT_RUN | Pilot owner, verified provider access and explicitly authorized hard budgets |
| Independently controlled acceptance and planted-defect review | NOT_RUN | Separately controlled eligible reviewers and retained eligibility evidence |
| Ten observed EN/FR users / quality-matched paired baselines | NOT_RUN | Study owner, consenting users and independent acceptance definitions |
| Total economic advantage and next-task effort improvement | NOT_RUN | Complete observed charges/time, denominator and baseline artifacts |

These missing gates cannot pass through fixtures or documentation. Existing Local Skills and native/private previews retain their separate commissioning criteria. Funded work remains disabled until its own operational, identity, review and settlement gates pass. Do not replace published archives or tags; release only the classification actually earned.
