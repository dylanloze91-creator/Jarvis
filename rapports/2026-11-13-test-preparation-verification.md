# Jarvis Test (préparation) — vérification du brouillon de la nuit

Date : 2026-11-13. Branche `claude/test-preparation` (brouillon fait par Claude la nuit du 12 au 13 novembre, voir `rapports/2026-11-13-preparation-jarvis-test.md`). **Rien n'est fusionné dans `main`, rien n'est publié, aucun `__golden__` n'est régénéré.**

Machine : Linux dans le nuage, Node 22.23.4. Pas de Windows, pas de PowerShell, pas de SDK .NET, pas d'Ollama, pas de matériel.

## Ce qui a été lancé

| Étape | Résultat |
| --- | --- |
| `npm ci` | **échec réseau** : le script d'installation d'`onnxruntime-node` télécharge un binaire depuis GitHub, coupé ici (`ECONNRESET`). Repris avec `npm ci --ignore-scripts`, puis le binaire d'Electron et `esbuild` installés à la main. Rien à voir avec la fusion ; sur le PC, `npm ci` passe normalement. |
| `npm run build --workspace @jarvis/core` | OK |
| `npm run typecheck` | OK, 0 erreur |
| `npm run lint` | OK, 0 avertissement |
| `npm test` — cœur | **2548/2548 réussis**, 1 ignoré (vérification en ligne des licences Qwen3 : Hugging Face injoignable d'ici) |
| `npm test` — bureau | **816/816 réussis**, 6 ignorés (les quatre `liveProof*` et une partie de `labJournal`, qui demandent Windows ou un vrai Ollama) |
| Construction de l'application (`electron-vite build`) | **échec**, voir plus bas. `npm run build` complet n'a pas été tenté : son étape `setup:voice` télécharge les modèles de voix, impossible d'ici. |

### Tests propres à Windows

Aucun échec à mettre de côté. `dotnetProject.test.ts` et `windowsDesktopMissionPath.test.ts` simulent `dotnet` : ils passent ici sans SDK (3/3 et 6/6). Les six tests ignorés le sont par leur propre condition (Windows, vrai modèle), pas à cause de la fusion.

### Ce qui a été regardé en particulier

- `orchestra-session.test.ts` : 17/17 sur le brouillon tel quel.
- Carnet : `carnet/express`, `carnet/file`, `carnet/review` (bureau), `carnet/detect`, `carnet/review`, `carnet/store`, `carnet/history` (cœur) : verts.
- Lot B : `quotidien/briefing`, `notes`, `routines` (cœur), `tools/notes`, `tools/printer`, `quotidien/printerReply` (bureau) : verts.
- Tests figés : `chat-unchanged`, `ollama-unchanged`, `machineProfile`, `persona-session`, `profiles/jarvis` : verts. Aucun fichier `__golden__` ne diffère de `main`.

## Le conflit de `session.ts`

La résolution de la nuit est juste. À la relecture, `routeTurn` reçoit bien `previousTeam` (Live 5.0.77) **puis** `gap` (carnet). `askRouter` et `askBrain` reçoivent `notice` et rendent `{ team, text }`. Les règles du lot B passent avant le chef d'orchestre. Le typecheck aurait d'ailleurs refusé une inversion des deux arguments (types différents).

Un seul manque : aucun test ne faisait passer **les deux côtés dans le même tour**. Le test sur la correction (Live) ne branche pas le carnet, et le carnet n'était testé qu'en dehors de la session. **Ajouté** dans `orchestra-session.test.ts`, test seulement, aucun code changé. Le scénario : l'utilisateur dit « non » après un tour donné à l'équipe Web, puis le cerveau répond soit un texte illisible, soit rien. Le test vérifie quatre choses :

- l'avis « l'équipe web n'a pas su répondre au tour précédent » arrive au cerveau ;
- aucune équipe n'est devinée ;
- le chat d'avant répond ;
- le carnet note « illisible » dans un cas et pas dans l'autre (`brainUnreadable`).

J'ai vérifié qu'il attrape une mauvaise fusion. Si l'on retire `gap` de l'appel, il échoue. Si l'on retire `notice` du message au cerveau, il échoue aussi. `session.ts` a été remis à l'identique : il n'est pas modifié dans cette branche.

**Rien d'autre n'a été cassé par la fusion** : aucune correction de code n'a été nécessaire.

## Bloquant pour installer Jarvis Test : l'interface ne se construit pas (lot B, pas la fusion)

`electron-vite build` s'arrête sur le paquet de la fenêtre :

```
packages/core/dist/quotidien/notes.js (5:16): "readFile" is not exported by "__vite-browser-external"
```

- **Cause** : `packages/core/src/quotidien/notes.ts` et `routines.ts` importent `node:fs/promises` et `node:path`. Ils sont exportés par l'index du cœur (`export * from './quotidien/notes.js'`, `routines.js`). Or la fenêtre importe `@jarvis/core` (115 fichiers du renderer) : Vite y remplace les modules Node par un module vide, et l'import nommé `readFile` échoue au build.
- **Origine** : `cursor/lot-b-quotidien` seule échoue de la même façon (vérifié ici). `main` (5.0.77) se construit. Le rapport du lot B ne mentionne que `npm run build --workspace @jarvis/core` et le typecheck : la construction de l'application n'avait jamais été lancée. **Ce n'est donc pas la fusion** : non corrigé ici, comme demandé.
- **Effet** : ni `npm run dev`, ni `npm run build`, ni `package:win` ne passeront sur cette branche. Jarvis Test ne peut pas être installé tant que ce n'est pas corrigé. Les tests ne le voient pas : Vitest tourne sous Node, où `node:fs` existe.
- **Correction proposée** (à faire dans le lot B, ou ici si tu le décides) : il y a un modèle déjà en place dans le dépôt, `@jarvis/core/trieur/validation`, un module réservé à Node exporté par un chemin à part dans `packages/core/package.json` (`exports`) et hors de l'index. La correction suit ce modèle en trois points.
  - Séparer dans `notes.ts` et `routines.ts` les règles pures, qui restent dans l'index, de la lecture et de l'écriture du fichier.
  - Exporter ces dernières par un chemin à part, par exemple `@jarvis/core/quotidien/fichiers`.
  - Les importer depuis `apps/desktop/src/main` seulement.

  Un test de garde serait utile : `electron-vite build`, ou une règle qui refuse `node:` dans un module exporté par l'index du cœur.

## Pour la suite (tâche 3 de la feuille de route)

1. Corriger la construction (lot B) : à décider, voir plus haut.
2. Version `5.1.0-test.1`, puis installer Jarvis Test à côté de la Live sur le PC Windows.
3. Essais : deux Jarvis côte à côte, carnet, briefing, notes, routines, imprimante.

La feuille de route place cette tâche après la 5.0.78 (`claude/missions-roles-5078`). Cette branche contient déjà `claude/missions-roles-5078` telle qu'elle était la nuit dernière. Si la 5.0.78 reçoit des correctifs, il faudra les y fusionner.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : ÉCHEC (electron-vite build : quotidien/notes.js importe node:fs/promises dans le paquet de la fenêtre ; même échec sur cursor/lot-b-quotidien seule, main se construit ; npm run build complet non tenté : modèles de voix non téléchargeables d'ici)
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : OK (cœur 2548/2548, 1 ignoré ; bureau 816/816, 6 ignorés ; aucun échec, aucun __golden__ régénéré)
Secrets   : OK (0 trouvé ; seul fichier de code modifié : un test)
Fichiers modifiés : apps/desktop/src/main/orchestra-session.test.ts (un test ajouté), AGENTS-COORDINATION.md, ce rapport
Prêt à fusionner : NON (la construction de l'interface échoue à cause du lot B ; et la feuille de route veut la 5.0.78 d'abord)
À corriger : construction du lot B (notes.ts et routines.ts hors de l'index du cœur, chemin d'export à part) ; npm ci dans le nuage (onnxruntime-node, réseau) sans effet sur le PC
Testé en vrai (à la voix, sur le PC) : PAS FAIT. Une fois la construction corrigée et Jarvis Test installé : (1) dans Test, « Note : acheter deux litres de lait » puis « Qu'est-ce qu'il y a sur ma liste ? » → la note revient ; (2) dans Live, « Ouvre le Bloc-notes » puis « non » → la pastille ne doit pas reprendre l'équipe du premier tour ; (3) Live et Test ouverts ensemble : Ctrl+Espace et « Jarvis » ne réveillent que Live
```
