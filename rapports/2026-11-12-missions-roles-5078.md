# Missions Jarvis Développeur : Codeur par rôle, réflexion coupée, revue non faite dite telle quelle

Branche `claude/missions-roles-5078`, partie de `main` (932d048). **Pas de fusion, pas de publication**, version inchangée (5.0.76) : ces corrections iront dans la 5.0.78, à part de `claude/live-5077`.

## D'où ça vient

Mission d'essai du 12 novembre 2026 dans le Jarvis installé, après avoir réglé « Modèle par rôle » (ARCHITECT et REASONER = `qwen3-coder:30b` ; CODER, DEBUGGER, TESTER, REVIEWER, DOCUMENTATION = Ornith-1.0-9B) : « Ajoute un bouton Pause au Pong » sur le projet `pong-benchmark`. Jarvis a dit **« Réussie »** en 7 min 50 s. Trois choses clochaient :

| Constat | Cause dans le code |
| --- | --- |
| Le Codeur a tourné sur `qwen3.5:4b` (le « Modèle de code »), pas sur Ornith | `buildMissionModelPlan` prenait `developer.codeModel` pour la boucle de tâche et ignorait `roleModels.CODER` ; et `chooseCreationCoder` aurait refusé un 9B dense (règle « tient dans 6 Go ») |
| La revue d'Ornith a échoué (« réponse sans JSON après une relance », 177 s) | Le fournisseur de code ne passait pas `think: false` : la « réflexion » du modèle mangeait le plafond de jetons de l'étape avant le JSON. Vérifié à part sur le même diff : JSON correct en 8 s sans réflexion, 37 s avec |
| La mission était « Réussie » alors que la revue n'avait pas eu lieu, et le bouton n'était pas branché sur la boucle du jeu | La revue non faite était « non bloquante » (5.0.1) : tests verts = réussite, sans le dire |

## Ce qui change

1. **Le Codeur choisi dans « Modèle par rôle » prime** sur le « Modèle de code » pour les missions qui écrivent du code (`roleModelRouting.ts`, `buildMissionModelPlan`). Journal : « Codeur de mission : « X » choisi dans Modèle par rôle, respecté ». Un choix absent d'Ollama retombe sur le modèle de code comme avant. Le relecteur et le débogueur sans choix dédié partagent ce Codeur (un seul modèle chargé à la fois), ceux qui ont un choix le gardent.
2. **Règle 6 Go assouplie pour ce choix explicite** (`chooseCreationCoder`, option `userChosen`) : un 9B dense en Q4 (6,2 Go estimés) est gardé, avec une ligne dans la discussion (« gardé bien qu'il dépasse un peu 6 Go, une partie des couches tourne sur le processeur ») ; un 14B dense reste remplacé. Sans choix explicite, la règle stricte ne change pas. Mesure qui justifie la tolérance : Ornith 9B Q4 chargé à 71 % sur la RTX 2060, 15 à 17 jetons/s (banc du 12 novembre).
3. **Réflexion coupée par défaut dans le fournisseur de code** (`codeProvider.ts`) : `think: false` est envoyé à Ollama pour toutes les étapes de Jarvis Développeur, sauf réglage explicite du catalogue (`think: true` garde la main). Le laboratoire le faisait déjà pour tous les modèles ; le chat ne change pas (`ollama-unchanged.test.ts` vert sans régénération).
4. **Revue non faite = « Tests verts, revue non faite : à vérifier toi-même »**, plus jamais « Réussie » :
   - la revue structurée porte `skipped` et `skipReason` (erreur, délai, réponse illisible) ;
   - la preuve de mission (`evidence.ts`) devient « Non vérifié » avec cette phrase comme raison : la mission finit `finished` **sans verdict « réussie »**, elle n'est jamais candidate au jeu d'entraînement ni à une compétence ;
   - **rapport de la tâche** : « **Verdict :** Tests verts, revue non faite : à vérifier toi-même. Aucun nouvel échec par rapport à la référence, mais le relecteur n'a pas pu relire le diff (raison). Relis-le toi-même avant d'appliquer. » et une section « Revue non faite » ;
   - **discussion** : le résumé de la mission commence par cette phrase, la ligne d'activité dit « Mission terminée, à vérifier : … », et le bloc de mission du chat reprend le rapport de la tâche ;
   - « Appliquer » reste possible (c'est à toi de relire), mais rien n'est appliqué tout seul : les chemins qui fusionnaient d'eux-mêmes une mission « réussie » ne le font pas ici ;
   - l'historique des modèles ne compte pas la panne du relecteur contre le codeur (tests verts).

## Ce que ça aurait donné sur la mission d'essai

Avec ces corrections, la même mission aurait tourné avec Ornith comme Codeur (à la place de `qwen3.5:4b`), la revue aurait eu sa réponse JSON en quelques secondes (et, d'après l'essai à part, aurait signalé « bloquant : la variable `paused` n'est jamais lue par la boucle du jeu », renvoyant la mission en correction) ; et si la revue avait encore échoué, le verdict aurait été « Tests verts, revue non faite : à vérifier toi-même » au lieu de « Réussie ».

## Mission d'essai relancée en dev (12 novembre, 17 h 03, branche `claude/missions-roles-5078`)

Jarvis lancé depuis le code de la branche (`electron-vite dev` avec le port de débogage, mêmes réglages que le Jarvis installé : le mode dev et l'installateur partagent le même dossier de données), Jarvis installé fermé pendant l'essai puis relancé. Même mission « modify » sur `pong-benchmark`, demande reformulée (« Ajoute au Pong un bouton « Pause » … ») pour ne pas retomber sur le nom de branche de l'essai du matin. Plan et cartes validés par le script de suivi à la place de l'utilisateur ; aucune carte destructive.

| Étape | Modèle | Durée | Résultat |
| --- | --- | --- | --- |
| Raisonnement | qwen3-coder:30b | 88 s | objectif et 5 critères |
| Conception | qwen3-coder:30b | 169 s | 4 tours, 5 fichiers lus |
| Plan | **Ornith-1.0-9B** | 219 s | 4 fichiers (index.html, game.ts, main.ts, game.test.ts) |
| Tests de référence | — | 5 s | typecheck OK, 10 tests verts |
| Modification | **Ornith-1.0-9B** | 532 s (13 tours, 6,4 jetons/s) | 4 fichiers modifiés |
| Tests | — | 5 s | 1 échec sur 11 (le nouveau test de pause) |
| Diagnostic | Ornith-1.0-9B | 142 s | « update ne gère pas paused » |
| Correction | Ornith-1.0-9B | 236 s (16 tours) | 5 fichiers (src/rules.ts hors plan) |
| Tests | — | 4 s | même échec : **arrêt net** (5.0.1) |

**Verdict de Jarvis : « Échec »**, en 23 min 31 s, mission `failed`, preuve `failed`. Rapport de la tâche : « Échec : des tests échouent encore après les corrections. Arrêt net : la correction 1 reproduit exactement le même échec … le modèle tourne en rond. » La copie de l'utilisateur n'a pas été touchée ; la copie isolée est `pong-benchmark-taches/2026-11-12-ajoute-au-pong-un-bouton-pause-un-bouton` (branche `jarvis-dev/…`), gardée.

Ce que l'essai montre :

1. **Correction 1 vue en vrai.** Ligne de la mission : « Codeur : « hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q4_K_M » choisi dans Modèle par rôle, gardé bien qu'il dépasse un peu 6 Go (une partie des couches tourne sur le processeur) ». Plan, modification, diagnostic et correction ont tourné sur Ornith (le matin : `qwen3.5:4b`). Coût : 6,4 jetons/s contre 64 pour le 4B, soit 532 s de modification contre 50 s, et 23 min 31 s de mission contre 7 min 52 s.
2. **Correction 2 non mesurable ici** : la revue n'a pas été atteinte (tests jamais verts), donc pas de comparaison avec les 177 s « sans JSON » du matin. Aucune étape n'a rendu de « réponse sans JSON » ; les durées d'Ornith viennent de sa lenteur (couches sur le processeur), pas d'une réflexion.
3. **Correction 3 non atteinte** : pas de revue, donc pas de cas « revue non faite ». Le verdict « Échec » est juste : le test écrit par Ornith (`update(start, keys(), 1/60)` doit rendre `paused: true` sans qu'aucune touche ne soit enfoncée) est faux, et `game.ts` ne fait que sortir de la pause, jamais y entrer ; `main.ts` arrête l'animation au clic (ça marche dans le navigateur) mais l'état du jeu ne le sait pas. Le matin, le même genre de bouton non branché était passé en « Réussie » ; cette fois la boucle s'est arrêtée dès la correction répétée.

Observation faite pendant l'essai, **corrigée ensuite sur cette branche** (voir « Correctif de sécurité : mode direct ») : en mission lancée en mode direct (`hooks.directRun`), un fichier hors plan et non protégé (`src/rules.ts`) était écrit sans carte, avec la mention « Validé par le plan » au journal alors que le plan ne le listait pas ; le rapport le marquait bien « hors plan ».

Reste à voir en vrai, une fois la branche dans une version installée : l'étape Revue avec Ornith (durée, JSON), et le verdict « Tests verts, revue non faite : à vérifier toi-même » en faisant échouer la revue exprès.

## Correctif de sécurité : mode direct (5e changement, demandé après l'essai)

Depuis la 5.0.6, une mission « modifier », « corriger » ou « nouveau projet » (et la discussion projet) tourne en **mode direct** (`TaskHooks.directRun`) : plan auto-validé, npm et tests dans la copie isolée sans carte. Dans ce mode, `TaskRun.decide` (`task/taskFlow.ts`) acceptait **tout** outil fichier sans regarder le plan et l'inscrivait dans `planApproved`, d'où « Validé par le plan » au journal pour `src/rules.ts` ce soir. Les fichiers protégés (cœur, dépendances, structure du gabarit) avaient déjà leur carte « toujours à confirmer ».

Désormais, en mode direct :

- un outil fichier (`dev_create_file`, `dev_edit_file`, `dev_write_file`) passe par la **même règle qu'en mode normal** (`planCoverage`, décision 9) : fichier du plan → sans carte, inscrit « Validé par le plan » ; **fichier hors plan → carte** (« fichier hors du plan validé », tri « confirmation », diff exact de la modification) ; fichier protégé → carte « toujours à confirmer » comme avant. Carte refusée = rien d'écrit ;
- les dépendances et les tests de la copie isolée restent sans carte (comportement 5.0.6), mais le journal dit « Mode direct : sans carte », plus « Validé par le plan » ;
- « Validé par le plan » n'est inscrit au journal que si le plan couvre vraiment l'action (`planApproved` ne grandit que dans ce cas).

Test `task/directRunCoverage.test.ts` (rejoue le cas de ce soir : mission « modifier » sur un projet importé, plan limité à `src/version.ts`, modèle scripté qui crée ensuite `src/rules.ts` hors plan puis touche `package.json`) : `version.ts` écrit sans carte et « Validé par le plan » au journal ; `rules.ts` et `package.json` ont chacun leur carte (raison, tri, diff), refusée ici, donc absents de la copie isolée, hors de `planApproved`, sans « Validé par le plan » ; les séries de tests non plus.

## Tests

- `roleModelRouting.test.ts` : Codeur par rôle respecté (mission modify), choix absent → modèle de code, 9B dense gardé avec `userChosen` et non sans, 14B refusé même assoupli.
- `codeProvider.test.ts` : `think: false` par défaut, `think: true` explicite gardé, `recoverToolCalls` inchangé.
- `evidence.test.ts` : tests verts + revue non faite → « Non vérifié », phrase exacte, jamais candidate, pas de compétence ; sans revue manquée, succès vérifié inchangé.
- `fallbackMission.test.ts` (mission réelle avec un modèle scripté dont la revue échoue) : `review.skipped`, verdict de mission nul, preuve « non vérifiée », résumé et rapport qui commencent par « Tests verts, revue non faite : à vérifier toi-même », section « Revue non faite ».

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npm run build, code 0)
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : OK sauf 1 échec connu (3177/3178 réussis, 8 ignorés : cœur 2397/2397, bureau 780/781 ; l'échec est « Construire manuel » de windowsDesktopMissionPath.test.ts, cassé depuis le 10 novembre et exclu de release.sh depuis la 5.0.73, sans rapport avec ces changements)
Secrets   : OK (0 trouvé ; seules valeurs factices des tests)
Fichiers modifiés : packages/core/src/developer/engine/roleModelRouting.ts (+test), packages/core/src/developer/codeProvider.ts (+test), packages/core/src/developer/evidence.ts (+test), packages/core/src/developer/engine/missionPrompts.ts, packages/core/src/developer/index.ts, apps/desktop/src/main/developer/mission/missionWorkflow.ts, apps/desktop/src/main/developer/task/report.ts, apps/desktop/src/main/developer/task/taskFlow.ts, apps/desktop/src/main/developer/task/taskRun.ts, apps/desktop/src/main/developer/task/directRunCoverage.test.ts (nouveau), apps/desktop/src/main/developer/controller.ts, apps/desktop/src/shared/developerIpc.ts, apps/desktop/src/main/developer/mission/fallbackMission.test.ts, CLAUDE.md, AGENTS-COORDINATION.md, ce rapport
Prêt à fusionner : NON (prévu pour la 5.0.78, pas maintenant ; et le test windowsDesktopMissionPath reste à réparer, hors de cette branche)
À corriger : windowsDesktopMissionPath.test.ts « Construire manuel » (déjà listé, décision de l'utilisateur)
Testé en vrai (à la voix, sur le PC) : FAIT EN PARTIE (mission relancée en dev le 12 novembre à 17 h 03 : Codeur par rôle vu en vrai ; revue jamais atteinte, donc réflexion coupée et « revue non faite » restent à voir)
```

À tester toi-même, une fois la branche dans une version installée :

1. ~~Jarvis Développeur → Modèle par rôle : CODER = Ornith ; mission « Modifier » sur le Pong.~~ Vu en dev le 12 novembre : la ligne Codeur affiche Ornith et la mission dit « choisi dans Modèle par rôle, gardé bien qu'il dépasse un peu 6 Go ».
2. Même mission : l'étape Revue doit finir en moins d'une minute avec un verdict (plus de « réponse sans JSON »).
3. Si une revue échoue quand même (par exemple en arrêtant Ollama pendant la revue) : le rapport doit afficher « Tests verts, revue non faite : à vérifier toi-même », pas « Réussie ».
