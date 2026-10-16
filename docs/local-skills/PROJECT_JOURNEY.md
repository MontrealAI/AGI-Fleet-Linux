# Keep one Alpha project history through Fleet

This additive source preview accepts an explicit public-data project request,
produces the same integer CSV report through Fleet's existing bounded worker,
and returns the original project, request, Agent execution and separately
authorized internal Node check. Select **Keep one Alpha project history** in
the authenticated local dashboard. Both routes remain explicit:

| Selected route | Planning asset | Fleet operation |
| --- | --- | --- |
| AGIJobManager | USDC | Bounded offline report and internal file check |
| Jobs v0 JobRegistry | $AGIALPHA | The same bounded offline report and internal file check |

The chosen route is planning context. Fleet does not assign a contract, sign,
fund or settle either market. The JavaScript CSV task is not relabelled as the
separate Python `alpha-run` backend; that backend's provisioning gate is intact.

1. Save a Fleet request from the guided Alpha project. Its exact upstream bytes,
   project and cycle identity, selected currency, unit-preserving row mapping
   and bounded task are retained together.
2. Import the request into the local dashboard. Importing retains history and
   grants no authority. Check readiness and activate a dedicated Agent and Node.
3. Choose the project and prepare it with the Agent. Inspect the exact task and
   resource limits, authorize once, then run. Save the actual report files.
4. Choose that completed execution and an active Node. Prepare, inspect,
   separately authorize and run the internal check.
5. Choose the completed Node check and save the return file. The runtime rejects
   a different task, a different delivery, a failed checker or the same actor.
   Import the file into the same Alpha project as historical internal evidence.
   Deliberately select fresh inputs before beginning a new project cycle.

Source API: `local-runtime/project/transfer.mjs` exports
`createProjectRequest`, `inspectProjectRequest` and `inspectProjectReturn`.
The authenticated operator operations are `journey-import`, `journey-list`,
`journey-inspect`, `journey-prepare`, `journey-review-prepare` and `journey-export`.
Actor-scoped assistant credentials cannot import or return project histories.
Existing grants, reservations, expiry, STOP, recovery and source/host bindings
remain mandatory; import and export never clear them.

Before a request is created, imported or prepared, the receiver reserves room
for the complete returned history. The fixed formatter supplies exact result
bytes for this capacity calculation; it does not create an execution receipt.
Each project execution/check enforces that fixed result and at most 16,000 bytes
of canonical observation data. With `R0` and `J0` measured from exact canonical
return/storage envelopes containing null observations, the conservative bounds
are `R0 + 64,000` and `J0 + 128,000`: quoting each observation can expand at most
twice in the return and four times in its stored string. UUIDs and hashes have
fixed ASCII lengths, and all request quoting is measured exactly.

The capacity renderer and checker are pure deterministic, in-memory functions:
no provider call, filesystem write, native execution or grant is involved. The
renderer enforces the worker's existing 300,000-byte per-file ceiling before
admission. A successful native observation has fixed fields, namespace IDs with
at most 20 decimal digits, five nonnegative safe integers, and at most 100 ASCII
stderr characters. Its maximum canonical size is 550 bytes, safely
inside the 16,000-byte allowance; an invalid backend remains fail-closed.

If import refuses this size, it saves no project, starts no execution and
creates or consumes no grant. Keep the original file and existing history;
choose a smaller supported export or input. A preparation refusal creates no
new grant or execution and does not erase earlier work. Never truncate audit
history to make a request fit. An export error must not be interpreted as proof
that no earlier work occurred.

Both bounds must fit the unchanged 4,000,000-byte caps before a grant is prepared.
The maximum stored row is reserved atomically against the existing 32 MB journey
budget, so later imports cannot consume its return headroom. Older unreserved
rows must acquire that reservation before new work. Each pending and completed
row retains its calculated reservation, rather than a fixed 4 MB allocation.
At most 32 rows fit, and eight near-maximum rows exhaust the 32 MB budget;
smaller rows may allow more. Completing a return does not release that reserved
history. A storage refusal saves no new project and creates or consumes no
grant; preserve the original file and retained history. Nothing is discarded
or silently truncated. A backend that violates its
fixed result/observation contract fails before successful completion and retains
the existing uncertain-run/STOP behavior. UTF-8 decoding rejects invalid bytes
and preserves a BOM for the strict JSON parser to reject; it never removes a
marker or replaces bytes before hashing imported files.

The pinned Apache-2.0 Alpha validator closure and retained MIT compiler license
are inventoried in `local-runtime/project/native-source.mjs`. They replay native
Alpha records and verify the exact CSV mapping. They confer no interpreter,
package, host or independent-review trust. Whole Manager/Jobs transfer histories
are retained byte for byte as **unverified historical claims**; Fleet does not
run their source-pinned transfer inspectors. Their respective native receivers
must validate them before making claims about those stages. A checksum proves
byte integrity, not who performed work. Even a structurally valid imported
return remains historical and cannot grant new execution or review authority.

This change is a source implementation, not a replacement for a published ZIP.
`productionQualified` remains false, funded work remains disabled, and exact
saved-package native/EN-FR browser qualification plus physical and independent
economic-review commissioning remain separate release gates.

## Français

Dans le tableau de bord local authentifié, choisissez **Conserver l'historique
d'un même projet Alpha**. Importez la demande du projet, préparez la tâche avec
un Agent actif, examinez-la puis autorisez cette exécution précise. Sélectionnez
ensuite l'exécution terminée et un Node actif pour préparer et autoriser une
vérification interne distincte. Enregistrez le retour et importez-le dans le
même projet Alpha comme preuve interne historique.

Les lignes et doublons du CSV sont conservés; les unités entières ne changent
pas. La route AGIJobManager reste en USDC et la route Jobs v0 reste en $AGIALPHA.
Il n'y a ni conversion automatique, ni affectation de contrat, ni paiement.
Les historiques Manager/Jobs joints sont conservés intégralement comme
déclarations historiques non vérifiées par Fleet. Leurs récepteurs natifs
doivent les valider. L'importation ne restaure aucune permission et ne prouve
pas un examen économique indépendant. Les contrôles de disponibilité, les
autorisations distinctes et l'ARRÊT restent en vigueur. La qualification de
production demeure fausse; les essais physiques ne sont pas remplacés par des
tests de composants.

La place du retour complet est réservée avant toute nouvelle autorisation. Les
limites de 4 000 000 octets restent inchangées. Une demande trop grande est
refusée avant de consommer un travail; les imports suivants ne peuvent pas
occuper la place déjà réservée. Les octets UTF-8 invalides et les fichiers JSON
avec marqueur BOM sont refusés sans normalisation silencieuse.

Le calcul de capacité emploie seulement le rendu et la vérification déterministes
en mémoire, sans fournisseur, écriture de fichier, exécution native ni
autorisation. Chaque fichier produit doit respecter la limite de 300 000 octets.
Les champs bornés d’une observation native réussie occupent au plus 550
octets, sous la réserve de 16 000 octets.

Un refus d’importation pour taille n’enregistre aucun projet, ne lance aucune
exécution et ne crée ni ne consomme d’autorisation. Conservez le fichier original
et l’historique existant; choisissez un export ou des données plus petits et pris
en charge. Un refus de préparation ne crée aucune nouvelle autorisation ou
exécution et n’efface pas les travaux antérieurs. Ne tronquez pas l’historique.
Un échec d’exportation ne signifie pas qu’aucun travail antérieur n’a eu lieu.

Chaque projet en attente ou terminé conserve sa réserve calculée dans le budget
de 32 Mo. La limite reste de 32 entrées; huit entrées proches de 4 Mo épuisent ce
budget, tandis que des entrées plus petites peuvent être plus nombreuses.
Terminer un retour ne libère pas sa réserve. Un refus faute de place ne conserve
aucun nouveau projet, ne crée ni ne consomme d’autorisation. Gardez le fichier
original et l’historique; rien n’est supprimé ni tronqué silencieusement.
