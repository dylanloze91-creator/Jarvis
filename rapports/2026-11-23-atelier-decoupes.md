# Atelier 3D : les découpes (trous, ouvertures, encoches)

Branche `claude/atelier-decoupes`, partie de `claude/atelier-3d`. Demande de l'utilisateur (23 novembre) :
« si je veux qu'il fasse des trous, comme des encadrements pour laisser passer des câbles […] quand je lui demande, il faudra qu'il comprenne ».

## Ce qui marche

Sans modèle, par règles, dans une nouvelle demande ou sur la pièce à l'écran :

| Phrase | Ce que fait l'atelier |
| --- | --- |
| « Fais-moi une boîte de 80 par 50 par 30 avec un trou de 8 mm à l'arrière pour le câble » | boîte + trou rond de 8 mm dans la paroi arrière ; les mesures de la boîte restent justes (le 8 n'est pas une longueur) |
| « Ajoute un passage de câble de 15 par 10 sur la face avant, en bas » | ouverture rectangulaire 15 × 10, version suivante |
| « Fais des trous comme des encadrements pour laisser passer des câbles » | 2 ouvertures 20 × 12 à l'arrière (taille proposée, dite) |
| « Une encoche de 10 à l'arrière pour le câble » | encoche en U depuis le bord du haut (le câble se pose dedans) |
| « Quatre trous de fixation aux coins » | 4 trous de 4 mm dans le fond, aux coins |
| « Un trou de 8 sur le couvercle » (boîte avec couvercle) | trou dans le couvercle ; une encoche passe sous le rebord du couvercle |
| « Un socle rond de 10 cm avec un trou au milieu et une encoche vers l'arrière pour le câble » | trou de haut en bas + rainure dessous du bord au milieu (lampe) |
| « le trou plus gros », « mets le trou plus haut », « mets le trou à l'arrière » | modifie la dernière découpe, version suivante |
| « enlève le trou », « retire tous les trous » | retire, version suivante |

Faces : avant, arrière, côté gauche ou droit (vus de l'extérieur), fond, dessus (pièces pleines), couvercle. Places : centre, en haut, en bas, à gauche, à droite, aux coins, « de chaque côté ». Formes : trou rond, ouverture (encadrement, fenêtre, fente, passage de 15 par 10), encoche.

- Pièce creuse (boîte, bac) : la découpe traverse la paroi seulement. Pièce pleine (socle, entretoise, cale) : de part en part.
- Refus dits simplement, la version à l'écran reste : trou trop grand pour la face (avec la place disponible), trous trop serrés, boîte ouverte sur le dessus, encoche cachée par le rebord du couvercle, pièce pas encore percable (support de téléphone, équerre, crochet, porte-étiquette).
- Entretoise : « un trou de 4 » reste la mesure « diamètre du trou » ; une découpe seulement si la face est dite (« un trou de 3 sur le côté »).
- Chaque découpe apparaît dans la liste des mesures à côté de la pièce (« Découpe : trou de 8 mm à l'arrière ») et dans la phrase de la version (« Version 2 (Ajout : trou de 8 mm à l'arrière) »).

## Comment

- `packages/core/src/atelier/decoupes.ts` (pur) : lecture de la phrase, application (ajouter, modifier, enlever), placement et OpenSCAD (`difference()` de la pièce et des découpes), contrôles.
- Les découpes sont rangées dans les mesures de la version (`valeurs.decoupes`, texte JSON) : elles suivent les versions comme les autres mesures, sans rien changer côté PC (`tourAtelier.ts` inchangé).
- `fabriquer` (gabarits.ts) garde et contrôle les découpes ; `deciderAtelier` et `demandePiece` (discussion.ts) les lisent avant les mesures. « Le trou plus haut » ne change plus la hauteur de la pièce.

## Vérifié

- Tests : `decoupes.test.ts` 24/24 (coordonnées OpenSCAD calculées à la main pour chaque face, couvercle, socle et entretoise centrés, refus, discussion) ; `discussion.test.ts` 19/19, `atelier.test.ts` 34/34, `ecran3d.test.ts` 16/16 sans changement.
- Types : aucune erreur dans `atelier/`.
- **Pas fait ici** : rendu OpenSCAD réel (OpenSCAD n'est pas installable dans le nuage). À faire sur le PC par l'agent Atelier : rendre quelques pièces percées, `controlerStl` (fermé, cotes), et regarder l'image.

Testé en vrai (à la voix, sur le PC) : PAS FAIT.

## Pas encore

- Passage de câble de charge sur le support de téléphone (forme particulière, à faire comme une mesure du gabarit).
- Découpes sur l'équerre, le crochet, le porte-étiquette.
- Gros trous ronds sur une paroi verticale : imprimables en pont, sans forme en goutte pour l'instant.
