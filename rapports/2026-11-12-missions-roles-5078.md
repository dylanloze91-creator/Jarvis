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

Non refait en vrai : la mission d'essai n'a pas été relancée avec cette branche (le Jarvis installé est la 5.0.76).

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
Fichiers modifiés : packages/core/src/developer/engine/roleModelRouting.ts (+test), packages/core/src/developer/codeProvider.ts (+test), packages/core/src/developer/evidence.ts (+test), packages/core/src/developer/engine/missionPrompts.ts, packages/core/src/developer/index.ts, apps/desktop/src/main/developer/mission/missionWorkflow.ts, apps/desktop/src/main/developer/task/report.ts, apps/desktop/src/main/developer/controller.ts, apps/desktop/src/shared/developerIpc.ts, apps/desktop/src/main/developer/mission/fallbackMission.test.ts, CLAUDE.md, AGENTS-COORDINATION.md, ce rapport
Prêt à fusionner : NON (prévu pour la 5.0.78, pas maintenant ; et le test windowsDesktopMissionPath reste à réparer, hors de cette branche)
À corriger : windowsDesktopMissionPath.test.ts « Construire manuel » (déjà listé, décision de l'utilisateur)
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```

À tester toi-même, une fois la branche dans une version installée :

1. Jarvis Développeur → Modèle par rôle : CODER = Ornith ; mission « Modifier » sur le Pong (« ajoute un bouton Pause »). Attendu : la ligne Codeur affiche Ornith, et la discussion dit « choisi dans Modèle par rôle, gardé bien qu'il dépasse un peu 6 Go ».
2. Même mission : l'étape Revue doit finir en moins d'une minute avec un verdict (plus de « réponse sans JSON »).
3. Si une revue échoue quand même (par exemple en arrêtant Ollama pendant la revue) : le rapport doit afficher « Tests verts, revue non faite : à vérifier toi-même », pas « Réussie ».
