# Local Skills · Start here / Commencer

## What works in this development preview

The source includes six portable skills, a single local supervisor, actor-scoped clients, exact one-use grants, an English/French loopback dashboard, bounded offline report generation, internal checking, formal protocol inspection, inert role portability and the existing SUCCESSOR capsule format.

It is **not a qualified operator release**. The full handoff remains open. Linux browser/desktop execution, live model routing, OpenClaw skill invocation, native Mac local execution, independent economic review and paid work are disabled or unimplemented. See the [complete acceptance matrix](acceptance.json), which does not turn synthetic tests into native evidence.

## Prepare an engineering checkout

Use Node >=24.19.0 and <25; the existing evaluated target remains 24.21.0. Linux native tests target x86-64 and ARM64 with the distribution's trusted `bubblewrap` and `util-linux` packages and working user namespaces. Do not disable operating-system security to make a failed diagnostic pass. On an unsupported host, configuration inspection remains useful; execution stays blocked.

Ubuntu 24.04 can additionally require its packaged, capability-denying `bwrap-userns-restrict` AppArmor profile. The engineering workflow loads that distribution profile only on disposable GitHub-hosted VMs and records its digest and unchanged namespace restrictions. It neither disables AppArmor nor shares the host network. The native tests still require blocked host-file access, immutable inputs, isolated networking, zero child capabilities, and actual output bytes. Loading a prerequisite is not a passing test. Earlier failures remain in the validation record.

The CI provisioner is intentionally unavailable on operator machines. An administrator must assess the distribution profile and other applications using Bubblewrap before changing an everyday computer. See [Ubuntu's explanation of the purpose-built Bubblewrap policy](https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007). Guided operator provisioning remains part of the unfinished installer work.

```sh
npm ci --prefix fleet --ignore-scripts --omit=dev
node local-runtime/validate.mjs
node local-runtime/cli/main.mjs init
node local-runtime/cli/main.mjs serve
```

Run these commands from the repository root. This installs the existing lockfile's dependencies without install scripts. It does not download OpenClaw, create accounts, enable a startup service, import a wallet, enroll protocol identities or perform paid inference. Node dependencies inside `fleet/` are an engineering work area: run the legacy exact source inventory check from a clean checkout, before dependency installation.

`init` requires an absent state directory. The default is `~/.local/state/agi-fleet-local`, outside the checkout. To use another fresh directory, set `AGI_LOCAL_STATE` in your terminal. Do not select an existing Fleet/OpenClaw state directory. Live state and credentials must never be committed or copied into skills.

The launcher prints the exact loopback dashboard URL and the path of a private operator credential. Open the URL and paste that credential into the dashboard. Never put it in a URL, chat, screenshot or support report. The page retains it only in memory. Keep the operator credential away from model-controlled environments.

1. Check this computer. A failure is a blocked operation with an explanation.
2. Add an Agent. Add more actors without another runtime download.
3. Activate the actor on the observed host.
4. Prepare the synthetic report. Inspect the exact task and limits.
5. Authorize, then run once. Inspect and save the actual output files.
6. Learn “Pause new work,” actor STOP and host STOP before further work.

The preview makes **zero model calls** and has **zero USDC spending authority**. It executes only the reviewed deterministic operations. It is not a general arbitrary-code or AI Computer Use engine. Existing Computer Use remains in Dedicated Fleet and the separately labeled native-workstation previews.

## STOP, recovery and portability

Pause blocks new preparation while accepted work can drain. STOP first revokes outstanding grants, persists a stopped state, and requests termination. The service records exit status and positive process-group cleanup. A failure or interrupted reservation is uncertain and blocks the host. Restart never repeats a consumed grant. Resume of a clean stopped host requires fresh activation and new grants.

**Uncertain-run reconciliation is not implemented in this preview.** Preserve the state and evidence for engineering inspection. Do not edit the SQLite ledger, remove a STOP condition, or replay the grant. A stale Unix socket likewise requires verified operator recovery; the launcher will not delete it or take over another process's endpoint.

“Export role” copies only a positive allowlist of role configuration. It does not include credentials, host bindings, grants, running state, SQLite files or wallets. Import requires confirmation, checks package identity, and creates a new inactive actor. It restores no authority. Save work products separately from the outputs panel. SUCCESSOR export/import uses the original checked capsule format and does not execute imported code or authorize a rerun.

The installation owns no external accounts or global services. To remove a source preview, first stop its process and inspect outstanding work, preserve output files and the private ledger, then remove only the reviewed source checkout. Do not delete user data, shared dependencies, a Dedicated Fleet installation or another OpenClaw profile. Automatic upgrade, installer switching and uninstall are still pending.

## Français

Ce parcours ajoute un mode à Fleet. Il ne remplace ni l’installation dédiée ni les fonctions existantes. Une installation locale peut héberger plusieurs acteurs, y compris plusieurs instances d’un même rôle. Chaque acteur possède sa propre identité et ses autorisations; les travailleurs ne reçoivent que les données de leur tâche.

Cette version est un **aperçu de développement, pas une version qualifiée**. Les tâches locales avec navigateur ou bureau, les modèles en ligne, l’intégration OpenClaw, le mode local Mac et l’examen économique indépendant restent désactivés ou à implémenter. N’utilisez pas cet aperçu pour du travail rémunéré.

Dans une copie de développement, exécutez les quatre commandes ci-dessus. Ouvrez l’adresse locale affichée, puis choisissez **Français**. Vérifiez l’ordinateur, ajoutez un Agent, activez-le, préparez l’exemple, examinez les limites, autorisez et exécutez. Enregistrez les fichiers réellement produits. Aucun portefeuille financé n’est nécessaire; l’exemple n’utilise aucun modèle payant.

Les identifiants restent privés. Ne les mettez jamais dans une conversation, une URL ou un fichier partagé. Un contrôle interne ne constitue pas un examen indépendant. L’importation d’un rôle crée un nouvel acteur inactif et ne rétablit aucune autorisation.

L’arrêt persiste après un redémarrage et n’annule pas une action passée. Un résultat incertain bloque la reprise; conservez le registre pour examen. La réconciliation automatique, l’installation transactionnelle et la désinstallation guidée restent à développer. Les limites exactes figurent dans la matrice d’acceptation.
