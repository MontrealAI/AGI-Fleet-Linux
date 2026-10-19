# Local TI alpha.7 source preview

This additive source preview retains one public, non-personal native TI campaign
as a private Fleet project. It preserves the exact Alpha request, native result,
separate Manager USDC (6 decimals) and Jobs AGIALPHA (18 decimals) free inspection
records, fixed-summary browser handoff/return and pending method archive.
Imports grant no execution, spending, reviewer, producer or promotion authority.
The native v1 charter permits zero currency spending; both real paid-draft routes
must refuse. A Computer Use rehearsal is a separate authorized route, not paid TI.

The Linux dashboard remains version 1.1.5. TI is in the separate Local TI
`0.1.0-alpha.7` source ZIP, whose retained role/runtime policies are alpha.6.
Both current alpha.6 and alpha.7 builders now share the same dependency-byte
provenance check. Their versions, runtime/release profiles and all 6,272 Linux
mirror records remain unchanged. Alpha.7 is not an operator installer or production
qualification.

## First steps

**SOURCE PREVIEW:** these entry points do not establish a qualified release.

1. Open [Alpha’s free TI workspace](https://montrealai.github.io/AGI-Alpha-Agent-v0/transformational-intelligence/)
   and choose only public, non-personal source material.
2. To run a new campaign in Fleet, export Alpha’s initial project (revision zero)
   and follow the `start` path below. For completed exported history, follow
   `import`. Keep the campaign UUID and return to that same saved Fleet project
   for later steps.
3. Inspect the retained native result and the separate currency records. Native
   spending caps are **0 USDC and 0 AGIALPHA**; positive paid TI requests must
   refuse. Importing history grants no execution, spending or trust authority.
   Browser work and method reuse retain their separate existing controls below.

## Premiers pas

**SOURCE PREVIEW / APERÇU SOURCE :** ces points d’entrée ne constituent pas une
version qualifiée.

1. Ouvrez [l’espace TI gratuit d’Alpha](https://montrealai.github.io/AGI-Alpha-Agent-v0/transformational-intelligence/)
   et choisissez uniquement des sources publiques sans données personnelles.
2. Pour exécuter une nouvelle campagne dans Fleet, exportez le projet initial
   d’Alpha (révision zéro), puis suivez le parcours `start` ci-dessous. Pour un
   historique exporté terminé, suivez `import`. Conservez l’UUID de campagne et
   retrouvez ce même projet Fleet enregistré pour les étapes suivantes.
3. Consultez le résultat natif conservé et les relevés distincts des deux monnaies.
   Les plafonds natifs sont de **0 USDC et 0 AGIALPHA**; toute demande TI payante
   positive doit être refusée. L’importation d’un historique n’accorde aucun droit
   d’exécution, de dépense ou de confiance. Le travail dans le navigateur et la
   réutilisation des méthodes gardent leurs contrôles distincts décrits ci-dessous.

## Install and inspect the source preview

Build with locked Fleet production dependencies installed:

```sh
npm ci --prefix fleet --ignore-scripts --omit=dev --no-audit --no-fund --bin-links=false
python -B local-runtime/transformation/package.py --output /absolute/new-ti-package
python -B local-runtime/transformation/package.py --verify /absolute/new-ti-package/agi-fleet-local-0.1.0-alpha.7.zip
```

The builder refuses a changed finite TI source inventory. Its explicit
`--refresh-inventory` action prepares a reviewable source change; it is never run
automatically by qualification. Every archive member has its own bytes, mode and
SHA-256 in the existing installer-compatible manifest. The package receipt binds
the archive and TI inventory; `workingTreeDirty` remains truthful. Publication
requires clean committed source and both architecture jobs for those exact bytes.
The ignored `fleet/node_modules` members must also match the committed
`dependency-reference.json`: every packaged file's bytes, length and normalized
archive mode are compared before packaging. The manifest and package receipt bind
that reference's exact digest. Both current source-preview builders reject missing,
extra, altered or differently executable dependency payloads before writing output.
They reject symlinks and exclude only the generated root
`fleet/node_modules/.package-lock.json`; a nested file with that name is still a
checked payload. Building can remain offline after a matching normal installation.
This is dependency provenance, not vulnerability, native-platform or production
qualification.

The canonical reference retains the original reviewed Node/npm installation
metadata from #60. Its 2,393 payload rows were independently compared with all 14
lock-integrity-verified production tarballs. Removing the generated root cache row
was a payload-policy refinement, not a new installation or platform qualification.

Reference maintenance is an explicit reviewed action. The following command
creates a fresh private staging directory, copies only committed package and lock
inputs, runs the pinned Node 24.21.0 / npm 11.19.0 locked installation with scripts
disabled and development dependencies omitted, and records its complete packaged
dependency inventory. Future refreshes also disable audit, funding notices and bin
links, bound fetches/output/time, and preflight every complete-lock registry URL
and SHA-512 integrity record. Their extra invocation controls are recorded
separately from the retained historical installation. Refresh never blesses the
existing ignored dependency tree.

```sh
python -B local-runtime/transformation/dependency_reference.py --refresh --node /absolute/node-v24.21.0/bin/node --npm-cli /absolute/node-v24.21.0/lib/node_modules/npm/bin/npm-cli.js --cache /absolute/private-npm-cache --temporary-root /absolute/private-temp
python -B local-runtime/transformation/package.py --refresh-inventory
```

Review the generated reference, package/lock hashes and producer environment,
then commit both reference and source inventory. Qualification never refreshes
them implicitly. The retained Linux x64 reference does not qualify ARM64; both
existing saved-package/native architecture jobs remain required.

Les constructeurs source alpha.6 et alpha.7 utilisent le même contrôle hors ligne
des octets, tailles et modes des dépendances. Les fichiers manquants, ajoutés ou
modifiés sont refusés avant toute archive. Seul le cache racine généré
`fleet/node_modules/.package-lock.json` est exclu; les liens symboliques sont
refusés. La référence conserve les métadonnées de son installation examinée; elle
ne prouve aucune qualification native ou de production.
Use the existing `local-runtime/install.py inspect/preflight/install` commands
with the independently checked ZIP digest and pinned Node archive. Installation
does not activate actors or execute TI. Invoke the new entrypoint from the
verified application directory with Node 24.21.0:

```sh
node local-runtime/transformation/cli.mjs show --state /absolute/private-ti-state --sources /absolute/installed-ti-sources.json --python /absolute/physical-venv/bin/python --project CAMPAIGN_UUID
```

`installed-ti-sources.json` is operator configuration, never imported project
data. It contains `alpha`, `manager`, and `jobs`, each with an absolute Git
repository `root` and explicit 40-character `commit` from
`engineering/transformation/source-pins.json`. Each invocation captures regular
committed Git blobs into a private directory and checks their bytes before the
thin native API adapter executes. That adapter uses physical Python with
`-I -S`, source-only imports and an explicitly installed physical dependency
closure. It does not qualify the complete Alpha CLI/wheel, the Python dependency
installation, or Docker by itself. Full source-package/platform gates remain
separate requirements.

## Complete a public project

Every command below also requires the same explicit `--state`, `--sources` and
`--python` options. The concise example leaves these common options out.

1. `demo --confirm-public-demo --output /absolute/new-demo` runs the actual free
   native paper-summary campaign and its fresh confirmation. It retains both
   real currency inspections, an inert fixed-summary handoff and a native method
   archive pending separately supplied review. It does not run a browser.
2. Alternatively, export an initial native TI project from Alpha's UI (revision
   zero, one exact native request), then `start --file /absolute/project.json`.
   Inspect the local charter and displayed binding. `approve --project UUID
   --binding EXACT_BINDING` separately authorizes bounded local construction.
3. Use `step --project UUID --operation UNIQUE_PHASE_ID` for each of diagnosis,
   development and freeze. `pause`, `resume`, and `cancel` address the same local
   campaign. Steps before approval or while paused refuse. Exact operation retries
   preserve native idempotency; they never create a second browser grant.
4. After freeze, supply fresh complete public SourceDocuments as
   `{"documents":[...]}` using `confirm --project UUID --file /absolute/fresh.json
   --freeze EXACT_FREEZE_DIGEST`. This invokes the existing one-shot native
   confirmation and its source/freshness checks. A local signature proves custody,
   not organizational independence or freshness outside the retained evidence.
5. `inspect-routes --project UUID` recomputes both actual free inspections against
   the current independently read private native binding. `prepare-handoff
   --project UUID --output /absolute/new-handoff` exports the completed result's
   exact escaped public summary through the existing Alpha Computer Use protocol.
   It works for a completed inert imported project too, without native authority.
6. `export --project UUID --output /absolute/new-export` writes the portable
   project, native request/result, visible `summary.html`, handoff when retained,
   installed-source records and raw-byte checksums. `import --file
   /absolute/export/project.json` preserves exact history and explicitly does not
   restore a local native journal, runtime binding, grants, credentials or trust.
   Imported currency inspections remain `historical-unverified` until recomputed
   using a separately established current native context.

All project events are public-content screened before retention, including signed
review/control input. Never put credentials, private personal data, or private
signing keys in any project, source configuration input artifact or public output.
Private native journals and operator credentials stay outside exports.

## Authorize the browser separately

`browser-prepare --project UUID --profile /absolute/native-profile.json` uses
the existing Linux sandbox/profile/admission controls. Inspect the full prepared
task, limits, exact grant and commitment. Only then run:

```sh
node local-runtime/transformation/cli.mjs browser-run --project UUID --profile /absolute/native-profile.json --grant EXACT_GRANT --commitment EXACT_COMMITMENT --confirm-native-browser --output /absolute/new-browser-result --state /absolute/private-ti-state --sources /absolute/installed-ti-sources.json --python /absolute/physical-venv/bin/python
```

The profile is independently installed through the existing
`local-runtime/computer/profile.mjs` interface. It binds its own preserved Alpha
Computer Use source, real Docker image ID, physical runtime files and exact
handoff hash. TI discovery and Computer Use source pins are separate and explicitly
recorded; importing a project cannot choose either. No browser profile, missing
Docker, missing sandbox, altered commitment or consumed grant gets a host fallback.
The native return is attached to the same campaign and remains pending review.

`browser-capture --project UUID --output /absolute/new-capture` reads a retained
nonrunning native attempt after failure or output trouble. It performs no new
activation, authorization or execution. It preserves incomplete/uncertain evidence
and never restores consumed grants. The underlying LocalRuntime STOP,
reconciliation and no-replay requirements remain in force. `attach-computer
--project UUID --file /absolute/computer-return.json --output /absolute/new-return`
can attach an externally supplied exact return after the existing native verifier
checks its binding; this import does not independently trust its signer.

## Archive, review and reuse

`archive-reuse --project UUID --trust /absolute/public-trust.json --producer
CONFIGURED_PRODUCER --file /absolute/reuse-conditions.json --operation EXACT_ID
--output /absolute/new-archive` delegates to Alpha's actual native library. It
requires this installation's current original journal and explicit conditions;
an imported project does not supply producer authority. Initial state is
`pending-review`, with no activation and no execution or spending approval.

For an externally supplied valid signed review, use `library-review --project
UUID --trust /absolute/public-trust.json --producer CONFIGURED_PRODUCER --signed
/absolute/signed-review.json --operation EXACT_ID`. Review alone cannot promote
a method. `library-control` additionally requires `--behavior EXACT_DIGEST`
and a separately supplied signed controller decision. The existing native trust,
role separation, signature, scope, version and behavior checks are mandatory.
This product generates no reviewer/controller signatures.

`library-route --project UUID --trust /absolute/public-trust.json --producer
CONFIGURED_PRODUCER --context /absolute/fresh-target-context.json` selects through
the existing native router using the fresh target charter, prerequisites, behavior
and cost conditions. Its separately retained `reuse-selection.json` has no grant.
A target still requires its own explicit execution authorization. Pending,
rejected or retired methods retain the incumbent. Historical imported review
records remain unverified and cannot activate a local method.

## Recovery boundaries and qualification

`start` atomically retains the initial project and its local native-home pointer;
an interrupted matching initialization can be retried with the identical initial
file. `refresh --project UUID` resynchronizes a retained native campaign export
without repeating any native control. Library review/control recovery uses the
same exact native operation ID. Browser preparation can reopen a partial inactive
attempt; it refuses an existing executed attempt and never replays a consumed grant.

The convenience demo's initial native creation and first Fleet save span two
journals and are not one atomic transaction. Failure in that window can leave a
private completed free native campaign requiring direct inspection. Every later
demo project event is saved incrementally. A project transport is bounded to 24
events and 12 MB; constructive commands refuse known full history before work.
Pause/cancel still reach the native control even if retaining a further portable
event fails. Disk/quota failures can leave additional private native evidence;
refresh does not waive history bounds, prune evidence, or promise automatic recovery
from every failure. Existing output paths refuse before demo/browser work begins.

The dedicated mandatory `Native TI persistent project source-preview qualification`
workflow runs actual native tests, complete command controls and the saved alpha.7
ZIP through the existing Docker scripted-browser backend on Linux x64 and ARM64.
It checks one-use authorization, retained return/capture, closure and unchanged
saved-package inventory. It does not replace any legacy browser/native/package
gate or claim independent scientific/economic acceptance.

For local inspectable browser evidence only,
`engineering/transformation/headless-lab.mjs` requires an explicit
`--confirm-test-only-host-browser` and absolute project, source configuration,
Python, Chromium, new private state and public output paths. It renders only the
validated escaped fixed summary with scripting disabled and page/context requests
observed and blocked, captures real screenshots/visible text, and delegates to the
actual native session/return verifier. Its class is
`TEST_ONLY_HOST_PLAYWRIGHT_NO_DOCKER`: no container or whole-process network
isolation, fixed local advisor, ambient test dependencies, no production fallback.
Its native return remains pending usefulness review. A genuine separately
configured reviewer record is required to change that status.
