# Install and recover / Installer et reprendre

These are development tools, not a released or fully qualified operator installer. The package must come from the exact reviewed source and have a verified SHA-256. An archive checksum establishes identity, not correctness or authorization. Existing Dedicated Fleet installations use their existing installers.

## English

The installer does not need administrator privileges and does not start a service, activate an actor, connect a provider, install a skill in an assistant, or handle a wallet. Keep the application directory and private state directory separate and outside the source checkout. It accepts only the platform's existing pinned Node 24.21.0 archive; see `fleet/shared/runtime/compute/runtime-artifacts.lock.json`. Linux execution additionally needs the documented supported bubblewrap environment. Copying code on a Mac does not qualify a Mac execution backend.

Use an inspected local package and the exact expected digest, not a digest taken from an untrusted neighboring file:

```sh
python3 local-runtime/install.py inspect --archive /absolute/package.zip --sha256 EXPECTED_SHA256
python3 local-runtime/install.py install --archive /absolute/package.zip --sha256 EXPECTED_SHA256 --node-archive /absolute/node-v24.21.0-linux-x64.tar.xz --root /absolute/fleet-application --state /absolute/fleet-private-state --confirm
python3 local-runtime/install.py launch --root /absolute/fleet-application -- init
python3 local-runtime/install.py launch --root /absolute/fleet-application -- serve
```

The launcher reports the local dashboard address and private credential **file**, never the credential itself. Paste that credential into the local dashboard only. Create and activate an actor, inspect a prepared task, authorize its exact grant, then run. Each additional actor shares the read-only installation without another download.

To maintain software, stop intake and finish or reconcile work, then stop the supervisor. `update` uses the same arguments as `install` with a new package/digest. Old verified versions remain available. `rollback --root /absolute/fleet-application --version PREVIOUS_ARCHIVE_SHA256 --confirm` selects code only. It does not restore credentials, budgets, revocations or consumed grants; changed source requires fresh bindings. `uninstall --root /absolute/fleet-application --confirm` removes only verified owned code. It refuses extra files, active service sockets, pending grants and uncertain runs. Private state and external outputs remain available. Archive packaging, Node binaries and every installed file/mode are verified; arbitrary archives are not imported as state.

If the service was killed, stop its launcher and inspect the process situation. `launch --root /absolute/fleet-application -- recover-service --confirm` refuses a live service or lock holder. For a dead service it may remove only the same private, owned, positively stale socket, persists STOP, revokes unused grants and deactivates actors. Interrupted work stays uncertain. It never kills an unknown process or assumes that missing connectivity proves cleanup.

Restart `serve`, inspect each uncertain attempt and select **Inspect recovery**. Reconciliation is available only for the offline sandbox with recorded process/namespace closure, or an observed different boot identity. Missing proof stays blocked. Explicitly close the attempt **without success**, retaining its evidence and reservation. Then separately resume and activate again. Paid/provider/signer attempts cannot be cleared by this offline procedure.

During a failed stage or atomic pointer switch, the previous complete version remains selected. Maintenance atomically reserves the CLI socket path with a private marker, so even a raw CLI launch cannot start work during an update. A crash can leave this marker, an unselected staging directory or a stale maintenance lock. `recover-maintenance --root /absolute/fleet-application --confirm` releases only a recognized marker/lock whose process has ended or whose recorded boot has changed. It refuses a real service socket, then requires `recover-service --confirm` before restart. Do not delete unrecognized content; leftover stage content requires operator inspection and is deliberately not included in automatic uninstall. Power-loss and physical reboot qualification remain separate evidence gates.

## Français

Cet outil de développement n’est pas un installateur publié ou entièrement qualifié. Il vérifie le paquet et l’archive Node 24.21.0 correspondant à la plateforme. Il n’exige pas de privilèges administratifs, n’active aucun acteur, ne démarre aucun service et ne connecte ni fournisseur ni portefeuille. Gardez les répertoires d’application et d’état privé distincts, hors du code source. Les commandes ci-dessus utilisent des chemins absolus. Sur Linux, l’isolation bubblewrap prise en charge reste nécessaire; une copie sur Mac ne qualifie pas l’exécution macOS.

Après `install`, exécutez séparément `init`, puis `serve`. Le lanceur indique l’adresse locale et le fichier d’identifiant privé. Collez l’identifiant uniquement dans le tableau de bord local. Ajoutez un acteur, activez-le, examinez les données et limites de la tâche, autorisez cette exécution précise, puis lancez-la. Ajouter un rôle ne télécharge pas une autre installation.

Avant une mise à jour ou suppression, suspendez l’entrée de travaux, terminez ou réconciliez les obligations et arrêtez le service. `update` reprend les paramètres d’`install` avec un nouveau paquet. `rollback` sélectionne une version de code vérifiée, sans restaurer les anciennes autorisations ni réinitialiser les budgets. `uninstall` refuse les contenus inconnus et les obligations inachevées; il conserve l’état privé et les résultats externes.

Après un arrêt brutal, `recover-service --confirm` refuse un service encore actif. La reprise d’un service mort conserve l’ARRÊT, invalide les autorisations inutilisées et désactive les acteurs. Les travaux interrompus restent incertains. Redémarrez le service, examinez chaque tentative et choisissez **Examiner la reprise**. Seule une fermeture observée du bac à sable hors ligne, ou un redémarrage du système effectivement observé, permet de clore la tentative sans réussite. Les preuves et réservations sont conservées. La reprise, l’activation et les nouvelles autorisations restent des décisions séparées. Ce parcours ne réconcilie jamais un paiement, une signature ou une requête fournisseur.

Pendant la maintenance, le chemin de connexion du service est réservé pour empêcher aussi un lancement direct par CLI. Une interruption peut laisser cette réservation ou un dossier temporaire non sélectionné. `recover-maintenance --root /absolute/fleet-application --confirm` ne libère qu’une réservation reconnue dont le processus est terminé ou dont le système a redémarré; exécutez ensuite `recover-service --confirm`. Le code précédemment sélectionné reste complet. Inspectez les contenus inconnus; aucune suppression large n’est effectuée. La qualification après panne d’alimentation et sur matériel physique reste à réaliser.
