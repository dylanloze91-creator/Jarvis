# Cahier des charges — La flotte de location : plusieurs travaux d'IA en même temps, PC éteint

Rédigé par Claude pour Cursor, le 11 novembre 2026.

Ce que veut l'utilisateur : « entraîner nos modèles sur des cartes louées, pour éteindre mon PC et suivre l'avancement d'où je veux. Pouvoir en faire plusieurs en même temps, pour gagner du temps. » Il accepte de payer plus que son électricité (environ 1 € la nuit) pour aller plusieurs fois plus vite, par exemple 5 machines louées à quelques dollars chacune.

À lire d'abord :
- `training/README.md`, `training/cloud/README.md`, `run_remote.sh`, `garde_fou.sh` ;
- `training/TRIEUR.md` ;
- dans `packages/core/scripts/` : `lab-generate.mjs`, `lab-clean.mjs`, `lab-prepare.mjs`, `lab-compare.mjs`, `trieur-generer.mjs`, `trieur-preparer.mjs`, `trieur-banc.mjs` ;
- dans `CLAUDE.md`, les sections 5.0.56 à 5.0.65 et 5.0.68 (trieur).

## Ce qu'on a appris de la première location (jarvis-coder, 5 novembre)

- Le garde-fou n'a **pas** pu tourner : `runpodctl` n'avait pas d'autorisation dans la machine. L'utilisateur a collé sa clé dans le chat, il a fallu la révoquer, et l'entraînement est parti avec `SANS_GARDE_FOU=1`. **C'est le premier problème à régler.** Une machine oubliée coûte sans limite.
- Les fichiers sont passés par `runpodctl send/receive` et par le Jupyter de RunPod : c'est manuel, et il faut que le PC soit allumé et que quelqu'un soit là.
- Les modèles (Hugging Face, Ollama) sont retéléchargés à chaque machine : de 10 à 30 minutes perdues à chaque fois.

## Le résultat visé (ce que fait l'utilisateur)

1. Le soir, sur le PC, il lance une seule commande, ou un bouton plus tard : « Cette nuit : 4 machines de génération d'exercices de code et 1 de phrases pour le trieur, 6 heures au plus, 20 $ au plus. »
2. Le récapitulatif s'affiche (machines, carte, prix par heure, coût maximum de la nuit). Il confirme et éteint son PC.
3. Sur son iPhone, il reçoit des notifications :
   - « 5 machines lancées » ;
   - un point par heure (« Génération : 212 exercices acceptés ») ;
   - « Machine 3 terminée » ;
   - « Erreur machine 2 : … » ;
   - « Tout est arrêté. Coût de la nuit : 13,40 $ ».
4. Toutes les machines **s'arrêtent et se suppriment seules**, à la fin ou au plafond d'heures, même en cas de panne.
5. Le lendemain, PC allumé, une commande « récupérer » rapatrie les résultats, fusionne les exercices des machines sans doublon (`lab:clean`) et dit ce qui est arrivé. Pour un modèle, elle l'installe dans Ollama, à côté des autres.

## Principes

- **Une machine = un travail.** Les travaux qui peuvent tourner en parallèle tournent en parallèle. Ceux qui dépendent d'un autre attendent : l'entraînement après la génération, l'examen après l'entraînement.
- **L'arrêt ne dépend pas du PC.** Chaque machine porte son propre garde-fou, qui marche pour de vrai : on vérifie au démarrage qu'il peut supprimer la machine, sinon la machine refuse de travailler.
- **Un plafond d'argent.** Le récapitulatif calcule le coût maximum (machines × prix par heure × plafond d'heures) et refuse d'aller au-delà du budget donné. Conseil affiché : ne garder sur le compte RunPod qu'un crédit raisonnable, car c'est la limite qu'aucun bogue ne peut dépasser (RunPod se paie d'avance).
- **Les clés ne passent jamais par le chat, le dépôt ou un journal.** La clé API RunPod de l'utilisateur vit sur le PC : dans le coffre de Jarvis (lot A, `coffre.bin`) s'il est utilisable depuis un script, sinon dans une variable d'environnement Windows que l'utilisateur pose lui-même, avec un guide pas à pas. Dans les machines, on utilise ce que RunPod prévoit (« Secrets » du compte, ou clé limitée à la machine) : à vérifier en partie 0.
- **Les données privées ne partent pas.** Les examens (`examen*.jsonl`, phrases de l'utilisateur) ne quittent jamais le PC. Le cahier d'exercices et les données d'entraînement générées partent seulement vers le stockage RunPod de l'utilisateur, jamais sur GitHub. L'examen du code (catalogue d'évaluation) est dans le dépôt : il peut tourner là-bas.
- **Le moins cher qui suffit.** Une carte de 24 Go (A5000, 3090, 4090, L4… selon le prix du moment) pour le professeur 30B et l'entraînement du 7B ; moins pour le trieur. Les **machines interruptibles** (spot, moins chères) pour la génération, qui sait reprendre sans doublon ; les machines normales pour l'entraînement, ou un entraînement qui reprend au dernier point de sauvegarde (`checkpoint-N`, déjà géré).

## Partie 0 — Reconnaissance (rapport `rapports/2026-11-XX-flotte-location-choix.md`)

Vérifie chaque point à la source (documentation RunPod, API), avec la date et le lien :

1. **API RunPod** pour créer, lister, arrêter et supprimer une machine (REST `rest.runpod.io/v1` ou GraphQL) : création avec image, carte, disque, volume, variables, ports et choix spot ou normal ; lecture du prix par heure ; et limite du nombre de machines simultanées pour un compte. Pas de dépendance native : `fetch` de Node.
2. **Autorisation dans la machine** pour qu'elle se supprime elle-même : variable `RUNPOD_API_KEY` injectée par RunPod, « Secrets » du compte (`{{ RUNPOD_SECRET_… }}`), ou clé à droits limités. Dis exactement ce qui marche, et pourquoi `runpodctl get pod` a échoué le 5 novembre.
3. **Volume réseau** (network volume) : prix, centre de données, **peut-il être monté par plusieurs machines en même temps ?** Est-ce qu'on peut lire et écrire ses fichiers depuis le PC sans machine allumée (API compatible S3, si elle existe) ? C'est lui qui garde les modèles téléchargés une seule fois, le cahier et les résultats.
4. **Ollama dans une machine Linux louée** : installation, dossier des modèles sur le volume (`OLLAMA_MODELS`), `qwen3-coder:30b` sur 24 Go.
5. **Notifications vers l'iPhone** : ntfy.sh (gratuit, appli iPhone, sujet aléatoire long qui sert de secret ; ce qui part est public pour qui connaît le sujet, donc **chiffres seulement**, jamais d'exercice ni de chemin). Compare avec une autre solution gratuite si elle est plus sûre.
6. **Machines interruptibles** : comment on est prévenu d'une interruption, et comment reprendre.

Si un point empêche une partie, écris-le, choisis la solution la plus simple qui respecte les principes, et continue.

## Partie 1 — Le lanceur sur le PC

`training/cloud/flotte/` (Node, sans dépendance native ; `npm run flotte --workspace @jarvis/core -- …`, ou un script à la racine de `training/` : à toi de voir, et explique pourquoi).

- `flotte plan` : lit un plan de nuit (fichier JSON ou arguments). Il affiche le récapitulatif (machines, carte, prix, heures, coût maximum) puis demande « Lancer ? (o/n) ».
- `flotte lancer` : crée les machines, attend qu'elles démarrent, vérifie le garde-fou de chacune (une machine sans garde-fou est supprimée tout de suite, et la nuit est signalée), puis envoie la notification de départ. Le PC peut alors être éteint.
- `flotte etat` : machines en cours, avancement et coût jusqu'ici, lus dans l'API et dans le fichier `etat.json` de chaque machine sur le volume.
- `flotte arreter [machine|tout]` : arrêt d'urgence.
- `flotte recuperer` : rapatrie les résultats du volume vers `C:\dev\jarvis-data\` (à côté des données actuelles, sans rien écraser). Il fusionne les exercices de génération puis lance `lab:clean`, met en forme le trieur, installe un modèle exporté dans Ollama (`export_ollama.py --gguf`) et écrit un résumé.
- Les **travaux** connus, chacun avec sa carte minimale, sa durée habituelle et son plafond d'heures :
  - `generation-code` (professeur `qwen3-coder:30b`, `lab:generate`) ;
  - `generation-trieur` (`trieur:generer`) ;
  - `entrainement-coder` (`train_lora.py` 7B puis export GGUF) ;
  - `entrainement-trieur` ;
  - `examen-code` (`lab:compare` sur le catalogue d'évaluation) ;
  - `examen-trieur` : seulement **sur le PC**, puisque l'examen du trieur, ce sont les phrases de l'utilisateur. Le lanceur refuse de l'envoyer.
- **Génération en parallèle sans doublon** : chaque machine reçoit une tranche différente des graines (option `--slice k/n` ou `--salt` distinct à ajouter à `lab:generate` et `trieur:generer`, testée) et écrit son propre fichier (`exercices-m3.jsonl`). Le contrôle de nouveauté voit le cahier existant ; les doublons entre machines sont retirés par `lab:clean` à la récupération.
- **Enchaînement facultatif** : un plan peut dire « après la génération : préparer et entraîner coder, puis l'examiner ». Le lanceur s'en charge sur une petite machine de pilotage, ou par la dernière machine de génération, sans le PC. Il respecte toujours le plafond d'argent.

## Partie 1 bis — Plusieurs travaux sur **une seule** grosse machine (demande de l'utilisateur)

L'utilisateur demande aussi : « plutôt que 5 machines, 5 travaux sur une seule ». Le lanceur doit savoir faire les **deux**. Le plan choisit, et le récapitulatif compare.

- **Génération sur une grosse carte (48 ou 80 Go)** :
  - **un seul** Ollama, qui charge le professeur **une fois** ;
  - `OLLAMA_NUM_PARALLEL` réglé ;
  - N générateurs (`lab:generate` en tranches, `trieur:generer`) qui lui envoient leurs demandes **en même temps**.

  La carte traite plusieurs réponses à la fois. Le débit total est meilleur qu'un générateur seul, mais pas N fois meilleur : il faut le **mesurer**. Note aussi les cœurs de processeur : les contrôles des exercices (tests, erreurs glissées) tournent sur le processeur. Choisis une machine qui en a assez, ou limite les contrôles simultanés.
- **Deux modèles différents sur la même carte** (professeur 30B pour le code et `qwen2.5:7b` pour le trieur) : seulement si la mémoire de la carte les tient tous les deux (`OLLAMA_MAX_LOADED_MODELS`). Sinon, refuse et explique.
- **Entraînement et génération en même temps** : seulement pour deux chaînes **différentes** (par exemple entraîner le trieur pendant la génération d'exercices de code) et si la mémoire suffit. Le cas « générer et entraîner le même modèle en même temps » n'a pas de sens : l'entraînement a besoin du cahier fini. Le lanceur l'enchaîne (génération, puis entraînement) sur la même machine, sans la rendre entre les deux.
- **Mesure (essai réel)** : sur une heure, exercices acceptés par dollar avec
  - (a) une carte de 24 Go et un générateur ;
  - (b) une carte de 24 Go et 2 à 4 générateurs ;
  - (c) une carte de 80 Go et 4 à 8 générateurs.

  Le récapitulatif de `flotte plan` affiche ensuite le mode le plus rentable mesuré. Avant toute mesure, il dit « non mesuré ».
- **Défaut, en attendant la mesure** : une carte de 24 Go par machine. Si (b) ou (c) gagne, ce mode devient le défaut, et le rapport de l'essai le dit.
- Inconvénients à afficher : une panne arrête tous les travaux de la machine, et les grosses cartes interruptibles sont plus rares.

## Partie 2 — Ce qui tourne dans chaque machine

`training/cloud/machine/` (bash et Python déjà présents, ou Node).

- Au démarrage :
  - garde-fou **vérifié** (sinon : notification d'erreur, puis suppression) ;
  - clone du dépôt public à l'étiquette donnée ;
  - montage du volume ;
  - modèles pris sur le volume, ou téléchargés **une seule fois** sur le volume.
- Pendant le travail :
  - `etat.json` sur le volume toutes les minutes (étape, %, compteurs, coût estimé) ;
  - une notification par heure et aux étapes ;
  - journal sur le volume, **sans** exercice ni contenu dans les notifications.
- À la fin, en cas d'erreur, ou au plafond d'heures : résultats écrits sur le volume, notification, puis **suppression** de la machine (pas un simple arrêt : un disque arrêté coûte encore). Le volume reste.
- Machine interruptible coupée : notification, puis reprise possible par `flotte lancer --reprendre`, qui repart du `etat.json` et des fichiers déjà écrits.

## Partie 3 — Sécurité et argent

- `flotte plan` refuse au-delà du budget (`--budget 20`), et refuse plus de N machines (8 par défaut).
- Un dernier filet côté RunPod si l'API le permet (limite de dépense du compte) ; sinon, le conseil du crédit limité, affiché.
- Une notification dès qu'une machine dépasse son plafond d'heures de plus de 10 minutes : c'est que le garde-fou a raté. Le lanceur la supprime au prochain `flotte etat`.
- Jamais de clé dans les fichiers du dépôt, les journaux, les notifications ou `etat.json`. Test : `redactSecrets` passe sur tout ce qui est écrit.

## Partie 4 — Guide

`training/cloud/FLOTTE.md`, en français simple :
- créer la clé RunPod et la ranger (pas à pas, avec captures décrites) ;
- installer ntfy sur l'iPhone et s'abonner au sujet ;
- créer le volume une fois ;
- les commandes du soir et du lendemain ;
- ce que coûte une nuit type ;
- que faire si une notification dit « erreur ».

## Tests (sans compte RunPod)

- Un faux RunPod en mémoire (création, prix, état, suppression, interruption) et un faux ntfy.
- Le plan : coût maximum, budget refusé, trop de machines, examen du trieur refusé.
- Le lancement : une machine sans garde-fou est supprimée.
- La génération en tranches : aucune graine commune entre deux machines.
- La récupération : fusion sans écraser, `lab:clean` appelé, résumé juste.
- Une machine qui dépasse son plafond est signalée puis supprimée.
- Aucun secret dans les fichiers écrits.
- Le script de la machine : un essai à blanc sur le PC (`--a-blanc`) qui fait toutes les étapes avec un travail factice de 10 secondes.

## Ce qui ne change pas

- Les entraînements et générations qui tournent sur le PC marchent comme avant.
- Tests figés verts sans régénération ; `parseSettings({})` ne gagne aucune clé.
- Les règles de données d'entraînement : aucune sortie de Claude ou de Cursor dedans ; l'examen jamais dans l'entraînement ; empreinte de l'examen vérifiée par `train_lora.py`.

## Essai réel (Claude Code, avec l'utilisateur, petit budget)

1. Une machine, travail factice de 10 minutes, budget de 1 $. Contrôles :
   - la notification arrive sur l'iPhone ;
   - la machine se supprime seule ;
   - `flotte recuperer` marche ;
   - le coût affiché égale celui de RunPod.
2. La mesure de la partie 1 bis : (a), (b) et (c) pendant environ 1 h chacun. On garde le mode le plus rentable en exercices acceptés par dollar. Contrôles : aucun doublon, la fusion se fait, et chaque machine se supprime seule.
3. Seulement ensuite, une vraie nuit.

## Livraison

- Branche `cursor/flotte-location` depuis `origin/main`, inscrite dans `AGENTS-COORDINATION.md`. Ne touche pas à `speaker/`, `firmware/`, `market/` ni à l'orchestre : d'autres branches sont en cours.
- Un commit par partie, tests verts. `npm run typecheck`, `npm test` et `npm run lint` avant de pousser.
- Dans `CLAUDE.md`, ta section seulement. Le rapport donne les choix de la partie 0 avec leurs liens, ce qui est fait et ce qui ne l'est pas, et la liste de l'essai réel. Puis le RAPPORT DE VÉRIFICATION.
- Pas de fusion, pas de publication, aucune machine louée créée par toi.
