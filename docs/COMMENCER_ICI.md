# Commencer ici : choisir votre parcours Fleet

[English](START_HERE.md) · [Présentation du dépôt](../README.md) · [Accueil guidé en français](https://montrealai.github.io/AGI-Fleet-Linux/start-fr.html)

**Commencez par le Builder gratuit dans votre navigateur pour explorer. Choisissez un installateur publié uniquement lorsque vous êtes prêt à qualifier un ordinateur séparé.** Un aperçu de développement n'est pas un installateur terminé.

## Choisir un point de départ

| Votre objectif | Point de départ | À quoi vous attendre |
| --- | --- | --- |
| Essayer une mission locale utile sans installation. | [Builder SUCCESSOR Ω en français](https://montrealai.github.io/AGI-Fleet-Linux/successor-fr.html) | Les deux familles de missions locales ne nécessitent ni compte, ni portefeuille, ni clé de fournisseur. Conservez les fichiers et la capsule téléchargés. |
| Préparer un travailleur ou un réviseur sur un ordinateur Linux dédié. | [Installation Linux](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.1.1-qualification/docs/FRESH_INSTALL.md) | Utilisez la **préversion de qualification Linux 1.1.1** publiée, puis consignez l'état de préparation de votre propre machine. |
| Préparer un Mac Apple silicon. | [Installation Mac](../macos/docs/FRESH_INSTALL.md) | Utilisez la **préversion de qualification Mac 1.20.2**, distincte, et les instructions Mac. Les résultats Linux ne qualifient pas un Mac. |
| Relier le Builder à un Agent et à un Node Fleet installés. | [Connexion, révision et récupération](../successor/docs/GUIDE.md) | Inspectez le travail exact, autorisez son exécution, autorisez séparément la révision, vérifiez la capsule et choisissez délibérément une version. |
| Développer des skills portables et plusieurs rôles locaux isolés. | [Télécharger et essayer Local Skills](local-skills/DOWNLOAD.md#français) | Aperçu Linux distinct et limité, avec vérification du paquet, installation privée et guide EN/FR. Le produit complet reste inachevé; cet aperçu est hors de l’installateur Linux 1.1.1. |
| Développer du travail dans des applications installées ou des comptes connectés. | [Aperçu Linux](../workstation/QUICKSTART.md) ou [aperçu Mac](../macos/preview/README.md) | Ce sont des parcours distincts de développement et de qualification. Ne les utilisez pas dans votre compte quotidien et ne présumez pas que le règlement de travaux privés est pris en charge. |

Les guides techniques de destination peuvent être en anglais. Les accueils guidés du site et les deux Builders proposent des parcours français.

## Vous installez Fleet ? Suivez cet ordre

1. **Choisissez d'abord le guide de votre plateforme.** Suivez-le dans l'ordre sur un ordinateur propre et compatible. Séparez le compte de signature du compte de calcul. Ne mélangez ni commandes Linux et Mac, ni instructions de versions différentes.
2. **Téléchargez l'installateur, pas l'archive « Source code » de GitHub.** Pour Linux, prenez `AGI_Fleet_Linux_v1.1.1.zip` et `SHA256SUMS-v1.1.1.txt` dans la [même publication](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.1-qualification). Suivez le guide pour vérifier et extraire les fichiers. Une archive de sources de révision CI n'est pas non plus un installateur.
3. **Terminez les vérifications et consignez vos observations.** Utilisez le [registre de qualification Linux](PHYSICAL_QUALIFICATION.md) ou la liste propre au Mac. Les tests automatisés publiés ne prouvent pas que votre ordinateur, votre connexion au fournisseur, vos permissions de bureau ou votre nettoyage sont prêts.
4. **Gardez les travaux financés désactivés tant que la qualification reste ouverte.** Utilisez les entrées publiques ou synthétiques autorisées par le parcours choisi. Installer Fleet, ouvrir une capsule ou examiner une action proposée ne donne aucune autorité d'exécution, de signature ou de paiement.
5. **Séparez les éléments de récupération.** Conservez les fichiers du projet, les livrables exportés et la capsule SUCCESSOR. Suivez séparément la procédure documentée de récupération du portefeuille. Une capsule ne remplace pas une sauvegarde de portefeuille; restaurer l'historique ne rétablit pas l'autorisation d'exécuter ou de dépenser.

Le [manifeste Linux publié](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.1.1-qualification/Release-Manifest-v1.1.1.json) et le [manifeste Mac publié](../macos/published-release.json) précisent la portée de chaque archive. Les versions ci-dessus correspondent aux manifestes publiés à ce point de documentation. Une nouvelle révision des sources ne remplace pas silencieusement ces téléchargements.

## Comprendre l'état avant de démarrer

**Préversion de qualification publiée** : les vérifications automatisées indiquées ont réussi pour une archive précise. Linux 1.1.1 et Mac 1.20.2 ne sont pas qualifiés pour la production. L'installation physique, la participation réelle d'un fournisseur, l'utilisabilité humaine et l'endurance exigent leurs propres observations.

**Aperçu de développement** : une partie de l'implémentation ou de l'acceptation reste inachevée. Dans la PR Local Skills #26, les composants assistant et cycle de vie terminés ne complètent pas les adaptateurs navigateur/bureau et Mac natif, le placement des réviseurs indépendants, l'intégration protocole/signataire, les protections de restauration entre machines ou l'ensemble des ressources et du parcours d'accueil. Consultez la matrice d'acceptation actuelle de la PR plutôt que de transformer un ancien total de tests en preuve de publication.

**Vérification interne** : elle ne garantit pas une révision administrée indépendamment. Un deuxième rôle, processus ou modèle ne suffit pas à établir cette indépendance. Respectez les règles de révision et d'admissibilité du travail concerné.

**STOP, HOLD, bloqué ou incertain** : arrêtez et suivez l'explication. Ne supprimez pas manuellement un marqueur STOP, n'affaiblissez pas les permissions, ne contournez pas une vérification et ne rejouez pas une ancienne autorisation pour afficher artificiellement un état vert.

## Un échec ?

Préservez l'état courant, les rapports et les marqueurs STOP. Consultez le [dépannage Linux](TROUBLESHOOTING.md) ou le [dépannage Mac](../macos/docs/TROUBLESHOOTING.md). Notez la plateforme, la version exacte, le rôle, l'étape et le code d'erreur visible. Partagez uniquement des diagnostics expurgés : jamais de phrase de récupération, de clé privée, de jeton OAuth, de fichier JSON privé de configuration ou de document de travail privé.

Pour récupérer un projet, commencez par le [guide du Builder](../successor/docs/GUIDE.md). Importez l'historique, examinez la version choisie et ne restaurez ou ne relancez une exécution qu'avec une nouvelle autorisation explicite. Conservez la version fonctionnelle jusqu'à l'acceptation délibérée d'une amélioration vérifiée.

## Pages utiles

[Installation Linux](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.1.1-qualification/docs/FRESH_INSTALL.md) · [Installation Mac](../macos/docs/FRESH_INSTALL.md) · [Guide SUCCESSOR](../successor/docs/GUIDE.md) · [Preuves de publication](../validation/LINUX_1_1_1_RELEASE_ADDENDUM.md) · [Développement et publication](DEVELOPMENT.md)

## Nouveautés de Linux 1.1.1

La **préversion de maintenance Linux 1.1.1 publiée** améliore les guides de démarrage anglais/français et la vérification des publications. Suivez son [guide d’installation correspondant](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.1.1-qualification/docs/FRESH_INSTALL.md). Consultez les [notes de version](RELEASE_NOTES_1_1_1.md) et les [résultats de publication vérifiés](../validation/LINUX_1_1_1_RELEASE_ADDENDUM.md), en anglais. Le [guide précédent de la version 1.1.0](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.1.0-qualification/docs/FRESH_INSTALL.md) reste disponible pour cette version.
