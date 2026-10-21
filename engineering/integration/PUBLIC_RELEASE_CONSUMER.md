# Draft final public-package consumer / Consommateur de paquets publics finaux

This is an additive engineering acceptance path, not an observed pass. No release
IDs, package digests, source pins, sessions or review results are invented by this
source. The original source-checkout workflows and publishers remain unchanged
and mandatory. An eligible independent owner review is still required under
CONTRIBUTING.md before merge or publication; this draft does not provide that review.

## Exact source and admission

Land and review these helpers before freezing final Fleet source S. First publish
and authenticate the actual Alpha, Jobs and Manager releases. Refresh Fleet's
coherent runtime, inspector, captured SDK and source pins to those actual released
S2 commits, keeping their reviewed S1 identities separately. Re-run the unchanged
required gates and publish the content-pinned Fleet alpha.7 release at S.

Only after all four releases exist, prepare a real input document matching
public-release-input.schema.json. The repository-specific validator also checks
cross-field identities and authenticates GitHub objects. Review the complete
document against the retained original producer/package qualification evidence,
retain its raw UTF-8 SHA256, and store those exact bytes as a Git blob in the Fleet
repository. The owner must independently approve this exact input and its
Git-blob SHA1/raw-SHA256 pair before admission. The blob is data, not executable
source; storing it or supplying hashes does not establish that its bytes were
qualified. This draft does not establish a final approved-input baseline.

Root is the sole admission owner. After reviews and a fresh all-events query
showing no previous public-release-journey workflow run for S, the owner may
create the one new normal qualification branch at the exact released S:

qualification/ti-public-packages-<actual-blob-SHA1>-<actual-raw-SHA256>

Those are type descriptions, not observed identifiers. No source edit at S,
synthetic event environment or release-event fanout is used. A normal external
push is required; an event created by GITHUB_TOKEN must not be assumed to admit
another workflow. The workflow is push-only, validates the actual API run/ref,
requires attempt 1 and rejects another all-events consumer run for S. This
strict initial-admission contract does not automatically authorize retries.
An infrastructure failure must be inspected and handled explicitly before any
attempt to repeat work.

One workflow contains the original x64 and ARM64 qualification cells and a
separate non-executing collector. This is the existing reserved connected-journey
lane, not another reservation. No signing, Mainnet, funded work or live model
provider is enabled. Original private sessions, keys, STOP records and deployment
workspaces are never used or removed.

## Public-byte installation

The acquisition job authenticates each repository, published release
ID, tag, peeled commit/tree, exact asset ID/name/size/digest and actual downloaded
bytes. Required run selectors must match genuine latest successful attempts and
their explicit reviewed/released source role. Review comment IDs are authenticated
source-bound selectors only: this consumer does not infer reviewer eligibility
or approval from a comment ID. The original authenticated publisher/review gates
remain prerequisites and cannot be replaced by these selectors.

GitHub release immutability is optional for this consumer, not an administrative
prerequisite. Both immutable and mutable published releases are accepted only
when every selected identity, provenance binding and downloaded byte matches the
independently approved input. The complete release API observation retains the
reported immutable flag; CLI output records contentPinnedReleasesAuthenticated
and releaseImmutabilityObserved (null if the API did not report the flag), not a
claim that GitHub prevents changes.

The input is the existing trust anchor, not today's release metadata or a
checksum file downloaded alongside the package. A changed selected asset ID,
name, size or SHA256 requires a new explicitly qualified and owner-approved input;
the consumer never adopts replacement hashes from the current release. Extra
unselected assets are not acquired or admitted to the installed asset inventory.
Pinning detects mismatches but cannot prevent mutation or deletion of a mutable
release: changed metadata or bytes cause verification failure, and deleted assets
or unavailable APIs can make verification unavailable. The verify mode still
authenticates live GitHub metadata; it is not an offline verifier.

All selected public checksums must agree. Source materialization clones genuine,
complete standalone Git metadata and retains authentic objects/index at S2. It
does not check out source files to fill an archive. Every working-tree source
file comes from the actual downloaded source package; the complete member set,
Git blob bytes and modes must agree. Omitted members fail closed. No commits or
objects are synthesized from ZIP contents, and no installed code is patched.

Git source ZIPs can omit POSIX attributes for ordinary non-executable files.
An unspecified archive mode is recorded as unspecified; the effective creation
mode is derived from the authenticated Git tree. An explicit packaged mode must
match exactly. The only supported source symlink is Manager's retained
hardhat/contracts -> ../contracts link; no unreviewed links are materialized.

Alpha source ZIP and published wheel are separate assets. The normal-installed
wheel is checked against its RECORD, physical installed payload and exact Git
Python bytes, then its CLI runs in isolation with a fresh private home. The
native Computer profile intentionally executes the complete, captured released
SOURCE-package closure ahead of site-packages. Evidence labels this accurately;
it never calls source-package native execution wheel execution.

Jobs' existing source-profile and historical compiler/source verifiers derive
jobsSourceTransition against genuine S1/S2 Git objects and the authenticated
published profile. This does not run scanners, manufacture their results or
replace the missing AS/publication gate. same-tree continuity is independently
authenticated against actual Git commit objects.

Fleet alpha.7 is installed through the existing normal installer and its original
pinned Node archive. Both existing publication modes are supported: one identical
canonical archive or two architecture containers whose original inner archives
remain unchanged. Each architecture executes the installed Fleet Node and
application bytes. The package inventory must equal the original published
qualification inventory before execution and remain unchanged afterward.

## Original gates and independent custody

The new reusable workflow retains the original source/sample/inspector checks,
hash-locked dependencies, worker image/base digest observations, actual dashboard
and service, one-use grants, native Docker/browser execution, STOP/recovery,
same-project history, both disposable mock-token lifecycles and original
semantic collectors. The corrected trusted system-Python early cache preparation
is retained before project Python/pip, and the original late preparation/probe
remains mandatory. No source fixture or assertion is changed.

New observations that must be included in the original collector inventory are
written before that collector runs. The final package proof is a sibling under
public-package-evidence, so it cannot invalidate the original inventory by adding
a file afterward. Private CLI homes, native journals, operator tokens, keys and
Git metadata are outside the public upload allowlist.

The independent job downloads each original producer artifact ZIP once,
authenticates its API run/attempt/job/runner/source and GitHub digest, verifies
the public member inventory, materializes the same public source packages and
replays the unchanged collector read-only with independently supplied context.
It does not start service, native or browser work. Its observations must be
retained with their original artifact IDs/digests for the agreed
agi-fleet/public-release-equivalence/v1 E manifest. Keep E's established structure,
sourceContinuity and derived jobsSourceTransition; do not relabel S1 receipts as
S2 execution or construct a future website commit/self-hash.

## Separate live-only Pages T observation

public-live-sites.yml is independent of the connected journey. Include its source
before S is frozen; after the actual E/status website commit T and successful
normal Pages/Alpha HTTPS gates, review a separate public-live-input.schema.json
document containing actual four HTTPS roots, actual site source identities,
build-info paths/fields, EN/FR normal public flow selectors and exact public asset
link roles. Its referenced successful connected run must be the real S producer.

Jobs uses /catalog.json with commitPointer /revision and versionPointer null.
Its supplied version remains reviewed release context; the catalog does not serve
a version, and the observation records servedVersionVerified:false. Alpha and
Manager retain their actual served-version pointer comparisons.

Fleet uses /build-info.json for website T, with commitPointer /commit, and a
separate versionPath /release.json with versionPointer /version for software S.
The authenticator derives releasedSourceS2 from the already-authenticated release
input; the caller cannot supply it. The browser verifies release.json against
the build-info file hash, its workflowCommit against actual S and its version
against the expected release context. The two documents remain separate evidence.

The owner may later admit the distinct normal branch at exact T:

qualification/ti-public-live-<actual-live-input-blob-SHA1>-<actual-raw-SHA256>

The workflow authenticates real T separately from release S, original Pages run
attempts and successful exact-source github-pages deployment statuses. A fresh
locked Playwright browser observes actual public build-info, source identities,
served versions where present, EN/FR
flows, visible download hrefs, console/errors and screenshots. Package binaries
are not downloaded again. Browser requests permit only GETs to the four public
site roots and fixed static-resource origins; data/provider/RPC requests,
non-GET requests and all WebSockets are blocked. There is no account, wallet
extension, signing, native execution or model invocation. Any blocked request or
page/console error fails the observation rather than becoming a live pass.

## Validation and remaining decisions

The original source draft recorded NOT_RUN local syntax/import checks,
regressions, package acquisition, installation, native/GUI execution, independent
artifact collection and live browser observation while its workspace
execution/browser services were unavailable. In-memory source comparison and
Git objects are not runtime QA.

The content-pinned admission change has a bounded local stdlib regression suite,
test_public_release_assets.py, alongside the unchanged metadata tests. Run it with
python3 -B -m unittest discover -s engineering/integration -p 'test_public_release_*.py' -v.
Its synthetic API/byte doubles cover mutable/immutable/missing-flag observations,
unchanged published-prerelease acceptance, input/provenance/asset mismatch
rejection and downloaded-byte verification. They never execute packages or
establish a real approved-input baseline, hosted admission or release qualification.
All actual public acquisition, installed/native, browser, owner-review and final
exact-byte gates remain separate requirements.

Before merge or publication, review archive completeness/mode handling, actual publisher
manifest interfaces, existing source-pin compatibility, required gate selectors,
the input/comment-selector boundary and the disposable-host state/retention
policy. Complete all applicable source, saved-package, x64/ARM64, browser,
archive and owner-review gates on exact final bytes. If a public package omits
required files, a pin differs, an API is inaccessible or a required result is
missing, retain that blocker; do not supply checkout bytes or waive a collector.
Use approved available storage only; no paid storage or runner commitment is
authorized by this draft.

## Français

Ce chemin reste un brouillon de qualification technique, sans résultat observé.
Les publications réelles, les paquets téléchargés et les révisions finales
réelles sont obligatoires. L'immuabilité GitHub est facultative pour ce
consommateur : une publication modifiable est admise uniquement si ses identités,
sa provenance et ses octets correspondent à l'entrée exacte approuvée par le
propriétaire. L'état d'immuabilité observé est conservé, sans promesse de verrouillage.
Les sources examinées S1 et publiées S2 restent
distinctes; aucune ancienne preuve n'est renommée.

L'entrée doit être examinée au regard des preuves originales conservées du
producteur et de qualification des paquets, puis approuvée indépendamment avec
son SHA1 de blob Git et son SHA256 UTF-8 brut. Stocker un blob ou fournir des
empreintes ne prouve pas la qualification; aucune entrée finale approuvée n'est
établie ici. Les métadonnées et sommes de contrôle actuelles ne peuvent pas
autoriser de nouveaux octets. Tout changement d'identifiant, nom, taille ou SHA256
d'un actif sélectionné exige une nouvelle entrée explicitement qualifiée et
approuvée. Les actifs non sélectionnés ne sont pas acquis. L'épinglage détecte
les divergences sans empêcher une modification ou une suppression : il peut en
résulter un échec ou une indisponibilité. Le mode verify consulte toujours GitHub;
il n'est pas hors ligne.

Le paquet source publié fournit tous les fichiers exécutés dans un contexte Git
authentique. Aucun fichier manquant n'est ajouté depuis un checkout. Le wheel
Alpha installé et son essai CLI sont décrits séparément de l'exécution native du
paquet source. Fleet alpha.7 passe par l'installateur normal, avec contrôle exact
des octets et permissions avant/après. Les contrôles originaux, ARRÊT, reprise,
historique et deux cycles de jetons simulés restent obligatoires.

Une seule admission du parcours connecté demeure réservée. Le navigateur public
ultérieur constitue un contrôle distinct à la source Pages T, sans répéter le
parcours natif S, sans compte, portefeuille, fournisseur, signature ni
transaction. Il conserve les preuves EN/FR réelles et échoue sur toute erreur
ou requête interdite. Aucun succès local, natif, navigateur ou économique n'est
déclaré ici; les validations et l'examen indépendant admissible restent à faire.

The separate installed-wheel phase also installs the actual released Alpha source package's `requirements-agent.lock` with hashes and binary-only dependencies before normal wheel installation and `pip check`. The original native lock guard and install remain unchanged. Trusted system-Python preparation runs again after dependency installation and before any candidate site-package code is invoked. Availability of every locked wheel on both target architectures is a required hosted check, presently NOT_RUN; missing binary availability fails closed.

A small stdlib `test_public_release_metadata.py` module covers known input digests, a complete benign two-file source ZIP's byte/blob and unspecified0644/declared0755 metadata, and live-site metadata shape. The unchanged original unittest discovery picks it up alongside the bounded admission tests. These local tests make no source-release, installed-product, browser or journey qualification claim.

Canonical final-source selectors must include the actual released S2 main producer: Alpha Agent release (push/dispatch), Fleet TI publication (dispatch), Jobs rc.16 publication (push), and Manager's actual source qualification (push/dispatch). Manager has no publish job in current-state-release.yml; its content-pinned release/API custody is authenticated separately. Reviewed S1 runs remain additional evidence. Duplicate public asset IDs are validated as complete identity groups independent of JSON ordering: only the two identical Fleet architecture package roles can share one asset; manifest and checksum roles cannot join that group.

Manager n'a pas de tâche de publication dans current-state-release.yml : sa
qualification source reste obligatoire et les identités et octets des actifs publics
épinglés sont authentifiés séparément, sans imposer le verrouillage GitHub.
