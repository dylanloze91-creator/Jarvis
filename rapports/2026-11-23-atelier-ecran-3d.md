# Atelier 3D : l'écran 3D (23 novembre 2026)

Écrit par Claude (le chat), à la demande de l'utilisateur : « surtout la visualisation ». Branche `claude/atelier-ecran-3d`, partie de `claude/atelier-3d`. Ajouts seulement : rien n'est branché dans l'appli, aucun fichier existant du chat ou de l'interface n'a changé (une ligne ajoutée à `packages/core/src/atelier/index.ts`).

Aperçu en ligne (même code, avec deux pièces d'exemple) : artifact « Jarvis · Atelier 3D (aperçu) ».

## 1. Ce qui est fait

| Fichier | Rôle |
| --- | --- |
| `packages/core/src/atelier/stl.ts` | Lire un STL (binaire ou texte, comme OpenSCAD l'écrit), normales recalculées. **Contrôle** `controlerStl(maillage, taille)` : pièce **fermée** (chaque arête partagée par exactement deux triangles) et **aux mesures annoncées** à 0,2 mm près, avec des phrases simples. Écrire un STL binaire, boîte creuse et tube pour les aperçus et les essais. |
| `packages/core/src/atelier/vue3d.ts` | Calculs de la vue : caméra qui tourne autour de la pièce (jamais par-dessus le sommet), zoom borné, pièce posée au milieu du plateau de l'Ender 3 S1 Plus (300 × 300), quadrillage tous les 10 mm, cotes en millimètres à la française, projection à l'écran. |
| `apps/desktop/src/renderer/src/components/atelier/visionneuse.ts` | Le dessin, en WebGL, **sans bibliothèque** : plateau, pièce éclairée, gestes (glisser = tourner, molette ou deux doigts = zoomer, double-clic = recadrer), dessin seulement quand quelque chose change. Sans WebGL : message, pas de plantage. |
| `components/atelier/Vue3D.tsx` | La vue 3D dans React, avec les trois cotes posées sur la pièce et les boutons « ↻ » et « Recadrer ». |
| `components/atelier/AtelierEcran.tsx` | L'écran « Atelier » : la pièce en 3D, ses mesures, le contrôle (fermée, bonnes mesures), temps et filament s'ils sont connus, les versions (« Version 2 · Hauteur 30 → 45 mm »), « Imprimer cette version… » (ouvre la carte de confirmation, jamais une impression directe ; grisé tant que la pièce n'est pas rendue ou a un problème), « Ouvrir le dossier de la pièce ». |
| `components/atelier/atelierEtat.ts` | La même logique sans écran (testable) : lecture, contrôle, raison pour laquelle l'impression n'est pas encore proposée. |
| `preview/atelierSample.ts` | Deux versions d'une boîte, pour une scène d'aperçu. |

## 2. Essais

- `atelier/ecran3d.test.ts` (16) : STL binaire et texte relus, fichier vide, coupé ou faux refusé en français, boîte et tube fermés, pièce trouée signalée, taille fausse dite, vue de départ qui montre toute la pièce, rotation, zoom borné, pièce posée au milieu du plateau, quadrillage, cotes, point derrière la caméra.
- `atelier.test.ts` (33, inchangé) : toujours vert.
- `components/atelier/atelierEtat.test.ts` (5) : version prête, pas encore rendue, illisible, mesures fausses, aucune version.
- Types : compilation stricte des nouveaux fichiers du cœur sans erreur ; composants React vérifiés avec une imitation des types de React (les vrais types ne sont pas installés dans le cloud).
- **Vue ouverte pour de vrai dans un navigateur sans écran (Chromium, WebGL logiciel)** : la boîte et l'entretoise s'affichent, tournent à la souris, les cotes suivent, la carte d'impression s'ouvre ; aucune erreur dans la console.

## 3. Pour l'agent Atelier (Claude Code), au branchement

1. Fusionner `claude/atelier-ecran-3d` dans `claude/atelier-3d` (seul point commun : la ligne d'export ajoutée à `atelier/index.ts`).
2. **Point 3 de ta mission (OpenSCAD)** : après chaque rendu, `controlerStl(lireStl(octets), piece.taille)` fait le contrôle « STL fermé et aux bonnes cotes » ; inutile de l'écrire.
3. Processus principal : lire `C:\dev\jarvis-data\atelier\<pièce>\v<N>.stl` et l'envoyer à la fenêtre (octets, par un canal IPC dédié), avec la fiche, les mesures, la taille attendue, et temps et filament lus dans le fichier tranché.
4. Fenêtre : afficher `AtelierEcran` dans la discussion quand l'équipe Impression rend une pièce (ou dans un panneau « Atelier » du tableau de bord), `onImprimer` → la carte de confirmation (« Lancer l'impression de … (temps, filament). Vérifie que le plateau est vide. ») puis le client Moonraker ; `onOuvrirDossier` → `shell.openPath`. Jamais d'impression depuis une enceinte.
5. Scène d'aperçu `?scene=atelier` avec `atelierSampleVersions()` si utile.
6. Essai à la souris sur le PC (la carte graphique remplace le WebGL logiciel), puis avec l'utilisateur.

## RAPPORT DE VÉRIFICATION

```
Lancement (npm run build) : PAS FAIT (dépendances npm absentes dans le cloud)
Types : fichiers nouveaux du cœur en tsc strict : OK ; composants React avec types imités : OK ; typecheck complet : PAS FAIT
Style (npm run lint) : PAS FAIT
Tests : cœur 16 + 33, fenêtre 5, avec un lanceur qui imite vitest ; vitest réel : PAS FAIT
Vue 3D ouverte dans Chromium sans écran : FAIT (aucune erreur)
Secrets : aucun
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```
