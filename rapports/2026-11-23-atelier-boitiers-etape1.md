# Atelier 3D, boîtiers électroniques : étape 1, des outils précis (23 novembre 2026)

Écrit par Claude Code (agent Atelier), branche `claude/atelier-boitiers`, partie de `claude/atelier-3d`. Mission : `C:\dev\jarvis-data\missions\atelier-boitiers\MISSION_ATELIER_BOITIERS.md` (hors du dépôt, avec les STL de référence du hub). **Jarvis Test seulement, aucune impression lancée, rien envoyé à l'imprimante, pas de fusion, pas de publication.**

## 1. Ce qui a été fait

Tout est dans le cœur (`packages/core/src/atelier/`), à la suite de `decoupes.ts`. Rien de ce qui marchait n'a changé : les 106 essais de l'atelier d'avant passent sans retouche.

| Demande de la mission | Où | Exemple compris |
| --- | --- | --- |
| Découpes placées en millimètres, dans le repère de chaque face vu de l'extérieur | `decoupes.ts` (`PosMm`, `axeDuBord`, `enMm`) | « une ouverture de 17 par 15 dans le fond, à 12 mm du bord gauche et 8 mm du bas » ; « un trou de 8 centré à 145 mm du bas » ; « mets le trou à 20 mm du bord gauche » |
| Rectangle à coins arrondis | `decoupes.ts` (`fenetre`) | « une ouverture de 30 par 20 à coins arrondis à l'avant » (rayon proposé 3 mm, ou « de 2 mm ») |
| Fenêtre évasée (tronc de pyramide, pour une caméra) | `decoupes.ts` (`fenetre`) | « une fenêtre évasée de 14 par 13, 18,5 par 15 à l'extérieur » ; sans taille dehors : à 45° |
| Bossages avec insert M3 | `ajouts.ts` | « ajoute quatre bossages avec insert M3 à 7 mm des coins » ; « le bossage plus haut » ; « les bossages de 20 mm de haut » |
| Plots de carte M2 ou M2,5 | `ajouts.ts` | « ajoute 4 plots M2,5 avec un entraxe de 58 par 49 » (au centre, ou « à 15 mm de la gauche et 12 mm de l'avant ») |
| Nervure | `ajouts.ts` | « ajoute une nervure de 6 mm dans la largeur » |
| Rebord intérieur qui porte un couvercle | `ajouts.ts` | « ajoute un rebord intérieur pour le couvercle » |
| Emboîtement (lèvre de 1,2 mm, 0,25 mm de jeu par côté), lèvre entaillée autour des bossages | `ajouts.ts`, `gabarits.ts` (`boite_couvercle`) | « fais que le couvercle s'emboîte » |
| Contrôle d'impression : surplomb de plus de 45°, pont de plus de 25 mm, avec la pièce et l'endroit | `impression.ts`, branché côté PC (`tourAtelier.ts`) | « Boîte : pont de 59,5 mm sans appui (25 mm au plus), à 27 mm de haut, au milieu (x 40, y 25 mm). Il risque de pendre. » |

### Les règles suivies

- **Repère des faces** : celui de `decoupes.ts`, vu de l'extérieur. Une distance va jusqu'au **bord** de la découpe, ou jusqu'à son **centre** si la phrase dit « centré ». Sur le dessus et le fond, « l'avant » est le bas de la face. Sur un côté, « l'avant » et « l'arrière » sont les deux bords gauche-droite. Une découpe qui sort de la place utile (bords et parois gardés) est refusée, jamais déplacée en silence.
- **Visserie** (`visserie.ts`) : les cotes viennent de `donnees/composants.json` (section `visserie`, état « sûr »). Insert M3 : perçage 4 mm, profondeur 6 mm, bossage de 8 mm. Passage M3 : 3,4 mm. Tête fraisée : 6,4 mm. Avant-trous : M2 1,6 mm et M2,5 2,1 mm. Longueurs courantes : 6, 8, 10, 12, 16 et 20 mm.
- **Prise des vis** : une vis M3 doit entrer de 3,5 mm à 5,7 mm dans l'insert (profondeur − 0,3). L'atelier choisit la plus longue de la liste qui respecte cette règle. Exemple : « Couvercle : 4 vis M3 × 6 à tête fraisée (4 mm dans les inserts) ».
- **Refus, en phrases simples** :
  - « il faut au moins 1,5 mm de matière autour de l'insert, donc un bossage de 7 mm de diamètre au moins » ;
  - « trop court pour l'insert » ;
  - « les bossages se toucheraient » ;
  - « ils ne tiennent pas dans le fond » ;
  - « trop haute pour cette boîte » ;
  - « Cette boîte n'a pas de couvercle : demande-moi « une boîte avec couvercle » » ;
  - « Les bossages montent déjà jusqu'en haut de la boîte ».
- **Bossages près d'une paroi** : un bloc d'angle les relie aux deux parois, pour ne pas laisser de fente fine. Sur une boîte à couvercle, quand les bossages montent jusqu'en haut :
  - le couvercle est percé (3,4 mm) et fraisé à 45° (il s'imprime sans support) ;
  - sa lèvre est entaillée autour des bossages et des blocs d'angle, comme le dos de la référence autour des coins et des retenues.
- **Rebord intérieur** : 1,5 mm d'appui, chanfrein à 45° dessous (sans support). Sur une boîte à couvercle, le couvercle devient une plaque posée sur le rebord, avec 0,25 mm de jeu par côté. Le rebord et l'emboîtement s'excluent : le second remplace le premier, et c'est dit.
- **« mets des plots pour un Raspberry Pi 5 »** : refusé poliment, comme demandé pour l'étape 1. Jarvis répond : « Je ne connais pas encore les cartes comme le Raspberry Pi 5 : ça viendra avec la bibliothèque de composants. En attendant, donne-moi l'écart des trous, par exemple « 4 plots M2,5 avec un entraxe de 58 par 49 ». »
- **Contrôle d'impression** (`impression.ts`), même méthode que `reference/sources/imprim_hub.py`, refaite sans bibliothèque :
  - **surplombs** : faces tournées vers le bas, plus couchées que 45° (avec 3° de marge pour les chanfreins à 45° pile), regroupées en zones. Une zone de moins de 3 mm de haut, ou de moins de 1 cm², s'imprime : un bord évasé, le haut d'un petit trou rond.
  - **ponts** : la pièce est découpée en cubes de 0,5 mm. Dans chaque couche, ce qui n'a rien dessous à 45° près forme des zones en l'air. Tenue des deux côtés, une zone est un pont, et on mesure sa portée. Tenue d'un seul côté, c'est une avancée en l'air, refusée au-delà de 4 mm.

### Le contrôle, réglé sur la référence

Les 9 STL du hub (`reference/stl/`), passés tels quels :
- **aucun défaut** ;
- les ponts trouvés sont ceux du LISEZMOI :
  - **façade** : 22 mm derrière la caméra (« la seule zone en l'air est un pont de 22 mm ») ;
  - **dos** : 23 mm au-dessus du passage des câbles de 24 mm ;
  - **socle** : 17 mm au-dessus de l'Ethernet, 15 à 15,5 mm au-dessus des USB.

Une pièce de 750 000 triangles se contrôle en moins d'une demi-seconde.

## 2. Rendu OpenSCAD réel (PC de l'utilisateur, OpenSCAD 2021.01)

Commande : `npm run atelier:rendre --workspace @jarvis/core -- --dir C:\dev\jarvis-data\atelier\_essais-etape1`.

Le script fait maintenant aussi :
- **7 pièces d'essai des outils**, obtenues **en passant par les phrases**, comme dans la discussion ;
- le **contrôle d'impression** de chaque pièce.

**Résultat : 30 pièces bonnes sur 31.** Toutes sont fermées et aux cotes. Les 7 pièces d'essai des outils sont toutes bonnes :

| Pièce d'essai | Phrases | Rendu |
| --- | --- | --- |
| `mm-fond` | boîte 120 × 80 × 40, « une ouverture de 17 par 15 dans le fond, à 12 mm du bord gauche et 8 mm du bas » | fermée, aux cotes, 0,2 s |
| `mm-centre` | boîte 100 × 60 × 160, « un trou de 8 centré à 145 mm du bas » | fermée, aux cotes, 0,7 s |
| `formes` | boîte à couvercle, ouverture à coins arrondis, fenêtre évasée sur le couvercle | fermée ; pont de 25,5 mm au-dessus de l'ouverture de 30 mm (accepté, à la limite) ; 1 s |
| `bossages-emboite` | boîte à couvercle, quatre bossages M3 à 7 mm des coins, « fais que le couvercle s'emboîte » | fermée, couvercle percé et fraisé, lèvre entaillée ; 64 s |
| `bossage-plus-haut` | bossages de 15 mm, puis « le bossage plus haut » (19 mm) | fermée, 8 s |
| `plots-nervure` | 4 plots M2,5 entraxe 58 × 49, nervure de 6 mm dans la largeur | fermée, 8 s |
| `rebord-couvercle` | boîte à couvercle 100 × 70 × 40, rebord intérieur, bossages | fermée, couvercle en plaque percée de 205,5 mm, 38 s |

**La seule pièce refusée est un vrai défaut, trouvé par le nouveau contrôle.**
- La pièce : le support de téléphone de la variante d'essai « dos-long » (inclinaison 40°, dossier de 160 mm).
- Ce que dit le contrôle : « Support de téléphone : surplomb de plus de 45° sur 119,2 cm², de 4 à 99,8 mm de haut ».
- Pourquoi c'est vrai : un dossier incliné à 40° penche de 50° par rapport à la verticale. Imprimé debout, il lui faut un support.
- Ce qui est en dehors : les supports à 45°, 60° et 75° passent.
- Je n'ai pas touché à ce gabarit (hors de l'étape 1). Dans Jarvis, la pièce est quand même montrée, avec la phrase « Sans support, ça risque de mal s'imprimer : … ».
- Correction possible, à ta décision : imprimer ce support couché sur le côté (aucun surplomb), ou refuser les angles sous 45°.

## 3. Reste pour l'étape 1

- **Essai rapide par l'utilisateur** dans Jarvis Test (clavier ou voix), avant l'étape 2.
- Le temps de rendu monte avec les bossages : 64 s pour la boîte à couvercle à bossages, qui a beaucoup de cylindres à 96 facettes. La limite d'OpenSCAD dans l'atelier est de 180 s. À surveiller à l'étape 3, où le hub a beaucoup plus de formes.

## RAPPORT DE VÉRIFICATION

- Construction : cœur `tsc` OK (`npm run build --workspace @jarvis/core`) ; rendu OpenSCAD réel de 31 pièces (section 2).
- Types : `npm run typecheck` 0 erreur.
- Style : `npm run lint` 0 erreur.
- Tests : `npm test` complet vert. Cœur : 2 907 sur 2 907. Bureau : 950 (8 ignorés, comme avant). Ollama était réservé pendant le passage. Nouveaux essais :
  - `impression.test.ts` (8) ;
  - `ajouts.test.ts` (21) ;
  - `decoupes.test.ts` (+7) ;
  - `tourAtelier.test.ts` (+1 : le message « Sans support… » côté PC).
- OpenSCAD : 30 pièces sur 31 bonnes. La 31e est un vrai défaut, et il est dit (section 2).
- Secrets : aucun. Aucune clé lue ni écrite. La mission et ses STL restent hors du dépôt (`C:\dev\jarvis-data\missions\atelier-boitiers\`).
- Relecture :
  - aucune cote inventée : visserie reprise de `composants.json` ;
  - une découpe ou un ajout qui ne tient pas est refusé, avec une phrase, jamais ramené en silence ;
  - la phrase du Raspberry Pi est refusée à cette étape ;
  - Live inchangé : l'atelier n'existe que dans Jarvis Test.
- Imprimante : rien envoyé. Dans la fenêtre d'essai, l'imprimante est coupée pour cet essai.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT. Essai au clavier à faire par l'utilisateur dans Jarvis Test.
