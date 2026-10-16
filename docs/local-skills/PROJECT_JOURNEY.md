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
