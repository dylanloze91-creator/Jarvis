# Atelier 3D : l'examen du hub, et le support de téléphone à 40°

Écrit par Claude Code (agent Atelier), branche `claude/atelier-boitiers`, le 25 novembre 2026 au soir.
**Jarvis Test seulement. Aucune impression lancée, rien envoyé à l'imprimante, pas de fusion, pas de publication.**

Demande : « Fais maintenant l'examen du hub : « dessine-moi un boîtier pour un Raspberry Pi 5 avec
l'écran tactile 7 pouces et la caméra grand angle, les ports à l'arrière ». Il doit passer les 64
contrôles de la référence, à ±10 mm. Puis répare le support de téléphone à 40°. »

## 1. Ce qui marche

**La phrase de l'examen, dite telle quelle**, mène au « boîtier à écran », sans aucune question : les
trois composants sont connus de la bibliothèque (cotes sûres ou incertaines avec leur parade).

- **Dessin par règles** (`packages/core/src/atelier/boitierEcran.ts`), repris de `hub.py` :
  - module écran : façade et dos, écran incliné, tenu par un rebord devant et 4 retenues souples ;
  - caméra au-dessus de l'écran sur un chariot réglable, fenêtre évasée, cache coulissant et son bouton ;
  - socle avec le Pi 5 dans le coin, capot avec sa cale sous le module ;
  - passage des câbles aligné, vis et inserts aux coins.
- **Choix** : inclinaison de 0 à 30° (15° proposés), prises à l'arrière ou sur le côté, caméra (si elle
  est nommée), cache avec ou sans.
  - « l'écran plus incliné » ajoute 5° ; « incline l'écran de 20° », « les ports sur le côté » et
    « sans cache » font une nouvelle version.
- **Règles ajoutées en cours de route, chacune trouvée par le banc :**
  - la vis capot → module : si aucune vis courante ne prend bien, le lamage est creusé plus profond (à
    0°, il fallait 9,1 mm de traversée : vis de 12 et lamage de 4,6 mm) ;
  - la cale s'arrête 2 mm avant l'arrière du module quand l'écran est très incliné (à 30°, elle
    dépassait) ;
  - sans caméra, le module est plus bas : la lèvre du dos est entaillée autour de toutes les retenues
    (3,1 mm³ de collision sinon) ;
  - les bossages du socle sont déplacés le long de la paroi quand la carte occupe le coin.
- **Les 64 contrôles** (`bancBoitierEcran.ts`), repris un à un de `banc_hub.py`, avec les mêmes
  méthodes sur le même arbre de formes que le .scad :
  - collisions (volume commun sur une grille de 0,3 mm) et jeux (transformée de distance) ;
  - champ de la caméra par rayons, flexion des retenues, prise des vis (longueur choisie dans la liste
    courante), câbles, bascule et glissement.
  - Le banc rend la main toutes les 25 ms : Jarvis reste réactif pendant la minute de contrôle.
- **Sur le PC** (`apps/desktop/src/main/atelier/boitierEcranPC.ts`) :
  - les 9 pièces sont rendues par OpenSCAD, 4 à la fois, pendant que les contrôles tournent ;
  - une pièce inchangée d'une version à l'autre est reprise ;
  - chaque STL est contrôlé : fermé, aux cotes, imprimable sans support ;
  - le boîtier est assemblé (`v1.stl`) et éclaté (`v1-eclate.stl`) pour l'écran 3D et les images ;
  - un boîtier dont un contrôle rate n'est jamais montré : Jarvis dit lesquels ratent.
- **Écran 3D** : bouton « Éclaté / Monté », « 64 contrôles sur 64 », et la liste des pièces avec un
  bouton « Imprimer… » par pièce (il envoie « Imprime la façade »).
- **Impression pièce par pièce** : « imprime la façade », « mets le socle dans la file ».
  - « imprime-la » demande laquelle.
  - Chaque pièce passe par la carte de confirmation habituelle, jamais depuis une enceinte.

## 2. Les chiffres de l'examen (vrai OpenSCAD, vrais contrôles)

| | Référence | Jarvis |
| --- | --- | --- |
| Contrôles | 64 sur 64 | **64 sur 64** |
| Encombrement | 202,5 × 120 × 206 mm | **202,5 × 120 × 205,3 mm** (mesuré sur les pièces rendues) |
| Prises | | **au même endroit** (écart 0 mm : même règle de placement) |
| Pièces | 9 fichiers, 12 exemplaires | 9 fichiers, 12 exemplaires |
| Durée | | **4 min 11 s** : le socle seul prend environ 4 min dans OpenSCAD 2021, le reste se fait en même temps |

- Les mesures du banc sont celles de la référence, à quelques centièmes près. Seuls deux jeux de la
  caméra sont plus grands, par la fenêtre de 15 mm gardée depuis l'étape 2 (choix du 24 novembre) :
  - caméra → cache : 0,45 mm contre 0,30 ;
  - caméra → façade : 1,98 mm contre 1,93.
- **Variantes passées au banc** :

  | Variante | Contrôles |
  | --- | --- |
  | ports sur le côté | 64 sur 64 |
  | écran à 30° | 64 sur 64 |
  | écran à 0°, sans cache | 57 sur 57 |
  | sans caméra | 38 sur 38 |
  | écran à 5°, côté, sans caméra | 38 sur 38 |

- **Grand contrôle des pièces du hub** (OpenSCAD, contrôle du STL, impression sans support,
  OrcaSlicer avec tes préréglages lus seulement, taille comparée aux STL de la référence) :
  **9 sur 9**. Chaque pièce est à 0,05 mm au plus de la pièce de la référence. Ponts les plus
  longs : 23 mm (dos), 22 mm (façade), 17 mm (socle), sous la limite de 25 mm.

  | Pièce | Impression (OrcaSlicer) | Filament |
  | --- | --- | --- |
  | socle | 5 h 32 | 119 g |
  | dos | 5 h 11 | 106 g |
  | capot | 3 h 13 | 64 g |
  | façade | 2 h 54 | 63 g |
  | chariot de la caméra | 20 min | 4,8 g |
  | cache de la caméra | 5 min | 1,2 g |
  | retenue A, retenue B (2 de chaque) | 4 min chacune | 0,7 g chacune |
  | bouton du cache (2) | 1 min chacun | 0,1 g chacun |

  En tout, environ 17 h 50 et 362 g. La notice de la référence annonçait 350 à 450 g.
- **Images** : dans le dossier de l'essai, `v1.png` (de trois quarts, de face). On voit le dos à
  travers la fenêtre de l'écran, puisque l'écran n'est pas dessiné. La forme est celle de
  `reference/images/1_vue_avant.png`.

## 3. Le support de téléphone à 40°

- **Cause** : sous 45°, le dessous du dossier penche de plus de 45°. Debout, il faut un support
  d'impression : 119,2 cm² de surplomb.
- **Correction** : le support est un profil tiré sur toute sa largeur. Sous 45°, il s'imprime couché
  sur le côté : aucun surplomb, quel que soit l'angle.
  - La fiche le dit : « Il s'imprime couché sur le côté (cotes dans ce sens) ».
  - À 45° et au-dessus, rien ne change.
- **Grand contrôle** : les 4 supports passent, dont « dos-long » à 40° : rendu, fermé et aux cotes,
  sans support, préparé par OrcaSlicer (2 h 39, 82 g). Le grand contrôle complet du 24 novembre
  donnait 57 pièces sur 58, la seule casse étant ce support.
- **Attentes de tests modifiées** :
  - `atelier.test.ts` : la taille de la variante à 40° est maintenant dans le sens d'impression
    (hauteur et largeur échangées) ;
  - le compte des modèles passe de 10 à 11 (le boîtier à écran).

## 4. Ce qui reste

- **Composants en couleur** : l'écran 3D montre les pièces, sans l'écran, la carte et la caméra en
  couleur (la visionneuse n'affiche qu'un maillage).
- **Temps d'impression et filament de chaque pièce** : connus seulement quand la pièce est tranchée
  (« imprime la façade »), pas d'avance.
- **Le socle prend 4 minutes** dans OpenSCAD 2021. Deux pistes, à ta décision :
  - une version récente d'OpenSCAD (moteur Manifold, quelques secondes) ;
  - moins de facettes sur les petits trous.
- **Questions à l'utilisateur** : aucune pour ce boîtier. L'inclinaison est proposée à 15° et dite
  dans la fiche.
- **Autre carte avec l'écran 7 pouces** (un ESP32…) : Jarvis le dit honnêtement, il ne sait pas
  encore.
- **Changement de comportement** : « un boîtier pour un écran de 7 pouces », sans dire la carte, mène
  maintenant au boîtier à écran pour le Pi 5 (le seul écran de 7 pouces connu), et non plus à la
  boîte simple (`atelier-session.test.ts`).
- **Hors de ce travail, corrigé au passage** : le réglage `printer.phoneStart` (commit 0320b8a de
  cette branche) n'avait pas de place dans la carte des réglages. Un test du cœur échouait, il passe.

## 5. RAPPORT DE VÉRIFICATION

- Lancement : Jarvis Test d'essai relancé avec ce code (`electron-vite dev`, dossier de données à
  part). Le téléphone répond par Tailscale (8443 → 53140), et la Live (443) n'est pas touchée.
- Types : `npm run typecheck` sans erreur.
- Style : `npm run lint` sans erreur.
- Tests :
  - cœur : 3164 tests, dont l'examen complet (64 sur 64) dans `boitierEcran.test.ts` ;
  - bureau : 1000 tests, 8 ignorés (comme avant), dont `boitierEcranPC.test.ts` (faux OpenSCAD).
- OpenSCAD réel :
  - examen de bout en bout : 64 sur 64, 9 STL fermés et aux cotes ;
  - grand contrôle : supports de téléphone 4 sur 4 ; pièces du hub 9 sur 9 (tailles à 0,05 mm de la référence).
- Secrets : aucun.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT. La phrase a été passée par la vraie chaîne
  (discussion de l'atelier, OpenSCAD, contrôles), pas dans la fenêtre ni sur l'iPhone. C'est à
  essayer ce soir.
