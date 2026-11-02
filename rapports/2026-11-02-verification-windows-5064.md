# Vérification Windows de la 5.0.64 (2026-11-02)

Suite de la section « Non publié — à faire sur le PC Windows » de `rapports/2026-11-02-integration-5064.md`. Branche `claude/nuit-3`, à partir de `main` = `origin/main` (`e6157c7`, version 5.0.64). Machine : Windows 10 (19045), Node 22.23.4, Git 2.56.0.windows.1, SDK .NET 8.0.425, `core.autocrlf=true` (dépôt extrait en CRLF). Aucun fichier du produit modifié ; les sondes temporaires ont été supprimées.

**Verdict : la 5.0.64 n'est pas publiée.** Points 4 et 5 vérifiés et conformes sur Windows, typecheck et lint à zéro, mais `npm test` laisse 27 échecs (1 cœur, 26 bureau) là où seuls 5 échecs dotnet étaient attendus. Et `gh` n'est pas installé sur ce PC (`release.sh` s'arrête à l'étape 1 ; la 5.0.63 avait été publiée par Cursor, sous wine).

## 1. Points 4 et 5 : vérification réelle

Les deux outils ont été appelés tels quels (`runCommandTool.run`, `closeApplicationTool.run`) depuis un test Vitest temporaire, PowerShell réel, processus réels, comptage par `Get-Process` avant et après.

| Vérification | Résultat | Mesure |
| --- | --- | --- |
| Point 4 : `cmd /c ping -n 60 127.0.0.1`, délai 3 s | « ⏱ Délai dépassé : la commande a été interrompue », `timedOut: true` | 3,3 s ; `PING.EXE` : 0 processus après |
| Point 4 : `cmd /c start /wait notepad`, délai 3 s | même message | 3,4 s ; `notepad` : 0 avant, 0 après (la fenêtre lancée par l'enfant a disparu) |
| Point 5 : « Ferme Discord » (7 processus) | `ok: false` : « “Discord” est toujours ouvert : l'application attend sans doute une réponse (document à enregistrer ?). Fermé : Discord. » | 6,3 s ; 7 → 5 processus (Discord se replie dans la zone de notification sur la fermeture de sa fenêtre) |
| Point 5 : « Ferme Discord », `forceKill` | `ok: true`, « Fermé : Discord » | 2,1 s ; 0 processus après |
| Point 5 : accès refusé (`audiodg`, processus système) | `ok: false`, « Accès refusé pour “audiodg” : ce programme tourne sans doute en administrateur, Jarvis ne peut pas le fermer. », aucune exception | 0,9 s ; processus intact |

Conformité : arborescence entière tuée après le délai, « commande interrompue » dit, aucun orphelin ; fermeture multi-processus en moins de 15 s, « Fermé » seulement quand les processus ont disparu ; accès refusé rapporté sans erreur. Discord a été relancé après le test.

Remarques (non bloquantes) :
- Le cas « accès refusé » a été joué sur un processus système (`audiodg`) et non sur un programme lancé par l'utilisateur en administrateur : une élévation UAC ne peut pas être validée sans personne devant l'écran. Le chemin de code est le même (`Stop-Process` refusé → `DENIED=`).
- Quand une partie des processus d'une application se ferme et l'autre reste, le message dit « “Discord” est toujours ouvert … Fermé : Discord. » : le même nom dans les deux listes se lit mal. Suggestion : n'écrire « Fermé » que si aucun processus du même nom ne reste.
- La sortie de `ping` arrive dans la page de code OEM (accents illisibles) : `run` sans PowerShell ne force pas l'UTF-8. Antérieur à 5.0.64, cosmétique.

## 2. `npm run typecheck`, `npm run lint`

0 erreur, 0 problème.

## 3. `npm test`

Cœur : 1 échec, 2 127 passés (160 fichiers). Bureau : 26 échecs + 1 suite en échec, 587 passés, 8 ignorés (115 fichiers). Attendu : 0 (le SDK .NET est présent). Les fichiers suspects ont été rejoués en isolation pour séparer la charge des causes réelles.

### a. Charge de la machine (verts en isolation) — 3

- `packages/core/src/learning/constraints.test.ts` (délai 5 s), `apps/desktop/scripts/lintBaseline.test.mjs` (délai 5 s) : rejoués seuls, verts.
- `apps/desktop/src/main/knowledge.test.ts` « deux magasins » : `EPERM` sur `knowledge-index.json.lock` ; vert en isolation. Sous Windows, `open(…, 'wx')` sur un verrou en cours de suppression renvoie `EPERM`, que `acquireIndexLock` ne réessaie pas (seul `EEXIST` l'est). Course rare, à durcir.

### b. Propres à ce PC — 9

- **Ports réservés par Windows** (plages exclues Hyper-V/WSL, `netsh interface ipv4 show excludedportrange protocol=tcp` : 53083–53182) : `SpotifyProvider.test.ts` ×2 (`listen EACCES 127.0.0.1:53124`) et `google.test.ts` ×1. Conséquence réelle sur ce PC : la connexion Spotify (port fixe, URI de redirection exacte) est impossible tant que la plage est réservée ; la connexion Google échoue aussi, car `oauth.ts` ne prend un port libre que sur `EADDRINUSE`, pas sur `EACCES` (« Un pare-feu bloque peut-être Jarvis »). À traiter côté code pour Google ; pour Spotify, documenter (`netsh int ipv4 add excludedportrange` ou redémarrage).
- **SiteBlock installé** : `SiteBlockBridge.test.ts` « ne lit jamais process.env » lit `%APPDATA%\SiteBlock\api.json`, présent ici, et le `fetch` simulé renvoie `undefined`. Le test dépend de la machine : isoler le chemin `APPDATA` dans le test.
- **SDK .NET 10 exigé par les tests** : `dotnetProject.test.ts` ×1 et `windowsDesktopMissionPath.test.ts` ×4 attendent `net10.0-windows` en dur (`dotnet restore` échoue, exe attendu sous `bin/Release/net10.0-windows`). Avec le SDK 8.0.425, ces 5 tests échouent autrement que « SDK absent ». Ce sont les 5 tests dotnet connus ; ils n'ont donc jamais été verts sur ce PC.

### c. Bogues Windows du code, reproductibles en isolation — 7

- **`dev_search_code` ne renvoie rien sur un dépôt en CRLF** (`apps/desktop/src/main/developer/tools/readTools.ts`) : les lignes de `git grep` gardent leur `\r`, et `/^(.*?):(\d+):(.*)$/` ne le couvre pas (`.` exclut `\r` en JavaScript) : chaque résultat est jeté, « Aucun résultat ». Vérifié : le lanceur et `git grep` renvoient bien 46 lignes pour `createToolManager`, l'outil en rend 0. Touche « Analyser mon architecture », « Poser une question », les spécialistes et le banc réel. Échecs : `controller.test.ts` ×1. Correctif : `(.*?)\r?$` ou retirer `\r` avant l'analyse.
- **Banc réel** : `extractFunction` (`packages/core/src/developer/engine/realBench.ts`) cherche `'\n}\n'`, absent d'un fichier CRLF → « extrait attendu absent » (`realBench.test.ts` ×2). Même famille.
- **« Jeter » une copie isolée** (`apps/desktop/src/main/developer/task/sandbox.ts`, `discardWorktree`) : `git worktree remove <dossier>` est lancé avec `cwd` = ce dossier ; sous Windows un processus ne peut pas supprimer son propre dossier courant → « failed to delete … ». Échecs : `sandbox.test.ts` (suite + 1 test), `taskWorkflow.test.ts` ×2, `fixAttemptsTask.test.ts` ×1. `windowsLockMessage` (ajouté par `68ba495`) n'habille que le message. Correctif : lancer la dernière étape depuis la copie de l'utilisateur ou le dossier parent.

### d. Tests non portables sur Windows — 7

- `close-application.test.ts` « le délai partagé dépassé est dit comme tel » : attend `kill('SIGTERM')`, mais sur une vraie plateforme `win32` le lanceur passe par `taskkill` (comportement 5.0.64 voulu, confirmé en réel au point 4) et le `spawn` simulé ne rend jamais la main. Forcer la plateforme ou simuler `taskkill` dans ce test.
- `voicePackaging.test.ts` : compare `electron-builder.yml` avec des `\n` alors que le fichier est extrait en CRLF.
- `platformerMissionPath.test.ts` ×5 : `npm install a échoué : spawnSync npm ENOENT` — un `npm` nu (sans `.cmd`) lancé par `execFileSync('npm', …)` dans le test ; le produit passe par `node npm-cli.js`.

## 4. Publication

Non faite : la suite n'est pas verte, et `gh` est absent de ce PC (`release.sh` exige `gh auth status`). Pour publier depuis ce PC : installer GitHub CLI (`winget install GitHub.cli`), `gh auth login`, puis `./release.sh` depuis `main` une fois les points ci-dessus réglés ou explicitement acceptés.

## 5. Divers

- `package-lock.json` : versions 5.0.63 → 5.0.64 (racine et `apps/desktop`), oubliées à l'intégration ; réécrites par `npm install`, commitées sur cette branche.
- Ressource GPU/Ollama non utilisée par cette vérification.
