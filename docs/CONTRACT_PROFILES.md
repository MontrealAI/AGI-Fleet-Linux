# Explicit Manager contract profiles / Profils de contrats Manager explicites

## English

### Current-source addition: Manager 1.19.3

The new `manager-1.19.3-d0c2cbaf` profile pins published Manager source
`d0c2cbaf58b594e20d888c3fc744bada06172306`. It adds the complete eleven-artifact
bundle, compiler inputs, eleven production-source digests and locked-build
receipt. Its source graph passed exact recompilation and 792 Manager
regressions locally. The compiled settings retain Solidity 0.8.37, viaIR,
40 optimizer runs, Shanghai and the reviewed Yul optimizer mitigation.

This is an additive **Linux 1.1.5 / Local Skills alpha.6 source candidate**.
It requires its own saved-archive native, browser, integration and audit gates
before publication. The 1.1.5 release requires both this profile and the
preserved 1.17.0 profile on x64 and ARM64; an older profile observation cannot
substitute for the new graph. Omission still selects the unchanged legacy
profile. Selecting any explicit profile requires a fresh reviewed enrollment
and authorization binding; no deployment is automatically selected, migrated,
activated or modified. Previous deployments remain read-only.

The published 1.1.4 observations below are historical and remain unchanged.

This additive profile support is included in the [published Linux 1.1.4 qualification installer](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.4-qualification). Its exact saved archive passed the separate 792-test Manager 1.17.0 profile integration on both architectures; [published evidence and remaining gates](../validation/LINUX_1_1_4_RELEASE_ADDENDUM.md) identify the accepted bytes. This does not deploy or migrate a contract, qualify physical operation or authorize funded work. Earlier saved releases and their historical integration harness remain unchanged.

### Choose a complete graph

- Omit `contractProfile` to retain the existing `db876a8021da6afcf7aa974489d13374e6d188b5` contract graph, historical pin format and unchanged authorization/preparation hashes. The existing 1.16-derived integration target stays separate.
- `"contractProfile": "manager-legacy-db876a8"` explicitly selects that same legacy graph. Explicit selection changes the authorization hash and requires a new reviewed enrollment/activation.
- `"contractProfile": "manager-1.17.0-b7218196"` selects the complete Manager 1.17.0 graph from `b721819639668f0074c244d516bbbe0cf57329a7`. It requires that exact Manager and all eight linked libraries. It never automatically selects a graph based on returned chain code.

Use the optional top-level field in the Agent, Node or operator configuration. All other configuration fields and safety requirements remain in force. No custom path, hash, ABI, artifact or per-library override is accepted. A default/legacy configuration refuses the changed 1.17 graph; selecting 1.17 refuses a legacy ENSOwnership library even when the Manager ABI is identical.

The new profile ships the exact eleven artifacts, complete compiler input, production-source digests and locked-build receipt. The fixed profile manifest binds all these bytes. Each explicit enrollment pin includes the profile ID and manifest SHA-256; verification checks that identity, the exact nine-member deployed graph, links, immutable values and code hashes before signing. Existing activation and preparation hashes cannot authorize a changed selection. Chain/wallet leases, manager/job sharding, signer identity, budgets, journals and STOP state are not reset or partitioned by profile.

Exact matching of a legacy deployment is a compatibility observation, **not a statement that its contracts are safe or upgraded**. The new ENS ownership protections are different deployed bytecode. This work does not change any deployed contract. Review the actual deployment and its entire library graph before considering funded operation.

### Source-only validation

From a reviewed Fleet checkout with its inventories refreshed, an exact clean Manager checkout already built from its lockfiles, and the pinned Node 24.21.0 executable:

```sh
python3 engineering/run-profile-integration.py \
  --fleet /ABSOLUTE/PATH/Fleet/fleet \
  --manager /ABSOLUTE/PATH/AGIJobManager \
  --contract-profile manager-1.17.0-b7218196 \
  --node /ABSOLUTE/PATH/node-v24.21.0-linux-x64/bin/node \
  --evidence /ABSOLUTE/PATH/absent-profile-evidence
```

This additive runner compares all eleven production source files and all eleven artifact ABIs, creation/runtime bytecode, links and immutable offsets. It reproduces both bundles, retains all eight legacy standalone integrations, runs the explicitly selected profile through the fresh Agent/three-Node lifecycle, and requires all 792 Manager tests for the pinned 1.17 source. It checks source inventory integrity before and after execution. The test chain is in-process ID 31337 with deterministic fixture wallets and mock USDC; it cannot establish public-chain deployment, provider billing, independent operators or physical installation.

Keep `engineering/run-job-integration.py`, its hash-locked Linux/Mac adapters, old source bundles, release pointers and prior evidence unchanged. Saved-installer qualification requires a new exact archive, updated measured test cardinalities, both architectures, browser gates and independent review. Source-only PASS does not satisfy those gates.

### Additive saved-archive CI gate

Use `engineering/run-next-profile-integration.py` separately on Linux x64 and arm64. Its inputs are the exact candidate ZIP and `release.json` from that run's build artifact, the reviewed engineering checkout matching that candidate, Node 24.21.0 verified against the existing architecture-specific archive pin, and a separately prepared clean Manager checkout at `b721819639668f0074c244d516bbbe0cf57329a7`. Prepare that Manager with locked root and `hardhat` `npm ci --ignore-scripts --no-audit --no-fund`, run `node scripts/security/patch-openzeppelin-compiler.cjs`, then `npm run build`, all using the pinned Node. The adapter does not install or fetch anything and rejects another Manager commit.

After those inputs exist, the additive CI command is:

```sh
python3 engineering/run-next-profile-integration.py \
  --metadata "$GITHUB_WORKSPACE/release/release.json" \
  --archive "$GITHUB_WORKSPACE/release/AGI_Fleet_Linux_v1.1.4.zip" \
  --work "$RUNNER_TEMP/profile-work-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" \
  --evidence "$RUNNER_TEMP/profile-evidence-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" \
  --manager "$RUNNER_TEMP/manager-b7218196" \
  --node "$PINNED_NODE_HOME/bin/node" \
  --contract-profile manager-1.17.0-b7218196
```

Work and evidence directories must be absent, canonical, separate, and outside both reviewed repositories. Preserve the entire evidence directory with an `always()` artifact upload, including failures. The adapter verifies the candidate and all seven edition manifests, extracts **every archive member**, and exercises the same twelve profile steps against that complete extraction. Every file, executable bit and directory is checked against the ZIP before and after, including dependencies, docs and generated metadata. Added files, changed files, missing files, links and a changed archive fail closed; a copied source-only subset cannot pass. Integrity checks also run when a test fails, and logs are retained.

The outer `summary.json`, `candidate-binding.json`, `archive-members.json` and nested `profile-integration/` logs bind the archive, selected profile, Manager commit and source revision. The outer summary must report `PASS` and `completeArchiveUnchanged: true`; the independent audit must also check all nested step/log hashes, the 792 Manager tests, selected-profile lifecycle and both architectures. This additive gate does not replace the historical 780-test legacy integration, complete native suite, browser, physical or operator gates. Its classification explicitly remains local mock-chain validation, with `productionQualified: false`. CI/audit wiring and execution on a real candidate are separate from the source implementation.

Maintain the canonical module and profile bundle under `fleet/shared/runtime/`. Run `fleet/scripts/sync-shared-runtime.py`, `fleet/scripts/sync-contract-profiles.py` and `fleet/scripts/sync-shared-operator.py` after source changes, then their `--check` modes. The profile adapter check covers all fourteen standalone/nested Agent and Node code roots; the shared checks cover all six editions and root operator code.

## Français

Le nouveau profil `manager-1.19.3-d0c2cbaf` fixe la source Manager publiée
`d0c2cbaf58b594e20d888c3fc744bada06172306`, ses onze artefacts, les entrées
du compilateur, les empreintes des sources et le reçu de compilation verrouillée.
Sa recompilation exacte et les 792 régressions Manager ont réussi localement.
Solidity 0.8.37, viaIR, 40 passages, Shanghai et l’atténuation Yul sont conservés.

Il reste un ajout source candidat Linux 1.1.5 / Local Skills alpha.6 jusqu’à
ses propres essais d’archive, natifs, navigateur, intégration et audit. Les
profils 1.17.0 et 1.19.3 doivent chacun réussir sur x64 et ARM64. Le profil
historique par défaut et les observations publiées 1.1.4 ci-dessous sont
préservés. Aucun déploiement n’est choisi, migré, activé ou modifié; les
anciens déploiements restent en lecture seule et tout nouveau profil explicite
exige de nouveaux liens d’inscription et d’autorisation examinés.

Ces profils sont inclus dans l’[installateur de qualification Linux 1.1.4 publié](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.4-qualification). Son archive exacte a réussi l’intégration distincte de 792 tests Manager 1.17.0 sur les deux architectures; les [preuves publiées et exigences restantes](../validation/LINUX_1_1_4_RELEASE_ADDENDUM.md) identifient les fichiers acceptés. Cela ne déploie ni ne migre de contrat, ne qualifie aucune installation physique et n’autorise aucun travail financé. Les versions antérieures et leur banc d’intégration historique restent inchangés.

### Choisir un ensemble complet

- Sans champ `contractProfile`, le graphe historique `db876a8021da6afcf7aa974489d13374e6d188b5`, le format d’inscription et les empreintes d’autorisation/préparation restent identiques. La cible d’intégration dérivée de 1.16 reste distincte.
- `"contractProfile": "manager-legacy-db876a8"` sélectionne explicitement ce graphe historique. Ce choix modifie l’empreinte d’autorisation et exige une nouvelle inscription/activation examinée.
- `"contractProfile": "manager-1.17.0-b7218196"` sélectionne le graphe complet Manager 1.17.0 à la révision `b721819639668f0074c244d516bbbe0cf57329a7`, avec ses huit bibliothèques liées exactes. Aucun graphe n’est sélectionné automatiquement à partir du code observé sur la chaîne.

Ce champ facultatif se place au premier niveau de la configuration Agent, Node ou opérateur. Les autres champs et contrôles de sécurité restent obligatoires. Aucun chemin, hachage, ABI, artefact ou remplacement de bibliothèque personnalisé n’est accepté. Une configuration historique refuse le graphe 1.17; le profil 1.17 refuse une ancienne bibliothèque ENSOwnership, même si l’ABI Manager est identique.

Le profil lie les onze artefacts, les entrées complètes du compilateur, les empreintes des sources de production et le reçu de compilation verrouillée. Chaque inscription explicite comprend l’identifiant du profil et le SHA-256 du manifeste. Avant toute signature, la vérification contrôle cette identité, les neuf contrats exacts, leurs liens, leurs valeurs immuables et leurs empreintes de code. Une ancienne autorisation ou préparation ne permet pas de changer de profil. Les verrous chaîne/portefeuille, la répartition des tâches, l’identité du signataire, les budgets, les journaux et STOP ne sont ni réinitialisés ni séparés par profil.

La correspondance exacte d’un ancien déploiement est une observation de compatibilité, **pas une garantie de sécurité ou de mise à niveau**. Les protections ENS 1.17 nécessitent un bytecode différent. Ce travail ne modifie aucun contrat déployé. Le déploiement réel et toutes ses bibliothèques doivent être examinés avant d’envisager des fonds réels.

### Validation du code source

La commande ci-dessus utilise un miroir Fleet avec inventaires à jour, un checkout Manager exact et propre déjà compilé depuis ses fichiers verrouillés, Node 24.21.0 et un dossier de preuves absent. Elle vérifie exactement les onze sources et onze artefacts, reproduit les deux ensembles, conserve les huit intégrations historiques, exécute le cycle Agent/trois Nodes avec le profil explicite et exige les 792 tests Manager de la révision 1.17. L’inventaire est revérifié après exécution.

La chaîne de test locale 31337 utilise des portefeuilles déterministes et un USDC simulé. Un résultat PASS du code source ne qualifie pas un installateur, les fournisseurs réels, les opérateurs indépendants ou une installation physique. Une nouvelle archive exacte, les cardinalités de tests mesurées, les deux architectures, les parcours navigateur et l’examen indépendant restent nécessaires. Ne modifiez pas le banc historique, ses adaptateurs Linux/Mac verrouillés, les anciens contrats ou les preuves publiées.

### Contrôle CI supplémentaire de l'archive

La commande `run-next-profile-integration.py` ci-dessus doit être exécutée séparément sur Linux x64 et arm64, avec le ZIP exact et son `release.json` issus de la même compilation, Node 24.21.0 vérifié et le checkout Manager exact déjà préparé depuis ses deux fichiers verrouillés. Les dossiers de travail et de preuves doivent être absents, canoniques, séparés et hors des deux dépôts. Aucun téléchargement ni installation n'est effectué par cet adaptateur.

L'adaptateur vérifie les sept manifestes, extrait tous les membres du ZIP et exécute les douze étapes sur cette archive complète. Les fichiers, dépendances, documents, métadonnées, droits d'exécution et répertoires sont contrôlés avant et après, même en cas d'échec. Toute modification, absence, addition ou lien provoque un échec. Un sous-ensemble copié du code source n'est jamais accepté comme preuve d'archive. Conservez toutes les preuves avec une publication d'artefact CI `always()`. L'audit indépendant doit vérifier les deux architectures, les empreintes des journaux, les 792 tests et le cycle avec le profil sélectionné. Ce contrôle supplémentaire ne remplace aucun contrôle historique, natif, navigateur, physique ou opérateur et ne qualifie pas la production. Son raccordement CI/audit et son exécution réelle restent distincts de cette implémentation source.
