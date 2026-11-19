# L'atelier 3D : le cœur (19 novembre 2026)

Écrit par Claude (le chat). L'atelier 3D est une des deux priorités de l'utilisateur depuis le 19 novembre. Branche `claude/atelier-3d`, partie de `claude/imprimante-surveillance` (elle contient donc aussi le cœur de la surveillance). Cahier : `docs/specs/atelier-3d.md` (sur `claude/feuille-19-nov`). Trancheur de l'utilisateur : **OrcaSlicer**.

**Fait ici : le cœur seulement, sans Electron.** Comme pour la surveillance, `npm install` est bloqué dans le cloud : ni `npm run typecheck`, ni `lint`, ni `vitest`, ni `electron-vite build` n'ont tourné. Les fichiers passent `tsc` avec la configuration stricte du dépôt, et leurs essais tournent avec un lanceur qui imite `vitest` : 33 sur 33 (plus les 35 de la surveillance). **OpenSCAD n'a pas pu tourner ici** : la première chose à faire sur le PC est de rendre les 10 pièces par défaut et de vérifier qu'elles sont fermées et aux bonnes cotes.

## 1. Ce qui est fait (`packages/core/src/atelier/`)

| Fichier | Rôle |
| --- | --- |
| `gabarits.ts` | 10 pièces réglables : boîte, boîte avec couvercle, bac à compartiments, entretoise, équerre, crochet mural, support de téléphone, socle (rond ou carré, avec logement), porte-étiquette, cale. Chacune : ses mesures (bornes, valeur proposée, celles à demander), sa taille, ses refus en phrases simples (paroi trop fine, trou trop grand, base trop courte, trop de cases…), et sa pièce écrite en OpenSCAD. `fabriquer(gabarit, mesures)` complète avec les valeurs proposées, refuse ce qui sort des bornes (jamais ramené en silence) ou du volume de l'Ender 3 S1 Plus (300 × 300 × 300 mm), puis écrit la pièce. Paroi la plus fine : 0,8 mm (deux passages de buse de 0,4). |
| `lecture.ts` | Comprendre la demande **sans modèle** : la pièce (« boîte » + « couvercle » n'importe où = boîte avec couvercle ; pluriels acceptés), les mesures (« 80 par 50 par 30 », « 10 x 6 x 4 cm », « hauteur 30 », « 80 de long, 50 de large », « trou de 4 mm de diamètre », « incliné à 60° », « 4 compartiments », « socle rond de 8 cm », virgule décimale, « 2 boîtes » n'est pas une mesure). Ce qui manque : **une question à la fois avec une valeur proposée** (« Hauteur : je propose 30 mm. Ça te va, ou tu veux autre chose ? ») ; « oui » garde la proposition, « 4 cm » devient 40 mm. Pièce non reconnue : consigne JSON pour le modèle de l'équipe Impression, réponse relue (pièce inconnue ou mesure hors bornes écartées et notées) ; les règles gardent toujours le dernier mot. |
| `atelier.test.ts` | 33 essais : chaque pièce par défaut se fabrique et tient dans l'imprimante, OpenSCAD sans `NaN` ni parenthèse orpheline, refus attendus, 16 phrases de demande, questions, réponse du modèle. |

Exporté par `packages/core/src/atelier/index.ts` et l'index du cœur (aucun nom en double, aucun `node:*`).

Une demande hors de la bibliothèque (« une petite voiture », « un dragon ») n'est **pas devinée** : Jarvis doit le dire, et proposer la pièce la plus proche ou attendre le moteur plus fort (plus tard, décision de l'utilisateur).

## 2. Ce qui reste à faire par Claude Code (côté PC, Jarvis Test seulement)

1. **Contrôles complets** : `npm run typecheck`, `npm run lint`, `npm test`, `npx electron-vite build`.
2. **OpenSCAD** (vérifier licence et ligne de commande dans la documentation officielle ; installation par l'utilisateur, jamais par Jarvis) : rendre les 10 pièces par défaut et quelques variantes, vérifier que chaque STL est fermé (aucune arête libre) et aux cotes de `taille()`. Corriger un gabarit qui sort mal, avec son essai. Image de la pièce : `openscad -o piece.png` (vue 3/4) pour la discussion.
3. **OrcaSlicer en ligne de commande** (le trancheur de l'utilisateur) : vérifier la ligne de commande sous Windows dans la documentation officielle, retrouver **ses** préréglages de l'Ender 3 S1 Plus (machine, réglages d'impression, filament) sans jamais les modifier, trancher le STL, lire le temps et le filament **dans le fichier produit**.
4. **Le déroulé dans la discussion normale** (comme Jarvis Développeur facile) : règle express « fais-moi / imprime-moi / dessine-moi un … » vers l'équipe Impression, `comprendre`, questions une à la fois, `fabriquer`, image, « plus haut / trou plus gros » = nouvelle version (l'ancienne gardée), fichier dans `C:\dev\jarvis-data\atelier\<pièce>\`.
5. **Imprimer** : carte « Lancer l'impression de … (temps, filament). Vérifie que le plateau est vide. », jamais depuis une enceinte ; envoi par le client Moonraker du lot B ; puis la surveillance (`claude/imprimante-surveillance`) démarre.
6. **Essais avec l'utilisateur** : trois pièces simples de la phrase à l'impression (cahier, section 7).

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement (npm run build) : PAS FAIT (dépendances npm absentes dans le cloud)
Types : tsc strict (tsconfig.base.json) sur les fichiers de atelier/ : OK ; typecheck complet du dépôt : PAS FAIT
Style (npm run lint) : PAS FAIT
Tests : 33 sur 33 avec un lanceur qui imite vitest ; vitest réel : PAS FAIT
OpenSCAD : PAS FAIT (absent du cloud) — première chose à faire sur le PC
Secrets : aucun
Testé en vrai (à la voix, sur le PC) : PAS FAIT
Reste à vérifier : section 2
```
