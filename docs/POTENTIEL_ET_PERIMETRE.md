# Fleet + AGIJobManager : quel potentiel ensemble ?

[English](POTENTIAL_AND_SCOPE.md) · [Site Fleet](https://montrealai.github.io/AGI-Fleet-Linux/fr.html) · [Installation](FRESH_INSTALL.md) · [État actuel de qualification](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.0.10-qualification/Release-Manifest-v1.0.10.json)

**Notre mission : créer une main-d'œuvre d'IA capable et simple à utiliser, qui puisse accomplir une grande part du travail effectué avec un clavier, une souris et un écran.** Cela comprend les applications installées et les outils professionnels avec comptes connectés, ainsi que les fichiers, le code et la recherche publique. L'environnement public isolé est un premier mode de fonctionnement, pas la limite visée du produit.

Fleet fournit l'exécution et la vérification; AGIJobManager fournit les règles de financement, de participation et de règlement. Ensemble, ils pourraient soutenir un vaste marché du travail numérique vérifié indépendamment. **L'équipe situe le marché total adressable à environ 40 000 milliards de dollars américains par an.** Il s'agit de son estimation stratégique, et non d'une mesure de marché vérifiée indépendamment, d'une prévision de revenus ou d'un taux établi d'automatisation. Un modèle de marché défendable doit préciser la géographie, les travaux inclus, l'année, les prix et l'adoption envisageable, sans compter deux fois le même travail.

L'ambition est large; la disponibilité dépend de la version, de l'espace de travail et de la tâche. **Les versions actuelles n'ont pas démontré l'exécution fiable de la majorité des travaux à l'écran.** Ce guide distingue la mission, les parcours de développement et les résultats nécessaires pour établir cette couverture.

## Comment les deux systèmes collaborent

| Composant | Sa contribution | Ce qu'il faut encore établir |
| --- | --- | --- |
| **Agent Fleet** | Produit le livrable déclaré avec les outils de programmation, de fichiers et de bureau disponibles, dans les permissions et budgets du travail. | Cet environnement précis peut-il accomplir cette tâche correctement et à un coût viable ? |
| **Node Fleet** | Examine les fichiers livrés et les sources dans un espace de vérification distinct; contrôle chaque critère et approuve, rejette ou s'abstient. | La vérification détecte-t-elle les erreurs importantes, y compris celles partagées avec l'Agent ? |
| **AGIJobManager** | Conserve les USDC en séquestre, applique les règles de participation et de caution, enregistre les livraisons et les votes, puis applique les délais, les décisions de litige et les règlements ou créances différées. | Le contrat choisi est-il vérifié et configuré, et les participants et services sont-ils prêts ? |

Le contrat coordonne et règle le travail. Il n'exécute pas le modèle et ne détermine pas à lui seul si une conclusion est vraie. Fleet exécute et vérifie hors du contrat. Voir le [guide d'intégration](JOB_INTEGRATION.md).

La [spécification `computer-work/v2`](https://github.com/MontrealAI/AGIJobManager/blob/main/docs/OPERATIONS/GENERAL_COMPUTER_WORK.md) **n'impose aucun catalogue de professions ni d'extensions de fichiers autorisées**. Elle décrit l'objectif, les entrées immuables, les sorties, les critères vérifiables indépendamment, l'environnement, les permissions, le budget et l'échéance. Un nouveau type de travail ne nécessite donc pas forcément un nouveau contrat de règlement. Il exige toutefois les bons outils et la preuve que l'Agent et ses vérificateurs peuvent l'accomplir.

## Choisir l'espace adapté au travail

| | Version pour le travail public | Préversion de l'espace autorisé |
| --- | --- | --- |
| **Usage** | Données publiques ou synthétiques et livrables locaux vérifiables. | Développer des tâches dans les applications Linux installées et les outils professionnels auxquels l'opérateur se connecte lui-même. |
| **Environnement** | Calcul isolé sans réseau et navigateur public qualifié séparément. | Compte Linux X11 dédié, avec captures d'écran et contrôle réels du clavier et de la souris par le fournisseur Linux expérimental d'OpenClaw. |
| **Comptes** | Aucune session personnelle; les tâches exigeant une connexion sont hors de ce mode. | Applications et sessions volontairement mises à disposition dans le compte dédié. L'opérateur effectue la connexion. |
| **Autorité** | Politique de travail public et séparation signature-calcul. | Autorisations signées à durée limitée, ressources déclarées, budgets d'actions/temps/coût, révocation et journal durable. Le contrôle du bureau porte sur le compte entier, sans isolation par site ou action. |
| **Résultats** | Livrable public déclaré et intégration existante aux tâches publiques. | Transmission chiffrée des résultats et parcours distinct de vérification. Aucune publication ou passerelle de règlement automatique pour les tâches privées. |
| **État** | Version de qualification Linux 1.0.10; résultats natifs et d’intégration consignés dans son manifeste publié; qualification physique encore en attente. | Nouveau code sous `workstation/engine/`; préversion de développement réservée aux essais pilotes, exigeant ses propres essais complets et sa qualification physique. L’exécution en production est désactivée; remplir un rapport local ne peut l’activer. La qualification de la version distribuée ne lui est pas transférable. |
| **Démarrer** | [Installer la version publique](FRESH_INSTALL.md). | [Suivre le démarrage de l'espace autorisé](../workstation/QUICKSTART.md). |

Pour l'espace autorisé, préparer un **compte système ou une machine virtuelle réservé aux tâches, distinct de votre bureau habituel et du compte de signature Fleet**. Une autorisation signée peut encadrer une exécution et ses ressources, mais le contrôle général du clavier et de la souris peut atteindre tous les fichiers, terminaux, sessions et applications accessibles au compte. Les noms d'applications ou de domaines ne constituent pas une isolation plus étroite. Limiter cet accès par le provisionnement du compte et les permissions des services. Les réserves de coût de l’exécution ne plafonnent pas les achats ou services accessibles dans une application connectée; ils exigent leurs propres contrôles au niveau du compte.

Les captures d'écran et les données du travail peuvent être transmises au fournisseur de modèle explicitement approuvé. Le chiffrement protège la transmission du résultat; il ne signifie ni traitement exclusivement local ni effacement automatique. Les fichiers de travail et journaux locaux peuvent conserver des données en clair : l'opérateur doit gérer leur accès, leur conservation et leur nettoyage. Confirmer les permissions sur les données avant de rendre disponibles comptes ou fichiers. Garder les entrées et résultats privés hors du parcours de livraison public.

**Un format de tâche publique plus général est aussi proposé en préversion de code.** L’[importation générale dans Work Studio](../workstation/STUDIO.md) accepte les tâches publiques `computer-work/v2`, leurs extensions déclarées sans catalogue imposé, jusqu’à 64 sorties et 64 Mio au total selon les limites de la tâche. Agent et Node conservent identités des environnements, permissions, empreintes des entrées, budget et échéance. L’éditeur rapide reste en v1. Cette préversion distincte n’accepte pas les tâches privées ou les comptes dédiés et ne met pas à jour l’installateur publié.

## Du travail dans de nombreux métiers

**Ce sont des familles de tâches visées, pas un bilan de travaux clients déjà accomplis.** L'espace doit fournir les outils et permissions nécessaires avant tout essai. Des résultats d'acceptation représentatifs sont nécessaires avant de présenter une famille de tâches comme fiable.

| Famille de tâches | Exemple de résultat | Vérification nécessaire |
| --- | --- | --- |
| **Logiciels et opérations techniques** | Correction testée, site, compilation reproductible ou déploiement documenté. | Reproduire le problème, exécuter les contrôles et inspecter le service ou le livrable. Un déploiement externe exige l'espace et les autorisations appropriés. |
| **Données, science et rapports** | Données rapprochées, classeur, graphiques ou reproduction numérique. | Recalcul indépendant; contrôle des unités, formules, hypothèses et données manquantes. |
| **Documents et création** | Rapports, présentations, mises en page, images ou autres fichiers créés avec les outils installés. | Ouvrir les fichiers réels; inspecter rendu, contenu, structure modifiable et conformité au brief. Les outils et licences doivent être disponibles. |
| **Recherche et connaissances** | Résultats sourcés, comparatifs ou base de connaissances structurée. | Vérifier affirmations, qualité des sources, preuves manquantes et périmètre convenu. |
| **Opérations clients et administration** | Mise à jour CRM, réponse de soutien préparée, catalogue ou dossier administratif. | Examiner les dossiers visés et les effets réels avant/après, y compris les changements involontaires. Le travail connecté relève de la préversion autorisée et exige sa propre qualification. |
| **Coordination entre applications** | Préparer une proposition, mettre à jour un suivi et assembler un dossier de vérification. | Vérifier chaque transmission, dépendance et état final; maintenir envois, publications et autres effets externes dans l'autorité accordée. |

La version publique comprend Python, Node.js, des bibliothèques de données et de documents, LibreOffice et un bureau jetable. Ses livrables peuvent inclure PDF, DOCX, XLSX, PPTX, images, texte, code et ZIP dans les limites déclarées. L'espace autorisé ouvre un parcours de développement vers davantage d'applications installées; il ne permet pas à Linux d'exécuter tous les logiciels Windows ou macOS. Compatibilité, permissions d'entreprise et adaptateurs restent propres à chaque tâche.

Consulter les instructions publiques [code et données](../fleet/packages/AGI_Agent/compute/skills/agi-code-and-data/SKILL.md), [documents](../fleet/packages/AGI_Agent/compute/skills/agi-document-work/SKILL.md) et [bureau](../fleet/packages/AGI_Agent/compute/skills/agi-desktop-work/SKILL.md), ou le [guide de la préversion](../workstation/QUICKSTART.md).

## Un exemple concret

**Illustration uniquement : il ne s'agit pas d'un travail client réellement accompli.** Un acheteur souhaite un rapport comparant la consommation d'énergie à partir d'un jeu de données publiques fourni.

1. **Définir le travail.** Fournir des données publiques non personnelles utilisables légalement; nommer le classeur et le PDF attendus; préciser unités, traitement des valeurs manquantes, graphiques, budget et échéance.
2. **Vérifier la faisabilité.** Les opérateurs Agent et Node confirment les outils, l'environnement, le temps disponible, la capacité de vérification et les limites économiques. Une capacité essentielle absente impose de refuser le travail concerné.
3. **Financer et exécuter.** Une fois les conditions opérationnelles et le contrat choisi prêts, l'acheteur finance le travail. L'Agent affecté calcule les résultats, crée les fichiers, les rouvre et consigne les contrôles réellement effectués.
4. **Vérifier le livrable.** Les Nodes recalculent indépendamment à partir des entrées d'origine et inspectent le classeur et le PDF réels. Ils documentent chaque critère ainsi que les incertitudes.
5. **Régler selon les règles du travail.** Les votes et les éventuels litiges déterminent l'issue contractuelle. Une réussite distribue les USDC; les transferts sortants échoués deviennent des créances réservées dont il faut vérifier le paiement.

Le produit utile est le livrable accepté et utilisable, avec ses preuves. Davantage d'appels au modèle ou de fichiers produits ne suffisent pas à rendre le travail réussi.

## Un accès plus large, un contrôle clair et un démarrage simple

Clavier et souris permettent d'interagir; un résultat fiable exige aussi jugement, contexte organisationnel, récupération et vérification. L'objectif est d'accomplir du travail substantiel dans de nombreux métiers. Une profession entière peut comporter des responsabilités impossibles à évaluer comme une seule tâche de bureau.

L'expérience visée suit cinq étapes :

1. **Décrire le résultat.** Nommer le livrable ou l'état final attendu dans l'application, et expliquer comment l'accepter.
2. **Choisir l'espace.** Utiliser le mode public ou un espace autorisé dédié avec les bonnes applications.
3. **Examiner l'autorité et le budget.** Comprendre la portée du compte, les effets externes voulus, les limites de temps et de dépenses et les destinataires du résultat.
4. **Exécuter avec une progression visible et un moyen d'arrêt.** Conserver les preuves des actions réussies, échouées et incertaines. Inspecter un envoi ou une soumission interrompus avant toute nouvelle tentative.
5. **Vérifier le résultat.** Examiner fichiers et état des applications selon les critères d'acceptation avant d'annoncer réalisation ou règlement.

C'est l'expérience produit visée; la préversion ne fournit pas encore un parcours opérateur achevé en un clic. Le guide décrit la configuration et les commandes actuelles.

Le mode public conserve ses limites : données publiques ou synthétiques, aucune session personnelle, aucun travail exigeant une connexion dans le navigateur, aucun envoi/publication/achat par ce navigateur, et aucun réseau ou installation de dépendances dans le calcul isolé. Ces contrôles protègent ce parcours. Le nouveau travail dans des comptes utilise l'espace autorisé distinct. Voir les [instructions du navigateur public](../fleet/packages/AGI_Agent/compute/skills/agi-browser-work/SKILL.md).

La préversion conserve les mécanismes d'autorité signée, d'admission selon le budget, de transmission chiffrée et de vérification indépendante. Leur efficacité sur le nouveau parcours Linux exige ses propres observations. La vérification doit examiner les effets externes autant que les fichiers livrés. Autorisations signées, portefeuilles distincts et empreintes de fichiers ne prouvent pas seuls l'exactitude du travail.

Les grands projets demandent aussi planification des dépendances, transmissions, vérification d'intégration et récupération. Des références dans une spécification ne constituent pas un coordinateur complet. Le règlement séparé des sous-tâches ne garantit pas le règlement atomique du projet; chaque étape doit préserver autorité, budget et entrées acceptées. L'espace privé n'a actuellement aucune passerelle automatique vers le règlement des tâches publiques AGIJobManager.

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

Pour décider aujourd'hui, consulter le [manifeste actuel](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.0.10-qualification/Release-Manifest-v1.0.10.json) et le [registre de qualification physique](PHYSICAL_QUALIFICATION.md). Un nouveau modèle, outil, environnement ou règlement nécessite une nouvelle qualification pertinente; une réussite antérieure ne se transfère pas automatiquement.

## Une feuille de route vers une couverture étendue

**Livrer du travail accepté indépendamment, à un coût total compétitif et avec peu de supervision humaine.** Mesurer cet objectif par famille de tâches, application et environnement; ne pas extrapoler une démonstration à un métier ou à une part de marché.

| Étape | Démonstration requise avant promotion |
| --- | --- |
| **1. Un bureau opérationnel** | Captures et actions réelles sur la machine Linux visée; identité du fournisseur; interaction avec applications installées et application de test connectée; STOP, expiration et révocation; redémarrage et reconnexion. Utiliser d'abord des comptes synthétiques. |
| **2. Des tâches applicatives utiles** | Cas réservés dans les documents, tableurs, applications web, outils logiciels et dossiers professionnels; vérification indépendante des sorties et de l'état avant/après. Consigner échecs et aide humaine. |
| **3. Du travail en plusieurs étapes** | Passage entre applications, reprise après interruption, identification des effets incertains et prévention des doubles envois/soumissions. Vérifier transmissions, échéances et limites. |
| **4. Vérification indépendante et économie** | Vérificateurs sous contrôle indépendant; détection d'erreurs introduites; factures réelles d'inférence, coût de vérification, minutes humaines, infrastructure, échecs et paiements réalisés le cas échéant. |
| **5. Déploiement auprès des opérateurs** | Études d'utilisabilité d'une installation neuve, modèles de tâches testés, commandes claires de mode/coût/état, preuves de soutien et de récupération, fonctionnement prolongé et qualification par application. |

Pour chaque évaluation, figer tâches, critères et environnement; séparer réglage et cas réservés, et conserver les échecs. Le registre doit inclure :

| Mesure | Éléments à conserver |
| --- | --- |
| **Travail utile accepté** | Preuves indépendantes sur les fichiers réels et l'état des applications, avec le nombre total de travaux tentés. |
| **Exactitude de la vérification** | Fausses acceptations, faux rejets, abstentions et erreurs corrélées entre modèles ou vérificateurs. |
| **Coût total et effort humain** | Inférence Agent et Node, reprises, travail échoué/non payé, infrastructure, frais réseau pertinents, minutes humaines et paiements réalisés. |
| **Délai et fiabilité** | Attente, exécution, vérification, interruptions, récupération et délai complet. |
| **Effets externes et autorité** | Envois, modifications et soumissions voulus face aux changements réels; doublons ou effets inattendus; expiration, révocation et STOP. |
| **Couverture** | Familles, difficulté, applications, comptes requis et exclusions, avec taille de l'échantillon et incertitude. |

Voir le [processus de mesure et de qualification en amont](https://github.com/MontrealAI/AGIJobManager/blob/main/docs/OPERATIONS/GENERAL_COMPUTER_WORK.md#measure-improvements-before-promotion). Un changement de modèle, fournisseur de bureau, version d'application ou politique de permissions nécessite une réévaluation pertinente.

Le potentiel couvre largement le travail numérique. Pour l'atteindre : un poste capable, une expérience opérateur simple, une vérification indépendante fiable et des réussites mesurées. L'estimation stratégique d'environ 40 000 milliards de dollars américains par an exprime l'ambition de l'équipe; les preuves de travail utile déterminent la part réellement accessible au système.
