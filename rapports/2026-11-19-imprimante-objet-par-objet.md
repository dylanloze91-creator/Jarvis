# Imprimante : problèmes objet par objet, contrôle du plateau, simulation des pannes (cœur, 19 novembre au soir)

Demande de l'utilisateur : « qu'il soit capable de détecter s'il y a un problème que sur un seul objet. Par exemple, le plateau est un peu décalé, un objet imprime à moitié dans le vide en dehors du plateau, ou l'objet n'est pas bien positionné. Fais aussi des simulations sur tout ce qui peut arriver lors d'une impression 3D, et il faut qu'il puisse le détecter. »

Fait par Claude (chat), dans le cœur seulement (`packages/core/src/impression/`), branche `claude/atelier-3d`. Aucun modèle d'IA : des règles, de la géométrie et des comparaisons d'images. Rien n'est encore branché au PC.

## Ce qui est fait

1. **Catalogue des pannes** (`pannes.ts`) : 35 situations, avec pour chacune comment Jarvis la voit (fichier, Klipper, caméra, prise, capteur), à quel point c'est fiable, ce qu'il fait, et l'essai qui le prouve. 7 sont dites « non vues » ou « vues difficilement » (warping léger, première couche trop écrasée, sous-extrusion légère, défauts d'aspect, ventilateur, « blob » sur la buse, filament humide).
2. **Contrôle du plateau avant de lancer** (`gcode.ts`, `plateau.ts`) : lecture du G-code d'OrcaSlicer (G0/G1, arcs G2/G3, absolu/relatif, étiquettes `EXCLUDE_OBJECT`), grille de 1 mm couche par couche.
   - **Bloquant** (Jarvis déconseille de lancer, la décision reste à l'utilisateur) : objet qui dépasse de la feuille (« à moitié dans le vide »), partie posée sur rien (îlot sans support), objet qui ne touche pas le plateau, matière hors du volume.
   - **À vérifier** : trop près du bord, objets qui se touchent, hors de la zone palpée, haut sur une petite base (risque de bascule).
   - Environ 1,8 s pour 185 000 lignes.
3. **Feuille décalée** (`vision.ts`, `mesurerFeuille`) : sur une photo du plateau vide, Jarvis cherche où sont vraiment les 4 bords de la feuille et mesure le décalage à 1 mm près. Le contrôle du plateau est ensuite refait avec la feuille à sa vraie place. Sans feuille visible, il le dit au lieu d'inventer un décalage.
4. **Restes sur le plateau** (`restesSurPlateau`) : comparaison avec la photo du plateau vide ; il dit où (« au fond à droite »).
5. **Caméra** (`camera3d.ts`) : calage une fois pour toutes en cliquant 6 à 9 points (coins de la feuille, pointe de la buse à deux hauteurs). Il gère le plateau mobile de l'Ender (caméra fixée au cadre ou au plateau). Un calage imprécis est refusé.
6. **Vision objet par objet** (`vision.ts`, `comparer`) : Jarvis sait où chaque objet doit apparaître sur l'image et compare :
   - avec la photo précédente, pour voir un objet qui a bougé ;
   - avec la photo du plateau vide prise au début, pour voir de la matière qui reste hors des objets (spaghetti, couches décalées, objet déplacé) ;
   - avec la photo d'il y a 10 couches, pour voir si les objets grandissent encore.
   La tête et le portique sont retirés de l'image, et la lumière qui change est compensée. Une caméra bousculée est reconnue grâce au décor (montants du cadre) qui se déplace.
7. **Décisions par objet** (`objets.ts`) :
   - une seule image ne déclenche jamais d'alerte ;
   - un objet raté → alerte avec photo (« l'objet « support n°2 » rate… les 2 autres vont bien ») puis **arrêt de cet objet seul** (`EXCLUDE_OBJECT`) au bout de 2 minutes sans réponse ; « garde-le » et « arrête-le » sont compris ; réglage « seulement prévenir » ;
   - plusieurs objets ratés en même temps, ou le dernier objet restant → pause de toute l'impression, comme les autres problèmes ;
   - plus rien ne grandit → doute après 10 couches, pause après 20.
   Arrêter un objet ne lance, ne reprend ni ne chauffe jamais rien.
8. **Client Moonraker** : lecture de `exclude_object`, de la position de la tête et de la zone palpée ; `excludeObject` refuse tout nom qui pourrait glisser une autre commande.

## Simulations

`simulateur.testkit.ts` dessine ce que verrait la caméra devant l'Ender 3 S1 Plus :
- plateau, feuille, objets qui montent couche par couche, portique, tête garée, montants du cadre ;
- petits fils, lumière qui varie, lampe de côté, bruit du capteur.

Pour ne pas tricher, l'analyse n'utilise pas la caméra exacte du dessin, mais une caméra calée comme le ferait l'utilisateur (9 points cliqués à ±1 pixel près).

| Scénario | Résultat |
| --- | --- |
| Impression normale (45 couches, fils, coup de lumière, lampe) | aucune alerte |
| Spaghetti sur 1 objet sur 3 | alerte couche 17, cet objet seul arrêté 2 min après, les autres jamais cités |
| Objet poussé par la buse | cet objet seul arrêté |
| Spaghetti sur l'unique objet | pause couche 17 |
| Décalage de couche de 10 mm | pause couche 18 |
| Feuille qui glisse de 8 mm | pause couche 17 |
| Buse bouchée | doute couche 30, pause couche 40 |
| Caméra bousculée | un doute « la caméra a bougé », aucune pause |
| Feuille décalée de 8, 5/6, 3,5/2 mm | mesurée à 1 mm près ; une cale bien placée devient « bloquante » sur la feuille décalée |
| Feuille absente | « je ne vois pas les bords » |
| Pièce oubliée | trouvée « au fond à droite » |
| 8 cas de fichier (dans le vide, îlot, hors volume, bord, collés, bascule, hors palpage, plateau correct) | tous justes |

Essais : `pannes.test.ts` 25/25, `objets.test.ts` 13/13, et pas de régression : `surveillance` 23/23, `devices` 17/17, `annonces` 7/7, `atelier` 33/33. Pas de variable inutilisée (tsc `noUnusedLocals`).

**Pas lancés ici** : `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` (npm bloqué dans le cloud). À faire par Claude Code.

## Limites, dites franchement

- **Images simulées seulement.** Les seuils viennent de ces dessins. Avant de laisser Jarvis arrêter un objet tout seul sur la vraie imprimante, il faut un banc de vraies photos (impressions réussies et ratées), comme prévu dans le cahier.
- **Ombres d'une lampe de côté** : non simulées en détail ; une lumière fixe (bande LED) est conseillée.
- **Plateau mobile** : avec une caméra fixée au cadre, il faut des photos prises au même endroit. Le plus simple est de garer la tête à chaque couche (comme pour un timelapse) : 2 à 3 secondes de plus par couche. Autre solution : une caméra fixée au plateau.
- **Petits décalages de couche** (moins de 5 mm environ) : pas vus de loin.

## À faire par Claude Code (au branchement)

1. OrcaSlicer : cocher « Étiqueter les objets » (Label objects). Klipper : `[exclude_object]` dans printer.cfg (avec l'accord de l'utilisateur).
2. Avant de lancer : lire le fichier par Moonraker, `analyserGcode` puis `controlerPlateau`, et montrer le résumé sur la carte de lancement. Photo du plateau vide : `mesurerFeuille` et `restesSurPlateau`.
3. Page de calage de la caméra : cliquer les points, `calerCamera`.
4. Pendant : une photo par couche à tête garée (macro de changement de couche), décodée en gris 640 px ; `comparer` (précédente, départ, 10 couches avant), `decalageDecor`, `stepObjets`, puis `vision` dans `stepSurveillance`. Nouvelle photo de départ après chaque arrêt d'objet. Actions `exclude` vers `excludeObject`.
5. Réponses « garde-le » et « arrête-le » (enceinte comprise : arrêter un objet n'est pas lancer) ; réglage « arrêter seul / seulement prévenir ».

Testé en vrai (à la voix, sur le PC) : PAS FAIT.
