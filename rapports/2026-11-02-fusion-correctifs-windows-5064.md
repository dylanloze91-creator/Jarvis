# Fusion des correctifs Windows et tentative de publication de la 5.0.64 (2026-11-02, soir)

Suite de `rapports/2026-11-02-verification-windows-5064.md` et de `rapports/2026-11-02-correctifs-windows-5064.md`. PC Windows 10, Node 22.23.4, Git 2.56, SDK .NET 8.0.425. **Le générateur d'exercices (nuit 4, `lab:generate`, qwen3-coder:30b) tournait sur le processeur pendant toute cette vérification** : la machine était chargée, ce qui compte pour la lecture des délais ci-dessous.

**Verdict : la 5.0.64 n'est pas publiée.** La fusion est faite en local sur `main` (commit de fusion `7b37d7b`, **non poussé**), mais deux préalables manquent et la chaîne n'est pas verte.

## 1. Préalables demandés

| Vérification | Résultat |
| --- | --- |
| `netsh interface ipv4 show excludedportrange protocol=tcp` : plage 53124-53131 marquée `*` | **Absente.** Plages présentes : 5357, 8791, 50000-50059 (`*`), 54288. L'ancienne plage dynamique 53083-53182 (rapport précédent) a disparu : les ports 53124, 53125 et 53131 s'ouvrent maintenant sans erreur (testé par `net.createServer`). 53130 est déjà pris (téléphone Jarvis en cours d'exécution, normal). La réservation administrée demandée n'est donc pas en place : elle protégerait contre le retour de la plage dynamique après un redémarrage. |
| `gh auth status` | **Non connecté** : « You are not logged into any GitHub hosts ». GitHub CLI 2.103.3 est installé (`C:\Program Files\GitHub CLI`, PATH mis à jour pour les nouveaux processus), mais `gh auth login` reste à faire, à la main (interactif). `release.sh` s'arrête à son étape 1 tant que ce n'est pas fait. |

## 2. Fusion, install, typecheck, lint

- `git fetch`, `main` = `origin/main` (`e6157c7`), `git merge --no-ff origin/claude/revue-correctifs-windows` : sans conflit, 28 fichiers, commit `7b37d7b` (local seulement).
- `npm install` : sans changement du verrou.
- `npm run lint` : 0 problème.
- `npm run typecheck` : **1 erreur** dans `@jarvis/desktop` (`tsconfig.node.json`) :

```
src/main/knowledge.eperm.test.ts(12,5): error TS2698: Spread types may only be created from object types.
```

Cause : `vi.mock('node:fs/promises', async (importOriginal) => { const actual = await importOriginal(); return { ...actual, … } })` — `importOriginal()` sans paramètre de type rend `unknown`. Correctif d'une ligne : `await importOriginal<typeof import('node:fs/promises')>()`. Ce fichier est nouveau sur la branche fusionnée ; la chaîne Linux de l'agent cloud ne l'a visiblement pas passé au typecheck du bureau.

## 3. `npm test` (sous charge, générateur en cours)

Passage complet : cœur 3 échecs / 2 125 passés (160 fichiers) ; bureau 8 échecs + 1 suite / 609 passés, 8 ignorés (118 fichiers). Chaque fichier en échec a été rejoué seul.

### Reproductible en isolation — 1 (bloquant)

- `apps/desktop/src/main/developer/project/platformerMissionPath.test.ts` « mission → niveau étendu, npm test et build réels » : `spawnSync npm ENOENT`. Le correctif de la branche a ajouté un lanceur `npm` par `node npm-cli.js` (lignes 52-87 du test), mais **trois appels directs sont restés** : lignes 333 (`npm install`), 336 (`npm test`) et 341 (`npm run build`), toujours `execFileSync('npm', …)`. Sous Windows, `npm` sans `.cmd` n'est pas trouvé par `execFileSync`. Les 5 autres tests du fichier passent (le `.NET`/`tfm` et le chemin `.exe` sont donc réglés).

### Verts en isolation (charge de la machine) — 10

Tous rejoués seuls : verts. Délais de 5 s dépassés pendant le passage complet : `packages/core/src/learning/constraints.test.ts`, `experienceFamilies.test.ts`, `skills.test.ts` ; `apps/desktop/scripts/lintBaseline.test.mjs` ; `src/main/developer/mission/labJournal.test.ts` ; `src/main/developer/task/sandbox.test.ts` (« crée, enregistre des points de reprise » + `EBUSY` au nettoyage `afterAll`, conséquence du test interrompu) ; `taskWorkflow.test.ts` (phases manquantes) ; `platformerMissionPath.test.ts` « un journal qui ne revient plus » (`createDoneRenames` 0) ; `src/main/youtube/transcribeAudio.test.ts` (« Whisper ne répond plus », minuterie dépassée).

À noter : `src/main/knowledge.test.ts` « garde les fiches écrites en même temps par deux magasins » a **perdu une fiche** (`bravo-7`, 14 au lieu de 15) pendant le passage complet, sans exception. Vert en isolation. Le correctif n° 4 (réessai sur `EPERM`) est en place ; une perte silencieuse sous charge reste possible et mérite un regard (une fiche perdue est pire qu'une erreur).

**Le correctif n° 3 (« jeter » une copie isolée depuis le dépôt principal) est confirmé** : `sandbox.test.ts` passe seul, là où il échouait toujours avant la fusion (« failed to delete »).

## 4. Essais concrets de la fin du rapport des correctifs

Outils appelés tels quels (`dev_search_code` par `createReadTools` + `runProcess`, `close_application` par `closeApplicationTool.run`) depuis un test Vitest temporaire, supprimé après.

| Essai | Résultat |
| --- | --- |
| 1. `dev_search_code` « createToolManager » sur la copie de travail (CRLF) | `ok`, **50 correspondances dans 26 fichiers**, dont `apps/desktop/src/main/tools/index.ts`. Avant la fusion : 0 (« Aucun résultat »). Conforme. |
| 2. Connexion Google avec le port 53125 bloqué | **Non rejoué** : le port 53125 n'est plus bloqué sur ce PC (voir § 1) ; le repli sur `EACCES` est couvert par `oauth.listen.test.ts` (vert). |
| 3. « Ferme Discord » sans forcer (7 processus) | `ok: false`, « “Discord” est toujours ouvert : l'application attend sans doute une réponse (document à enregistrer ?). » — **sans « Fermé : Discord »** ; 7 → 6 processus, 7,2 s. Conforme. |
| 3 bis. « Ferme Discord », `forceKill` | `ok: true`, « Fermé : Discord », 0 processus après, 2,3 s. Conforme. Discord relancé ensuite. |

## 5. État laissé

- `main` local : `origin/main` + commit de fusion `7b37d7b`, **non poussé** ; rien d'autre n'a été modifié. Pour revenir en arrière sans `reset --hard` : `git checkout main && git reset --keep origin/main` (l'arbre est propre).
- `claude/nuit-3` : ce rapport ; la ressource GPU reste réservée pour la nuit 4 jusqu'à la fin du générateur.
- Aucun fichier du produit ni des tests modifié ; aucune publication, aucun tag.

## 6. Pour publier

1. `gh auth login` (à la main).
2. Corriger `knowledge.eperm.test.ts` (type d'`importOriginal`) et les trois `execFileSync('npm', …)` de `platformerMissionPath.test.ts` (passer par le lanceur `node npm-cli.js` déjà présent dans le fichier).
3. Optionnel : réservation administrée `netsh int ipv4 add excludedportrange protocol=tcp startport=53124 numberofports=8` (invite administrateur) pour que la plage dynamique ne reprenne pas ces ports après un redémarrage.
4. Rejouer `npm run typecheck`, `npm run lint`, `npm test` **machine au repos** (générateur arrêté), puis `./release.sh` depuis `main`.
