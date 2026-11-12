# Feuille de route de Jarvis — à lire avant chaque tâche

Tenue par Claude (le chat, manager du projet). Dernière mise à jour : 12 novembre 2026.

**Claude Code et Cursor la lisent avant chaque tâche**, en même temps que `AGENTS-COORDINATION.md`. Elle dit vers où va Jarvis, qui fait quoi et dans quel ordre, et ce qui en dépend. Le but : qu'aucun outil ne soit construit sans tenir compte de ceux qui viendront s'y brancher.

Ce fichier ne contient ni secret, ni donnée personnelle, ni nom de réseau : le dépôt est public.

## 1. Le cap

- **Jarvis doit être utilisable tous les jours.** Il n'a pas besoin d'être fini à 100 %. L'étape actuelle est : corrections, bogues, finitions.
- **Deux versions de Jarvis :**
  - **Jarvis Live** : celle que l'utilisateur utilise tout le temps. Elle ne reçoit **que** des corrections et des finitions, essayées en vrai avant d'être publiées.
  - **Jarvis Test** : celle où l'on ajoute les nouveautés. L'utilisateur l'essaie de temps en temps. Une nouveauté ne passe dans Live qu'après avoir fait ses preuves dans Test.
- **Le but à long terme** : une IA faite de plusieurs **petits modèles locaux** spécialisés (sur la RTX 2060 de l'utilisateur), qui approchent le niveau d'un gros modèle **sur ses usages à lui**. Un chef d'orchestre envoie chaque demande à la bonne équipe.
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

État au 12 novembre 2026, 19 h 30.

### Claude Code (PC Windows de l'utilisateur, avec le matériel)

| # | Tâche | État |
| --- | --- | --- |
| 1 | **Essais de la Live 5.0.77 avec l'utilisateur, puis publication** (`claude/live-5077`, liste dans `rapports/2026-11-12-live-5077-a-verifier.md`). Sans les essais USB (12 à 18) ni les essais 34 à 36. | **prochaine tâche** |
| 2 | **Live 5.0.78** (`claude/missions-roles-5078`) : Codeur par rôle respecté, réflexion coupée, « revue non faite » dite telle quelle, correctif de sécurité du mode direct. Fusion dans `main` après la 5.0.77, essais, publication. | prête, attend la 5.0.77 |
| 3 | **Jarvis Test** : fusionner `cursor/deux-jarvis`, puis `cursor/carnet-des-rates` (une fois corrigée), dans une branche `dev` à jour avec `main`. Essais : installer Test à côté de Live. Première publication `5.1.0-test.1` avec `release-test.sh`. | attend la 5.0.78 |
| 4 | Ajouter la nuit de génération du 11 novembre au cahier (`lab:clean`) | à faire |
| 5 | Essai du raccordement d'enceinte par USB, avec l'utilisateur et la carte | à faire |
| 6 | Carte de l'utilisation réelle (`claude/carte-utilisation`) : chiffres seulement dans `rapports/` | à faire |

### Cursor (une mission à la fois)

| # | Mission | État |
| --- | --- | --- |
| 1 | Bourse et tri | terminée, dans `claude/live-5077` |
| 2 | Deux Jarvis : Live et Test (`cursor/deux-jarvis`) | terminée et relue ; attend la tâche 3 de Claude Code |
| 3 | Carnet des ratés (`cursor/carnet-des-rates`) | correction de la revue en cours |
| 4 | Lot B, le quotidien (`docs/specs/lot-b-quotidien.md`, branche `claude/specs-feuille-de-route`), pour Jarvis Test, sur la base du carnet | enchaîné juste après la correction du carnet |

### Essais de modèles

Ils sont arrêtés depuis le 12 novembre. Ornith-1.0-9B fait 84/87 au banc, mais il a raté une vraie mission, à 6,4 jetons/s sur la RTX 2060. Le choix des modèles se fera avec l'examen tiré de l'usage réel (tâche 6 de Claude Code), pas avant.

### En pause (ne pas commencer sans que cette feuille le dise)

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
- **Données d'entraînement de demain** : le carnet et la carte de l'utilisation produiront les exemples des spécialistes. Tout ce qui touche aux phrases de l'utilisateur reste local et se compte, sans se recopier dans le dépôt.
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
