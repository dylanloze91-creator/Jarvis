# Feuille de route de Jarvis — à lire avant chaque tâche

Tenue par Claude (le chat, manager du projet). Dernière mise à jour : 23 novembre 2026.

**Claude Code et Cursor la lisent avant chaque tâche**, en même temps que `AGENTS-COORDINATION.md`. Elle dit vers où va Jarvis, qui fait quoi et dans quel ordre, et ce qui en dépend. Le but : qu'aucun outil ne soit construit sans tenir compte de ceux qui viendront s'y brancher.

Ce fichier ne contient ni secret, ni donnée personnelle, ni nom de réseau : le dépôt est public.

## 1. Le cap

- **Jarvis doit être utilisable tous les jours.** Il n'a pas besoin d'être fini à 100 %. L'étape actuelle est : corrections, bogues, finitions.
- **Deux versions de Jarvis :**
  - **Jarvis Live** : celle que l'utilisateur utilise tout le temps. Elle ne reçoit **que** des corrections et des finitions, essayées en vrai avant d'être publiées.
  - **Jarvis Test** : celle où l'on ajoute les nouveautés. L'utilisateur l'essaie de temps en temps. Une nouveauté ne passe dans Live qu'après avoir fait ses preuves dans Test.
- **Le but à long terme** : une IA faite de plusieurs **petits modèles locaux** spécialisés (sur la RTX 2060 de l'utilisateur), qui approchent le niveau d'un gros modèle **sur ses usages à lui**. Un chef d'orchestre envoie chaque demande à la bonne équipe.
- **Un Jarvis un peu autonome** (objectif ajouté le 16 novembre) : sur certaines tâches, il **surveille seul**, **voit quand quelque chose ne va pas** et **agit sans attendre** quand l'action va dans le sens de la sécurité : couper une impression qui part en vrille, mettre en pause, arrêter le robot. Il **prévient toujours** l'utilisateur de ce qu'il a fait et pourquoi. Tout ce qui démarre, chauffe ou fait bouger quelque chose reste soumis à son accord, sauf règle permanente qu'il aura lui-même validée. Détail dans la section 6 (« Jarvis autonome »).
- **Une vraie conversation à la voix** (objectif ajouté le 16 novembre, **prochain grand chantier une fois Jarvis Test et la carte de l'utilisation faits**) : parler avec Jarvis comme avec une personne. Pas « je parle, il parle » : l'utilisateur peut le **couper** au milieu d'une phrase, se reprendre (« non, attends… »), et Jarvis répond vite, sans attendre un long silence. Détail dans la section 6 (« Vraie conversation »).
- **Jarvis plus rapide sans nouveau modèle** (décision de l'utilisateur du 17 novembre) : la machine calcule vite, ce sont les modèles qui ralentissent. On construit donc des **outils qui ne sont pas des modèles** pour que Jarvis réponde plus vite : mesurer où part le temps, garder les modèles chargés, raccourcir ce qu'on leur envoie, régler plus de demandes par des règles sûres, garder quelques minutes les résultats d'outils. Cahier : `docs/specs/rapide-sans-modele.md`. Mission 2 bis de Claude Code (section 3).
- **Les deux priorités** (décision de l'utilisateur du 19 novembre) :
  1. **le travail en cours de Claude Code** : la Live 5.0.80 (corrections), puis Jarvis Développeur facile ;
  2. **l'atelier 3D** : Jarvis dessine une pièce à partir de quelques mots, la montre, prépare le fichier et l'imprime avec l'accord de l'utilisateur (`docs/specs/atelier-3d.md`). Il s'appuie sur l'imprimante sous surveillance, qui passe donc avec lui. Claude (le chat) en écrit le cœur en parallèle ; Claude Code le branche ensuite.
  Tout le reste attend derrière ces deux priorités.
- **Trois chantiers côte à côte** (décision de l'utilisateur du 17 novembre) :
  - **Jarvis** (Live et Test) : l'appli elle-même, cette feuille de route telle quelle ;
  - **Jarvis Development** (branche longue `claude/jarvis-development`) : les **appendices** de Jarvis, c'est-à-dire ses yeux, ses bras, ses jambes, ses sens et ses mains sur la maison, avec leurs programmes et leur électronique. Cahier : `docs/specs/jarvis-development.md` ; matériel : `docs/materiel/electronique-appendices.md` ;
  - **Model Development** (plus tard, pas encore ouvert) : l'entraînement des modèles. La liste de ses besoins est tenue dans le cahier de Jarvis Development, section 9.
  Quand l'utilisateur n'est pas chez lui, on avance Jarvis Development dans le cloud, et les essais de Live et de Test attendent son retour (accord du 17 novembre).
- **On n'entraîne un modèle que là où l'usage réel montre qu'il échoue.** Les ratés de tous les jours (carnet des ratés) et la carte de l'utilisation réelle décident des entraînements. Les exercices génériques ne servent que de base.

## 1 bis. On suit cette feuille, quoi qu'il arrive (accord du 12 novembre)

- **Une nouvelle idée ne change pas la file.** Elle va dans « Idées en attente » (section 6). Claude dit où elle pourrait se placer, et on la reprend quand la file y arrive.
- **Deux exceptions seulement :**
  - un bogue qui empêche d'utiliser Jarvis Live ;
  - un problème de sécurité ou d'argent (clé exposée, machine louée qui tourne pour rien).

  Ce sont des corrections de Live : elles passent devant.
- **Changer la feuille est possible**, mais seulement par une décision claire de l'utilisateur (« on change la feuille de route »). Claude la met alors à jour, et ce fichier fait foi.

## 2. Règles qui ne changent pas

- **Une seule mission à la fois** pour Cursor, une seule pour Claude Code, dans l'ordre de la section 3.
- **Cursor prépare, Claude relit, Claude Code essaie sur Windows (et sur le matériel) puis publie.** Pas de publication d'un travail de Cursor sans relecture ni essai en vrai.
- **Ce qui se décide par une règle sûre ne passe pas par un modèle** : horloge, calcul, bourse, et les règles express du chef d'orchestre.
- **Chat sans orchestre, `__golden__` jamais régénérés, `parseSettings({})` sans nouvelle clé, aucune dépendance native.**
- **Données d'entraînement** :
  - jamais un texte écrit par Claude ou Cursor ;
  - l'examen n'est jamais entraîné ;
  - les données de l'utilisateur restent sur son PC (`C:\dev\jarvis-data`), jamais sur GitHub.
- **Depuis une enceinte** : jamais de carte de confirmation acceptée, jamais de mission lancée, jamais d'impression 3D lancée.

## 3. Les files de travail

État au 17 novembre 2026, 11 h (mis à jour par Claude d'après GitHub).

### Publié

- **5.0.77** (13 novembre) : corrections des essais du 12 novembre. Reste deux essais à la voix, à faire par l'utilisateur : musique sur la Phantom puis « stop la musique », et une sauvegarde suivie de sa restauration.
- **5.0.78** (16 novembre) :
  - écriture sûre des fichiers d'état : forcée sur le disque, avec une copie `.bak` reprise si le fichier est abîmé. C'est la cause de l'enceinte en 401 après les coupures du 13 novembre ;
  - Codeur par rôle respecté, réflexion coupée, « revue non faite » dite telle quelle ;
  - correctif de sécurité du mode direct ;
  - boutons « Copier ».
- L'enceinte de la chambre est **reliée de nouveau** (16 novembre).
- **5.0.79** (18 novembre) : l'écran de l'enceinte (mascotte, heure, messages de souci, informations du PC) et l'outil `afficher_sur_enceinte`. Enceinte flashée et **tous les essais réussis** avec l'utilisateur ; publication lancée par l'utilisateur le 18 novembre au soir.

### Claude Code (PC Windows de l'utilisateur, avec le matériel)

| # | Tâche | État |
| --- | --- | --- |
| 1 | **Jarvis Test** `5.1.0-test.1` (`claude/dev`, qui contient maintenant Live 5.0.79 et le travail de vitesse). Essais du 18 novembre (`rapports/2026-11-18-jarvis-test-essais.md`) : séries A et B faites, série C à finir. **Défaut bloquant** : l'équipe PC n'appelle plus ses outils. Piste confirmée le 19 : le modèle répond à la note d'heure placée devant la demande, surtout avec la personnalisation « réponds court ». Décision : si les 10 essais par cas le confirment, la ligne d'heure revient dans le message système (fiabilité avant vitesse), et le banc garde pour toujours la personnalisation et des discussions mélangées. Correction en cours sur `claude/correction-outils-pc`, avec les points 2 à 5 du rapport. | **en cours** ; puis essais avec l'utilisateur, puis publication sur son « publie » |
| 1 ter | **Jarvis Développeur facile, étape 1** (`docs/specs/developpeur-facile.md`, demande de l'utilisateur du 19 novembre, Jarvis Test seulement). Quand il demande une application : réponse immédiate « pas de souci, je m'en occupe », recherche sur Internet de ce qui existe déjà et de la bonne façon de faire, base posée tout de suite, Jarvis raconte chaque étape et montre les fichiers, questions une à la fois au fil de l'eau, mots simples. Le moteur ne change pas (le choix d'un autre moteur, par exemple Claude Code, viendra plus tard sur décision de l'utilisateur). Branche `claude/developpeur-facile`. | **étape 1 faite la nuit du 19 au 20 novembre** (`claude/developpeur-facile`, pas encore dans `claude/dev`, 40 essais, rapport `rapports/2026-11-19-developpeur-facile.md`), relue par Claude : bonne, écarts dits franchement. Pas encore fait : Jarvis n'ouvre pas la base tout seul ; la reformulation reprend les mots sans modèle ; le moteur ne pose encore aucune question pour un projet neuf ; après une demande à l'enceinte, rien ne s'affiche tout seul sur le PC. Aucune création réelle n'a tourné (faux moteur dans les essais). **Essai réel par Claude Code le 20 novembre** : une création complète a réussi (3 défauts de la carte corrigés), mais le résultat était un programme à commande, avec des noms de projet bizarres. **Étape 2 faite le soir même par Claude (le chat)**, à la demande de l'utilisateur (`claude/developpeur-facile-etape2`, rapport `rapports/2026-11-20-developpeur-facile-etape2.md`) : une appli part d'une base avec écran, nom lisible (« Heures chantier »), « crée-moi un minuteur… » compris, « C'est prêt » dit comment s'en servir, bouton « Ouvrir l'appli ». Aucune régression. **Reste** : contrôles officiels et essai réel par Claude Code (Codeur `qwen3.5:4b` tant qu'Ornith plante), puis essai avec l'utilisateur, puis fusion dans `claude/dev`. |
| 1 quater | **Live 5.0.80, corrections seulement** (accord de l'utilisateur du 19 novembre). (a) **Mémoire apprise** (trouvé par Claude Code le 19, `rapports/2026-11-19-outils-pc-discussion-neuve.md`) : une phrase qui commence par « non » devient une « règle validée », elle est rappelée dès qu'une demande partage deux petits mots avec elle, et l'en-tête dit au modèle de ne pas appeler d'outil : « Quelle fenêtre est active ? » ratait 10 fois sur 10 dans Live. Corrections : classement plus strict, petits mots ignorés au rappel avec un seuil plus haut, en-tête réécrit ; d'abord dans Test. (b) Règle express sans modèle : « les informations sur mon PC » appelle `get_system_info`. (c) Outils qui ratent d'après la carte : pause, reprise et morceau précédent de Spotify, `generer_image`, `youtube_transcript`, Gmail, `list_processes` (cause lue dans le journal d'audit du PC, en lecture seule). | **faite la nuit du 19 au 20 novembre**, relue par Claude : bonne (corrections seulement, aucun fichier figé touché). Dans Test (`claude/corrections-5080` fusionnée dans `claude/dev`) et prête en Live (`claude/live-5080`, version 5.0.80, installateur construit, pas publié). Banc avec la vraie mémoire de Live : « Quelle fenêtre est active ? » passe de 0 à 10 sur 10, 60 sur 60 en tout. Les fiches « non » déjà enregistrées ne sont plus rappelées : rien à effacer. **Essais faits par Claude Code le 20 novembre** à la demande de l'utilisateur : 12 sur 15 réussis ; défauts trouvés (fenêtre active à la voix 4 ratés sur 6, une correction qui rejetait une fiche sans rapport, Spotify suivant/précédent, « mon PC est lent en ce moment » parti sur Internet). **Corrigés le soir même par Claude (le chat)** à la demande de l'utilisateur (`claude/corrections-5080-suite`, rapport `rapports/2026-11-20-corrections-5080-suite.md`, aucune régression sur les 2 481 essais du cœur). **Reste** : contrôles officiels sur le PC et report dans Test puis Live (Claude Code), refaire E2, E5, E8, E11 ; puis une phrase à la vraie enceinte et l'écoute de E6 par l'utilisateur ; publication sur son « publie ». En attente de sa réponse : vouvoiement du caractère « majordome ». Hors de Jarvis, à décider : Forge démarre en 113 s au repos car il retente d'installer `insightface` à chaque lancement (a dépassé les 4 minutes le 12 novembre) ; la connexion Google expire tous les 7 jours tant que l'application Google est en mode « Test ». |
| 1 quinquies | **Carte de l'utilisation, version 2** (accord du 19 novembre) : noter le lieu des demandes faites dans la fenêtre et sur le téléphone (aujourd'hui « non connu »), et découper la famille « autre » (40 %) en vraies familles. Puis relancer la carte après deux semaines d'usage de Jarvis Test. | petite tâche, quand Claude Code a un creux |
| 1 sexies | **Idées reprises d'OpenJarvis** (demande de l'utilisateur du 23 novembre : « reprends leurs idées qui nous font gagner du temps »). Écrit par Claude (le chat) sur `claude/idees-openjarvis` (partie de `claude/dev`, ajouts seulement, rien de branché ; rapport `rapports/2026-11-23-idees-openjarvis.md`) : (a) **boucle d'amélioration** `npm run ameliorer` : relit le journal du tour et le carnet des ratés, regroupe les ratés, dit où part le temps, propose des règles express et les passe à une **porte** (au plus 1 % de demandes prises à d'autres équipes), suggère un modèle par équipe ; elle remplace la lecture à la main de `carte.md` pour trouver les règles express (tâche 2) ; (b) **veilleurs** : moteur des règles permanentes de « Jarvis autonome » (étape 2), sans modèle, actions de sécurité seulement ; (c) **garde de boucle** pour les appels d'outil répétés. | **essayé le 23 novembre** par Claude Code (contrôles verts, rapport `rapports/2026-11-23-ameliorer-essai.md`) : 37 demandes lues, une règle ajoutée (`mon-pc`, essayée au clavier dans Jarvis Test, bon outil à chaque fois). **Constat** : le tri ne coûte presque rien (0,5 s en médiane) ; le temps part dans le **chargement des modèles** (12 s, 9 fois sur 10), l'écriture de la réponse (10 s) et le premier son. Prochain gain de vitesse : éviter les rechargements, pas d'autres règles. Trois défauts vus : « … sur mon PC en ce moment » vers le Web (déjà corrigé sur `claude/corrections-5080-suite`, à fusionner), « Note dans ma liste de … » non reconnu (l'équipe PC répond « Bien noté » sans noter), « Mets de la musique sur mon PC » non reconnu. Relancer la boucle après quelques semaines de Jarvis Test. Brancher les veilleurs et la garde : plus tard, sur décision. |
| 1 bis | **Écran de l'enceinte** (`claude/enceinte-ecran`) : la mascotte de l'utilisateur, l'heure après 2 min de sommeil, les messages de souci et les informations du PC. À recompiler (`pio run`), puis à flasher avec l'utilisateur et l'écran branché. Live 5.0.79 (`claude/live-5079`) flashée et essayée le 18 novembre : tout est bon. | **fait** ; publication en cours (fusion dans `main`, `release.sh`) |
| 2 | Carte de l'utilisation réelle : tests verts et script lancé la nuit du 18 au 19 novembre ; `carte.md` est sur le PC (`C:\dev\jarvis-data\carte\`). | **l'utilisateur l'envoie à Claude** ; Claude en tire les règles express et l'examen tiré de l'usage |
| 2 bis | **Jarvis plus rapide, sans nouveau modèle** (`docs/specs/rapide-sans-modele.md`, branche `claude/rapide-sans-modele` partie de `claude/dev`, Jarvis Test seulement). D'abord le chronomètre par étape et `vitesse.ps1`, puis : modèles gardés chauds, prompt plus court, mémoire courte des outils, outil des règles express. Ne pas fusionner dans `claude/dev` avant les essais de `5.1.0-test.1`. Les règles express elles-mêmes attendent `carte.md` et `vitesse.md`. | **terminée** et fusionnée dans `claude/dev` le 18 novembre. Essayée : premier mot en 0,86 s après le démarrage, cours de bourse redonné en 1 ms. La note d'heure est la cause probable du défaut de l'équipe PC (tâche 1). Équipes Mémoire et Code : réglage à refaire dans Test (non enregistré). |
| 3 | Fusionner dans `main` les branches de documentation que Claude prépare (en ce moment : `claude/feuille-rapide`). | à chaque fois |
| 4 | Ajouter la nuit de génération du 11 novembre au cahier (`lab:clean`). | à faire |
| 5 | Essai du raccordement d'enceinte par USB, avec l'utilisateur et la carte. | à faire |
| 6 | Plus tard : premier entraînement sur les conversations, sur carte louée (`docs/specs/jeu-conversations.md`, partie C). Seulement quand `resume.json` montre assez d'exemples et que l'utilisateur a dit oui. | après la mission 6 de Cursor et quelques semaines de Jarvis Test |

### Cursor (une mission à la fois)

Cursor n'arrive pas à pousser sur GitHub. L'utilisateur envoie son travail en archive à Claude, qui le compare à la branche, le relit et le pousse sur une branche `claude/…` en le disant.

| # | Mission | État |
| --- | --- | --- |
| 1 | Bourse et tri | terminée, publiée (5.0.77) |
| 2 | Deux Jarvis : Live et Test (`cursor/deux-jarvis`) | terminée et relue ; attend la tâche 1 de Claude Code |
| 3 | Carnet des ratés (`cursor/carnet-des-rates`) | terminée et relue ; dans le lot B |
| 4 | Lot B, le quotidien | terminée et relue ; **correction de la construction faite** (`claude/lot-b-construction`, poussée par Claude le 16 novembre) ; attend la tâche 1 de Claude Code |
| 5 | Carte de l'utilisation réelle | terminée, relue, corrigée (`claude/carte-correction`) ; attend la tâche 2 de Claude Code |
| 6 | **Jeu d'entraînement tiré des conversations** (`docs/specs/jeu-conversations.md`, branche `cursor/jeu-conversations`) : un journal du tour dans Jarvis Test (équipe, modèle, fournisseur, outils, durée) et un script de préparation sans modèle (`trieur.jsonl`, `reponses.jsonl`, `a-corriger.jsonl`). Décision de l'utilisateur du 16 novembre. | terminée, relue (`claude/jeu-conversations`) ; dans `claude/dev` |
| 7 | **Informations sur l'écran de l'enceinte, côté PC** — **confiée à Claude Code** le 17 novembre (l'utilisateur ménage son quota Cursor), branche `claude/ecran-infos` partie de `main` : en-tête `X-Jarvis-Ecran`, file par enceinte, bilan de santé et outil `afficher_sur_enceinte`. **Exception validée par l'utilisateur le 17 novembre** : les enceintes sont réservées à la Live, donc ce travail va dans la **Live 5.0.79** avec le programme d'écran (`claude/enceinte-ecran`), après relecture et essai sur la carte. | **terminée** (`claude/ecran-infos`), relue par Claude ; dans `claude/live-5079`, à essayer ce soir |

### Jarvis Development (Claude Code, souvent dans le cloud)

| # | Étape | État |
| --- | --- | --- |
| 1 | **Étude et plan des appendices** (cahier, liste de l'électronique, rapport `rapports/2026-11-17-jarvis-development-etude.md`) | **terminée** le 17 novembre, relue par Claude. Une correction : le bras réel du robot (bras treillis V1, voir plus bas) remplace la « pince simple » de l'étude |
| 1 bis | Corriger l'étude : section des bras et liste du matériel d'après le bras treillis V1 de l'utilisateur | **terminée** la nuit du 18 au 19 novembre (`claude/jarvis-development`) ; `claude/dev` y est fusionnée |
| 2 | **Le socle** (étape 0 du cahier) : contrat commun, registre des appendices, faux appendice, « arrête tout ». Aucun achat. | **terminé** la nuit du 18 au 19 novembre (`claude/socle-appendices`, rapport `rapports/2026-11-19-socle-appendices.md`), relu par Claude : bon. Tout est réglé sur le plus prudent (chaque action d'un appendice demande une carte, seuls l'arrêt et l'arrêt d'urgence partent tout de suite). Trois remarques pour plus tard : le risque d'une capacité ne doit jamais être plus bas que celui de l'appendice (bras et jambes toujours « bouger ») ; refuser les redirections dans le client ; « arrête tout » met aussi l'imprimante en pause (fait à l'étape 3). Pas encore essayé dans la fenêtre ni à la voix. |
| 3 | **L'imprimante sous surveillance** (étape 1 du cahier). Cahier écrit par Claude le 19 novembre : `docs/specs/imprimante-surveillance.md` (webcam USB sur le Pi de Klipper, prise Shelly Plug S Gen3 parlée **directement** par le PC, surveillance par règles sans modèle, pause puis alerte puis annulation, coupure de la prise en dernier et seulement si Klipper ne répond plus pendant que la prise mesure une chauffe). Branche `claude/imprimante-surveillance` partie de `claude/socle-appendices`. | **cœur fait par Claude (le chat) le 19 novembre** (`packages/core/src/impression/`, 35 essais, rapport `rapports/2026-11-19-imprimante-surveillance-coeur.md`). **Ajouté le même soir, à la demande de l'utilisateur : messages envoyés tout seuls** à l'enceinte et au téléphone : à 25, 50 et 75 % (« tout va bien » ou ce qui cloche, temps restant, photo), à la fin (durée, incidents, « vérifie la pièce »), et à chaque alerte, pause ou coupure. Heures calmes 23 h → 7 h par défaut : écran seul et téléphone sans sonner, sauf les alertes qui sonnent toujours (`annonces.ts`, 47 essais en tout, rapport `rapports/2026-11-19-imprimante-annonces.md`, branche `claude/atelier-3d`). Pour Claude Code au branchement : file d'annonces de l'enceinte (mise à jour de la carte) et notifications du téléphone (Web Push, autorisation une fois sur l'iPhone). **Ajouté ensuite, à la demande de l'utilisateur : problèmes objet par objet et contrôle du plateau** (rapport `rapports/2026-11-19-imprimante-objet-par-objet.md`, même branche) : avant de lancer, lecture du G-code (objet en partie hors de la feuille, partie posée sur rien, objet qui ne touche pas, hors volume, bord, objets collés, bascule, hors zone palpée), feuille décalée mesurée par la caméra, pièce oubliée sur le plateau ; pendant, la caméra suit chaque objet et arrête un objet raté seul (`EXCLUDE_OBJECT`, 2 minutes après l'alerte sans réponse, « garde-le » / « arrête-le »), pause si plusieurs objets ratent ensemble (décalage de couche, feuille qui glisse) ou si plus rien ne grandit. Catalogue de 35 pannes (`pannes.ts`) et simulateur d'images : 38 essais, aucune fausse alerte sur l'impression normale. **Images simulées seulement : banc de vraies photos obligatoire avant de laisser Jarvis arrêter un objet tout seul.** Demande aussi : étiquettes d'objets dans OrcaSlicer, `[exclude_object]` dans Klipper, une photo par couche tête garée (ou caméra fixée au plateau), une page de calage de la caméra. Reste à Claude Code : contrôles complets sur le PC et branchement côté PC (rapport, section 2), après les tâches 1 quater et 1 ter. Les essais en vrai attendent seulement la prise (environ 24 €) : une webcam est déjà branchée sur Klipper (dit par l'utilisateur le 19 novembre). |
| 4 | **L'atelier 3D** (priorité de l'utilisateur depuis le 19 novembre, `docs/specs/atelier-3d.md`) : gabarits de pièces réglables, mesures lues dans la phrase, image de la pièce, fichier pour l'Ender 3 S1 Plus, impression avec carte puis surveillance. | **cœur fait par Claude (le chat) le 19 novembre** (`claude/atelier-3d`, 10 pièces, 33 essais, rapport `rapports/2026-11-19-atelier-3d-coeur.md`) ; trancheur : OrcaSlicer. Reste à Claude Code : OpenSCAD et OrcaSlicer sur le PC, branchement, essais, juste après l'étape 3 |

Le reste de l'ordre (sens, maison, robot qui voit, bras, couper Jarvis) est dans le cahier, section 6, et se décide étape par étape. Le **bras du robot** est celui que l'utilisateur a déjà conçu : bras treillis V1, 2 × 150 mm, servos de 25 et 35 kg déjà achetés, pince à deux mâchoires, carte PCA9685, alimentation des servos 6,8 à 7,4 V et 10 A au moins.

### Essais de modèles

Ils sont arrêtés depuis le 12 novembre. Ornith-1.0-9B fait 84/87 au banc, mais il a raté une vraie mission, à 6,4 jetons/s sur la RTX 2060. Le choix des modèles se fera avec l'examen tiré de l'usage réel (tâche 2 de Claude Code, puis l'examen tiré de l'usage), pas avant.

### En pause (ne pas commencer sans que cette feuille le dise)

Carte de l'utilisation (19 novembre, 479 demandes à Jarvis) : surtout le soir en semaine, plus d'une demande sur trois par l'enceinte, 43 % de discussion, une seule demande de code. L'utilisateur précise : il ne demande pas de code à Jarvis parce que Jarvis Développeur n'est pas assez simple (d'où la tâche 1 ter), pas faute de besoin. **jarvis-coder v2 reste en pause** jusqu'à ce que Jarvis Développeur facile soit utilisé pour de vrai.


- jarvis-coder v2 (sera réécrit d'après l'usage réel) ;
- la flotte de location ;
- le spécialiste impression 3D ;
- le trieur (le cerveau trie juste 70 % du temps, le trieur 42 %) ;
- Jarvis Imager ;
- le studio de voix ;
- le lot C (chantier) ;
- le lot D.

## 4. Ce qui dépend de quoi (à prévoir dès maintenant)

- **Live et Test** :
  - tout nouvel outil doit pouvoir tourner dans deux installations côte à côte, avec des dossiers de réglages séparés, des ports et un raccourci différents (prévoir une base de port, jamais un port en dur dispersé dans le code) ;
  - **Live garde** le mot de réveil, les enceintes, le téléphone et Ctrl+Espace ; Test ne les prend jamais en même temps ;
  - les modèles Ollama sont partagés.
- **Carnet des ratés** :
  - chaque nouvel outil doit rendre un **résultat clair** (réussi, raté et pourquoi), jamais un « fait » non vérifié, et chaque chemin du chef d'orchestre doit noter l'équipe choisie et comment (`route`), pour que les ratés soient lisibles ;
  - les corrections de l'utilisateur (« non, c'est faux ») sont déjà repérées (`classifyUtterance`) : le carnet s'appuiera dessus.
- **Données d'entraînement de demain** : le carnet, la carte de l'utilisation et le journal du tour (`turnLog`, mission 6 de Cursor) produiront les exemples des spécialistes. Une réponse n'entre dans un jeu d'entraînement que si le journal prouve qu'elle vient d'un modèle ouvert local ; une correction n'est jamais écrite par Claude. Tout ce qui touche aux phrases de l'utilisateur reste local et se compte, sans se recopier dans le dépôt.
- **L'imprimante 3D** : le client Moonraker du lot B sera réutilisé par le futur spécialiste impression 3D, qui vérifiera ses exercices avec Klipper en mode simulation. Il doit donc vivre dans `packages/core`, sans Electron, avec un faux Moonraker de test.
- **Les enceintes** :
  - le contrat de tour de parole (`/api/speaker/turn`, `/wake`, en-têtes, Jarvis Réflexe) ne change pas sans cahier ;
  - les cartes sont des copies XH-S3E N16R8, câblées selon `firmware/jarvis-speaker/include/config.h`.
- **L'équipe de développeurs** : chef `qwen3-coder:30b` (plans, architecture) et artisan **Ornith-1.0-9B** (84/87 au banc du 12 novembre). Jarvis Développeur choisit un modèle par rôle ; n'ajoute rien qui suppose un seul modèle de code.
- **Les cartes louées** (RunPod) pour les gros calculs : la clé n'est jamais dans le dépôt (variable `RUNPOD_API_KEY` sur le PC, secret `jarvis_cle` dans RunPod), et chaque machine doit pouvoir s'arrêter seule.

## 5. Où trouver le reste

- État technique de chaque version : `CLAUDE.md`.
- Qui travaille sur quoi en ce moment : `AGENTS-COORDINATION.md`.
- Cahiers des charges : `docs/specs/` (sur `main` et sur les branches `claude/specs-…`).
- Revues de Claude : `docs/revues/` (branche `claude/revues` et branches de cahiers).
- Méthode des spécialistes : `docs/specs/specialistes.md` (branche `claude/specs-specialistes`).

## 6. Idées en attente (ne pas commencer)

- Le spécialiste impression 3D (Klipper).
- jarvis-coder v2, réécrit d'après l'usage réel.
- La flotte de location (plusieurs machines louées en parallèle).
- Les images de Driver's Ink et les textures.
- La voix de Jarvis.
- **Écran sur l'enceinte** : programme écrit par Claude le 16 novembre (`claude/enceinte-ecran`, heure, écoute, réflexion, erreurs ; sans écran branché, rien ne change). À compiler et essayer sur la carte par Claude Code, puis l'animation dessinée par l'utilisateur.
- **Atelier 3D à la voix** : sorti des idées en attente le 19 novembre, c'est maintenant une des deux priorités (section 1, cahier `docs/specs/atelier-3d.md`). Principe retenu : le gabarit fait la pièce, le modèle remplit les mesures ; Blender n'est plus prévu pour la première version.
- **Jarvis autonome** (objectif du 16 novembre). Jarvis surveille, repère ce qui ne va pas et agit seul **dans le sens de la sécurité**, puis prévient. Par étapes, chacune essayée dans Jarvis Test avant la suivante :
  1. **Surveillance de l'imprimante 3D.** Il suit l'impression par Moonraker (températures, progression, erreurs de Klipper) et par la caméra de l'imprimante. Un petit modèle de vision local reconnaît une impression ratée (« spaghetti », pièce décollée). S'il en est sûr, il **met en pause** (réversible), envoie une alerte avec la photo sur le téléphone et l'enceinte, puis **annule** si l'utilisateur ne répond pas dans le délai qu'il a choisi. Une règle de l'utilisateur peut autoriser l'annulation directe. Il faut d'abord : le lot B dans Test, une caméra sur l'imprimante, un banc de photos réelles (réussies et ratées) pour mesurer les fausses alertes avant de laisser Jarvis agir.
  2. **Règles permanentes** (« si l'impression part en vrille, annule-la », « préviens-moi quand elle est finie »). L'utilisateur les écrit ou les valide une fois. Un journal dit ce que Jarvis a fait seul. Jamais une règle qui démarre une impression, chauffe ou fait bouger le robot sans accord.
  3. **Le robot range quelques petites choses.** Jarvis lance le robot (Jarvis Rover) pour ramasser et poser 2 ou 3 petits objets à un endroit connu. Il faut d'abord : une pince ou un bras sur le robot (il n'en a pas aujourd'hui), une caméra, une zone de travail délimitée, une vitesse réduite et l'arrêt d'urgence ; au début, chaque départ du robot reste confirmé.
  - Toujours : l'arrêt d'urgence et « stop » passent avant tout. Une action autonome n'a jamais le droit d'être plus risquée que de ne rien faire.
- **Œil de pièce : boîtier de vision qui détecte sur place** (idée du 17 novembre, mise de côté par l'utilisateur ; appendice « Yeux » de Jarvis Development). Version retenue si on la reprend : un Raspberry Pi 5 2 Go, une seule caméra grand angle (environ 120°) sur un servo de 180° (environ 300° couverts, 3 positions, un tour en environ 1,5 s, pas de câble qui s'enroule), la détection faite par le processeur du Pi (7 à 15 images par seconde, il en faut 1 à 2), précédée d'une simple comparaison d'images pour ne détecter que quand ça bouge. La tête se tourne vers le mur quand la caméra est coupée. Environ 130 à 140 € (environ 60 € en reprenant le Pi 5 actuel). Le module IA (environ 90 €) s'ajoute plus tard seulement si la mesure le demande. Écartée : deux caméras fish-eye 220° + Pi 5 8 Go + module IA, environ 400 €, jugée trop chère. Jamais dans une chambre, rien dans le cloud.
- **Holo desk : piloter l'atelier avec les mains** (idée du 22 novembre, d'après une vidéo envoyée par l'utilisateur). Un écran « Atelier » en plein écran sur le PC : la caméra de l'imprimante, la liste des fichiers et l'aperçu 3D de la pièce. On le pilote avec les mains devant la webcam du PC : main ouverte pour afficher, pincer pour choisir, attraper pour tourner la pièce. La reconnaissance des mains se fait sur le PC, sans Internet (MediaPipe, gratuit, tourne sur le processeur). **Un geste ne lance jamais une impression à lui seul** : le départ reste confirmé à la voix ou au clic. À placer après l'atelier 3D à la voix et la surveillance de l'imprimante. Il faut une webcam sur le PC (environ 25 à 40 € s'il n'y en a pas).
- **Vraie conversation** (objectif du 16 novembre, prochain grand chantier après Jarvis Test et la carte de l'utilisation). Comme le mode voix des grands assistants, mais en local. Par étapes, chacune mesurée (temps entre la fin de la phrase et le premier mot de Jarvis) et essayée dans Jarvis Test :
  1. **Couper Jarvis** sur le PC : dès que l'utilisateur parle, la voix s'arrête net et Jarvis écoute. Il faut l'annulation d'écho du micro (Jarvis ne doit pas s'entendre lui-même), sans remettre le contrôle automatique du volume coupé en 0.4.16.
  2. **Répondre plus vite** : transcription au fil de la parole, réponse du modèle en flux et voix phrase par phrase (Jarvis Réflexe en fait déjà une partie). Le chronomètre et les mesures de la mission « Jarvis plus rapide, sans nouveau modèle » servent de point de départ. Cible : moins de 1,5 s entre la fin de la phrase et le premier mot.
  3. **Savoir quand c'est à lui** : un petit détecteur de fin de tour (ouvert, local) plutôt qu'un silence fixe de 650 ms. « Euh… attends » ne déclenche pas de réponse.
  4. **Sur l'enceinte** : garder le micro ouvert pendant que Jarvis parle, grâce à l'annulation d'écho de la carte (ESP-SR sait la faire avec le son joué comme référence). On peut alors couper Jarvis depuis la chambre.
  - Bibliothèques ouvertes à étudier avant d'écrire du code (Pipecat, LiveKit Agents) : on reprend leurs idées, et leur code seulement si la licence le permet.
  - Un service en ligne (voix en temps réel d'OpenAI ou de Google) ferait tout ça tout de suite, mais il est payant à la minute et la voix part sur Internet. Ce serait au mieux une option, jamais le chemin par défaut : le but reste un Jarvis local.
