# Try the Local Skills preview / Essayer l’aperçu Local Skills

[English](#english) · [Français](#français) · [Capabilities and remaining work](CURRENT_STATUS.md)

**Version 0.1.0-alpha.1 · Linux x64 / ARM64 · development preview.** This separate package runs a bounded offline report, internal checking and six scoped skills. It is not the completed Local Skills product or a production-qualified installer. Funded work, general browser/desktop execution, native Mac local execution and independent economic review are disabled. The example makes no model calls.

## English

### 1. Check the computer and download

Use a supported Linux test account with Python **3.11 or newer**, `sha256sum`, and working unprivileged user namespaces. The exercised hosts are Ubuntu 24.04 x64 and ARM64. Linux execution needs trusted distribution `bubblewrap` and `util-linux` packages, plus the distribution's applicable AppArmor policy. Ask the administrator to assess these prerequisites if needed; [host guidance](START_HERE.md#prepare-an-engineering-checkout) explains the boundary. Do not run the CI provisioner on an everyday machine or disable operating-system security.

Open the [Local Skills preview release](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v0.1.0-local-skills-preview.1). Under **Assets**, save these two files into a new download folder:

- `agi-fleet-local-0.1.0-alpha.1.zip`
- `SHA256SUMS-local-0.1.0-alpha.1.txt`

The release also contains `Local-Skills-Manifest-0.1.0-alpha.1.json` and `Local-Skills-Evidence-0.1.0-alpha.1.zip` for inspection. If publication has not completed and the named assets are absent, wait for the release; do not substitute GitHub's automatic **Source code** archives. Those omit the packaged dependencies. Existing Dedicated Fleet users should follow their separate [Linux](../START_HERE.md) or [Mac](../../macos/docs/FRESH_INSTALL.md) guide.

### 2. Verify before extracting

Open a terminal **in the download folder**. Keep this terminal for the commands below:

```sh
sha256sum --check --ignore-missing SHA256SUMS-local-0.1.0-alpha.1.txt
```

Continue only if it exits successfully and explicitly reports `agi-fleet-local-0.1.0-alpha.1.zip: OK`. Missing optional evidence/manifest files are ignored. A mismatch, missing ZIP or unreadable checksum is a reason to stop and download again from the release page. A matching hash establishes the published bytes, not production readiness.

```sh
AGI_PREVIEW_DOWNLOAD="$PWD"
AGI_PREVIEW_SHA=$(sha256sum agi-fleet-local-0.1.0-alpha.1.zip | cut -d ' ' -f 1)
python3 -m zipfile -e agi-fleet-local-0.1.0-alpha.1.zip unpacked
cd unpacked/agi-fleet-local-0.1.0-alpha.1
```

### 3. Download the matching Node prerequisite

The preview includes locked JavaScript dependencies. **Node itself is a separate prerequisite**, installed privately by the launcher; you do not need to install Node globally. Run `uname -m` and choose exactly one row. Save that Node archive in the same original download folder. Do not extract it yourself.

| `uname -m` | Node 24.21.0 archive | Expected SHA-256 |
| --- | --- | --- |
| `x86_64` | [node-v24.21.0-linux-x64.tar.xz](https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz) | `fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6` |
| `aarch64` | [node-v24.21.0-linux-arm64.tar.xz](https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.xz) | `6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2` |

The installer verifies that pinned digest and the actual Node version before selecting the application. Any other architecture or archive remains blocked.

### 4. Install privately, then start deliberately

The commands below are for **x64**. On ARM64, replace only `linux-x64` with `linux-arm64` in the Node filename. Choose fresh application and state directories; never reuse an existing Fleet/OpenClaw state directory. No administrator privileges are needed for this application installation.

```sh
python3 local-runtime/install.py inspect \
  --archive "$AGI_PREVIEW_DOWNLOAD/agi-fleet-local-0.1.0-alpha.1.zip" \
  --sha256 "$AGI_PREVIEW_SHA"
python3 local-runtime/install.py install \
  --archive "$AGI_PREVIEW_DOWNLOAD/agi-fleet-local-0.1.0-alpha.1.zip" \
  --sha256 "$AGI_PREVIEW_SHA" \
  --node-archive "$AGI_PREVIEW_DOWNLOAD/node-v24.21.0-linux-x64.tar.xz" \
  --root "$HOME/agi-local-preview-app" \
  --state "$HOME/agi-local-preview-state" --confirm
python3 local-runtime/install.py launch --root "$HOME/agi-local-preview-app" -- init
python3 local-runtime/install.py launch --root "$HOME/agi-local-preview-app" -- serve
```

Keep the terminal running. Open the exact local dashboard URL printed by the launcher. It also prints the path of a private credential file; paste that credential into the local dashboard only. Never share it in chat, a URL, a screenshot or a support report. No provider, wallet, startup service or actor is activated by installation.

### 5. Make your first report

1. Choose **English** or **Français**, then check this computer. Read any blocked-state explanation before continuing.
2. Add an **Agent**, activate it and prepare the example report.
3. Inspect the public input and limits. Authorize the exact work, then run it once.
4. Inspect and save its real output files. Internal checking is separately authorized; it does not establish independent review.
5. Learn **Pause new work** and **STOP**. To end a clean session, pause intake, finish accepted work, stop the host, then stop the terminal process. For an uncertain result, preserve state and follow [recovery](INSTALL_AND_RECOVER.md); never replay a grant.

For help, choose **Preview support report**, inspect its contents and **Save this report** if useful. It excludes credentials, actor identities, task inputs and outputs. Nothing is uploaded automatically. See [install/update/rollback/removal](INSTALL_AND_RECOVER.md), [OpenClaw setup](OPENCLAW_CLIENT.md) and [what remains unfinished](CURRENT_STATUS.md).

## Français

**Cet aperçu de développement Linux reste limité et non qualifié pour la production.** L’exemple produit un rapport hors ligne sans appel à un modèle ni dépense. Le travail rémunéré, le bureau/navigateur général, le mode local Mac et l’examen économique indépendant restent désactivés.

1. **Préparez un compte Linux de test compatible.** Python 3.11+, `sha256sum`, `bubblewrap`, `util-linux` et les espaces de noms utilisateurs doivent fonctionner. Les essais portent sur Ubuntu 24.04 x64/ARM64. Demandez à l’administrateur d’évaluer les prérequis système et AppArmor; ne désactivez pas la sécurité pour obtenir un résultat vert.
2. **Téléchargez les deux fichiers nommés à l’étape 1** depuis la [publication Local Skills](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v0.1.0-local-skills-preview.1). N’utilisez pas « Source code ». Si les fichiers ne sont pas encore publiés, attendez la fin de la qualification.
3. **Ouvrez le terminal dans le dossier de téléchargement**, puis exécutez les commandes de l’étape 2. Continuez uniquement si la vérification réussit et affiche le nom du ZIP suivi de `OK`. Le manifeste et les preuves sont facultatifs pour ce téléchargement; une erreur sur le ZIP impose l’arrêt.
4. **Choisissez Node dans le tableau de l’étape 3.** `x86_64` correspond à x64; `aarch64` correspond à ARM64. Enregistrez l’archive Node dans le dossier initial, sans l’extraire. L’installateur vérifie son empreinte et sa version; aucune installation Node globale n’est nécessaire.
5. **Exécutez l’étape 4 dans le même terminal.** Sur ARM64, remplacez `linux-x64` par `linux-arm64`. Les dossiers d’application et d’état doivent être nouveaux, distincts et privés. L’installation ne demande pas de droits administratifs et n’active ni acteur, ni fournisseur, ni portefeuille, ni démarrage automatique.
6. **Gardez le terminal ouvert et ouvrez l’adresse locale affichée.** Collez l’identifiant privé uniquement dans le tableau de bord, puis choisissez **Français**. Vérifiez l’ordinateur, ajoutez et activez un Agent, préparez l’exemple, examinez les limites, autorisez et exécutez une seule fois. Enregistrez les fichiers produits.
7. **Pour arrêter**, suspendez les nouvelles demandes, terminez les travaux acceptés, arrêtez l’hôte puis le processus. Si un résultat reste incertain, conservez l’état et suivez [Installer et reprendre](INSTALL_AND_RECOVER.md#français). Ne rejouez aucune ancienne autorisation.

Pour demander de l’aide, choisissez **Prévisualiser le rapport d’assistance**, examinez-le, puis **Enregistrer ce rapport**. Aucun téléversement automatique n’a lieu. Les [limites actuelles](CURRENT_STATUS.md#français) et les 22 exigences du produit complet restent visibles.
