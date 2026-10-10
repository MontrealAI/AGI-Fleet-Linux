# Fleet + AGIJobManager : quel potentiel ensemble ?

[English](POTENTIAL_AND_SCOPE.md) · [Site Fleet](https://montrealai.github.io/AGI-Fleet-Linux/fr.html) · [Installation](FRESH_INSTALL.md) · [État actuel de qualification](../engineering/current-release.json)

**AGI Fleet Linux et AGIJobManager pourraient constituer ensemble une infrastructure généraliste pour le travail numérique rémunéré.** Fleet fournit l'environnement d'exécution et de vérification; AGIJobManager fournit les règles de financement, de participation et de règlement. Le même cadre peut accueillir de nombreux livrables à mesure que progressent les outils, les permissions et les compétences mesurées des opérateurs.

**Accomplir la majorité du travail qu'un humain peut effectuer avec un clavier, une souris et un écran reste une ambition à long terme. Les versions Linux actuelles n'ont pas démontré cette étendue de capacités.** Ce guide présente le potentiel, les limites actuelles et les preuves nécessaires pour élargir le périmètre.

## Comment les deux systèmes collaborent

| Composant | Sa contribution | Ce qu'il faut encore établir |
| --- | --- | --- |
| **Agent Fleet** | Produit le livrable déclaré avec les outils de programmation, de fichiers et de bureau disponibles, dans les permissions et budgets du travail. | Cet environnement précis peut-il accomplir cette tâche correctement et à un coût viable ? |
| **Node Fleet** | Examine les fichiers livrés et les sources dans un espace de vérification distinct; contrôle chaque critère et approuve, rejette ou s'abstient. | La vérification détecte-t-elle les erreurs importantes, y compris celles partagées avec l'Agent ? |
| **AGIJobManager** | Conserve les USDC en séquestre, applique les règles de participation et de caution, enregistre les livraisons et les votes, puis applique les délais, les décisions de litige et les règlements ou créances différées. | Le contrat choisi est-il vérifié et configuré, et les participants et services sont-ils prêts ? |

Le contrat coordonne et règle le travail. Il n'exécute pas le modèle et ne détermine pas à lui seul si une conclusion est vraie. Fleet exécute et vérifie hors du contrat. Voir le [guide d'intégration](JOB_INTEGRATION.md).

La [spécification `computer-work/v2`](https://github.com/MontrealAI/AGIJobManager/blob/main/docs/OPERATIONS/GENERAL_COMPUTER_WORK.md) **n'impose aucun catalogue de professions ni d'extensions de fichiers autorisées**. Elle décrit l'objectif, les entrées immuables, les sorties, les critères vérifiables indépendamment, l'environnement, les permissions, le budget et l'échéance. Un nouveau type de travail ne nécessite donc pas forcément un nouveau contrat de règlement. Il exige toutefois les bons outils et la preuve que l'Agent et ses vérificateurs peuvent l'accomplir.

## Les débouchés les plus prometteurs

Le meilleur point de départ est un livrable utile dont la qualité se vérifie à un coût raisonnable. **Il s'agit de marchés candidats selon une analyse stratégique, et non d'une liste de travaux clients représentatifs déjà accomplis par cette Fleet.**

| Travail candidat | Exemple de livrable | Vérification indépendante utile |
| --- | --- | --- |
| **Modifications logicielles ciblées, tests et outils** | Une archive de code contenant une correction délimitée et des tests de non-régression. | Reproduire le défaut, exercer la correction et rechercher les régressions avec les dépendances disponibles. |
| **Analyse de données publiques et rapports** | Un classeur, des graphiques et un rapport à partir de données fournies. | Recalculer les résultats; examiner formules, unités et traitement des données manquantes. |
| **Reproduction scientifique et numérique** | Une reproduction exécutable avec hypothèses et résultats déclarés. | Relancer les calculs et comparer à des résultats attendus établis indépendamment. |
| **Sites, démonstrations interactives et documentation exécutable** | Une application web locale ou un projet d'exemple documenté. | Exercer l'interface livrée et les instructions selon les exigences explicites. |
| **Documents, tableurs et présentations** | Un DOCX, XLSX, PPTX ou PDF conforme à un cahier des charges clair. | Ouvrir les fichiers réels, recalculer au besoin et inspecter le rendu des pages ou diapositives. |
| **Recherche à partir de sources publiques** | Un rapport avec affirmations attribuables et sources justificatives. | Vérifier les affirmations dans les sources fournies ou par navigation publique qualifiée; signaler les questions non résolues. |

Privilégier les tâches délimitées avec des entrées et critères d'acceptation explicites. L'environnement Linux installé comprend Python, Node.js, des bibliothèques courantes de données et de documents, LibreOffice et un bureau jetable. Les sorties déclarées peuvent inclure PDF, DOCX, XLSX, PPTX, images, texte, code et projets ZIP, dans les limites du travail. Les outils et formats créent des possibilités; ils n'établissent aucun taux de réussite. Consulter les instructions [code et données](../fleet/packages/AGI_Agent/compute/skills/agi-code-and-data/SKILL.md), [documents](../fleet/packages/AGI_Agent/compute/skills/agi-document-work/SKILL.md) et [bureau](../fleet/packages/AGI_Agent/compute/skills/agi-desktop-work/SKILL.md).

## Un exemple concret

**Illustration uniquement : il ne s'agit pas d'un travail client réellement accompli.** Un acheteur souhaite un rapport comparant la consommation d'énergie à partir d'un jeu de données publiques fourni.

1. **Définir le travail.** Fournir des données publiques non personnelles utilisables légalement; nommer le classeur et le PDF attendus; préciser unités, traitement des valeurs manquantes, graphiques, budget et échéance.
2. **Vérifier la faisabilité.** Les opérateurs Agent et Node confirment les outils, l'environnement, le temps disponible, la capacité de vérification et les limites économiques. Une capacité essentielle absente impose de refuser le travail concerné.
3. **Financer et exécuter.** Une fois les conditions opérationnelles et le contrat choisi prêts, l'acheteur finance le travail. L'Agent affecté calcule les résultats, crée les fichiers, les rouvre et consigne les contrôles réellement effectués.
4. **Vérifier le livrable.** Les Nodes recalculent indépendamment à partir des entrées d'origine et inspectent le classeur et le PDF réels. Ils documentent chaque critère ainsi que les incertitudes.
5. **Régler selon les règles du travail.** Les votes et les éventuels litiges déterminent l'issue contractuelle. Une réussite distribue les USDC; les transferts sortants échoués deviennent des créances réservées dont il faut vérifier le paiement.

Le produit utile est le livrable accepté et utilisable, avec ses preuves. Davantage d'appels au modèle ou de fichiers produits ne suffisent pas à rendre le travail réussi.

## Ce que signifie le « travail à l'écran »

L'accès au clavier et à la souris n'établit pas la compétence pour exercer une profession entière. De nombreux métiers demandent aussi du jugement face à l'ambiguïté, une connaissance de l'organisation, de la négociation, des logiciels indisponibles ou de longues séquences d'actions dépendantes. Automatiser des tâches substantielles et bien définies dans plusieurs professions constitue une étape antérieure à l'exécution fiable de professions entières.

Le **parcours Linux actuel pour le travail public** possède des limites explicites :

| Limite | Conséquence pratique |
| --- | --- |
| **Entrées publiques non personnelles ou synthétiques** | Les données doivent être autorisées pour ce parcours public. Un fichier techniquement lisible n'est pas nécessairement adapté à une livraison publique. |
| **Navigateur public protégé** | Disponible seulement s'il est exposé, autorisé et qualifié. Il ne contient aucune session personnelle. Les dépendances à une connexion, un CAPTCHA ou un compte privé imposent de refuser les critères concernés. |
| **Aucune action de navigation engageant un changement externe** | Envoi de messages, publication, achats et création de comptes sont exclus par ce navigateur. Livrer un site local ne comprend pas son déploiement dans un compte connecté. |
| **Environnement de calcul sans réseau** | Le travail utilise les outils installés. Il ne peut installer de dépendances pendant la tâche ni remplacer une capacité absente par l'exécution sur l'hôte ou des accès réseau en ligne de commande. |
| **Environnement et limites de sortie déclarés** | Une application absente, une exigence non prise en charge ou une sortie trop volumineuse nécessite une autre spécification convenue ou un refus. Une empreinte valide prouve l'intégrité du fichier, pas son exactitude. |

Consulter le [périmètre du navigateur](../fleet/packages/AGI_Agent/compute/skills/agi-browser-work/SKILL.md) et celui du [code](../fleet/packages/AGI_Agent/compute/skills/agi-code-and-data/SKILL.md). Ces limites excluent l'exploitation générale de comptes connectés de courriel, CRM, banque et applications d'entreprise de ce parcours Linux. Les parcours privés ou natifs distincts décrits en amont ne prouvent pas que Linux les fournit ou les qualifie.

Les grands projets demandent aussi planification des dépendances, transmissions, vérification d'intégration et récupération. Une référence parent/dépendance dans une spécification ne constitue pas un coordinateur de projet complet. Le règlement séparé de tâches ne garantit pas le règlement atomique du projet entier. Toute coordination supplémentaire doit préserver les permissions exactes, le budget et les entrées acceptées de chaque étape.

## Qualité de vérification et économie déterminent la croissance

La vérification indépendante dépasse l'utilisation de portefeuilles différents ou d'appels répétés au même modèle. Prévoir des vérificateurs sous contrôle indépendant et évaluer leurs erreurs communes : un même modèle, une même consigne, source ou méthode peut reproduire la même erreur. Recalcul indépendant, exemples adversariaux et méthodes de contrôle différentes permettent d'évaluer ce risque. Le séquestre et le vote appliquent des règles; une majorité peut néanmoins se tromper. Voir la [vérification des preuves](../fleet/packages/AGI_Agent/compute/skills/agi-evidence-review/SKILL.md).

Davantage de machines Agent demandent une capacité de vérification qualifiée suffisante. L'économie doit aussi être viable. Pour un **travail réussi et vérifié de 1 000 USDC, au taux de validation par défaut documenté de 8 %**, la répartition de base est :

| Bénéficiaire | Montant |
| --- | ---: |
| Agent affecté | **520 USDC** |
| Validateurs du côté retenu, ensemble | **80 USDC** |
| Portefeuille de règlement recevant 30 % | **300 USDC** |
| Portefeuille de règlement recevant 10 % | **100 USDC** |

Ces parts sont comprises dans le prix initial. Les 80 USDC constituent une enveloppe partagée, pas un paiement de 80 USDC par Node. Cet exemple n'est ni une prévision de rentabilité ni une issue universelle : le taux de validation est figé pour chaque travail; arrondis, reliquats, cautions distinctes, pénalités, litiges et acceptation sans vérification peuvent modifier les transferts. Examiner les conditions réelles et les [règles exactes de paiement](https://github.com/MontrealAI/AGIJobManager/blob/main/docs/USDC_PAYOUT_SPLIT.md).

Comptabiliser inférence, effort de vérification, tentatives infructueuses, vérifications non rémunérées, frais réseau en ETH, infrastructure, publication, intervention humaine et capital à risque. Une allocation brute n'est pas un bénéfice. L'architecture seule ne permet aucune prévision de revenus ou de part de marché.

## État des preuves au 10 octobre 2026

Ce bilan décrit **Linux 1.0.9**; il ne constitue pas une affirmation permanente de disponibilité. Le [manifeste à la révision examinée](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/a52720d87864eac6b1e9827e2b29f2e1d7749ca8/engineering/current-release.json) indique :

| Preuve | Ce qu'elle établit | Ce qu'elle n'établit pas |
| --- | --- | --- |
| Acceptation native réussie sous Ubuntu 24.04 x86-64 et ARM64. | Le comportement de régression enregistré pour la version exacte dans ces environnements de test. | Le fonctionnement sur une machine physique ou une compétence générale sur les travaux. |
| Intégration Agent/Node réussie avec AGIJobManager au commit `191cf3590e5cdc08df1bb0af500ee28a91c8b010` (1.13.0). | Les cycles clients et contrat testés avec des données de test sur une chaîne locale. | L'inférence payante réelle, les règlements clients en USDC natif ou des validateurs exploités indépendamment. |
| Une observation distincte du réseau principal a confirmé les codes exécutables du gestionnaire et de huit bibliothèques au bloc **26 162 266**. | La compatibilité avec le déploiement enregistré à ce bloc. | L'état actuel des admissions ou des opérateurs; l'admission était suspendue dans cet instantané historique. |
| Installation physique neuve, Docker sans privilèges, OAuth/inférence, documents réels, nettoyage de base/navigateur, identité après redémarrage et endurance de 72 heures : **NOT_RUN**. | Ces étapes de qualification restaient ouvertes. | La qualification en production : le manifeste indiquait explicitement `productionQualified: false`. |

L'intégration utilise une chaîne en mémoire, des jetons de test et des dispositifs simulant génération, transport du contenu et identités. Ses clients Node et portefeuilles distincts partagent un même contrôleur de test. Des jours simulés ne prouvent pas l'endurance en temps réel. Consulter les [preuves d'intégration](JOB_INTEGRATION.md), l'[addendum d'acceptation lié aux empreintes](../validation/LINUX_1_0_9_JOB_INTEGRATION_ADDENDUM.md) et l'[observation du réseau principal](MAINNET_DEPLOYMENT.md).

Pour décider aujourd'hui, consulter le [manifeste actuel](../engineering/current-release.json) et le [registre de qualification physique](PHYSICAL_QUALIFICATION.md). Un nouveau modèle, outil, environnement ou règlement nécessite une nouvelle qualification pertinente; une réussite antérieure ne se transfère pas automatiquement.

## L'étape qui établirait ce potentiel

**Livrer régulièrement un travail accepté indépendamment, à un coût total compétitif et avec peu de supervision humaine.** Le démontrer par catégorie de tâches avant d'élargir le périmètre.

| Mesure | Éléments à conserver |
| --- | --- |
| Livrable utile accepté | Preuves indépendantes du résultat pour les fichiers réellement livrés. |
| Exactitude de la vérification | Acceptation erronée d'un travail défectueux, rejet erroné d'un bon travail et incertitudes non résolues. |
| Fiabilité | Chaque engagement prévu, y compris échecs, dépassements de délai, refus et abstentions. |
| Économie | Coûts totaux Agent et Node, travail non payé, frais réseau, minutes humaines, nouvelles tentatives et paiements réalisés. |
| Délais et capacité | Attente, exécution, vérification, litiges et récupération; capacité des Agents comme des Nodes. |
| Sûreté opérationnelle | Nettoyage, comportement STOP, récupération après redémarrage et respect des permissions et limites déclarées. |

Figer la charge de travail, les critères d'acceptation et l'environnement; séparer calibration et évaluation sur des cas réservés; conserver les échecs et factures réelles. Utiliser des résultats établis indépendamment et indiquer les incertitudes, particulièrement lorsque les erreurs peuvent être corrélées. Voir le [processus de mesure et de qualification en amont](https://github.com/MontrealAI/AGIJobManager/blob/main/docs/OPERATIONS/GENERAL_COMPUTER_WORK.md#measure-improvements-before-promotion).

À mesure que davantage de catégories sont qualifiées, les deux systèmes pourraient soutenir un marché croissant du travail numérique effectué par des machines, avec le même cadre de tâches et de règlement. Le chemin passe par la livraison, la vérification et l'économie mesurées, une catégorie éprouvée à la fois.
