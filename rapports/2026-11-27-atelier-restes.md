# Atelier 3D : les petits restes de la revue de nuit

Écrit par Claude Code (agent Atelier, nouvelle session), nuit du 26 au 27 novembre 2026. Branche `claude/atelier-restes`, partie de `claude/dev`. Suite du rapport `rapports/2026-11-26-nuit-atelier.md`, § 5.

**Jarvis Test seulement. Rien n'est fusionné dans `claude/dev`, rien n'est publié, rien n'a été envoyé à l'imprimante.** Rien n'a été essayé dans la fenêtre ni à la voix : essais automatiques, et la recherche des cotes rejouée en vrai par un banc.

## 1. En bref

| Reste (rapport du 26, § 5) | État |
| --- | --- |
| 1. Recherche des cotes rejouée en vrai, avec la clé Tavily | **fait** : 15 recherches sur 20, aucune bloquée (§ 2) |
| 2. Dire quand tes mesures passent avant celles d'Internet | **fait** (§ 3) |
| 3. Cotes par défaut « à vérifier » pour le micro, l'ampli, le haut-parleur | **fait** pour l'ampli et le micro ; le haut-parleur a ses cotes mais n'est pas encore tenu dans une boîte (§ 4) |
| 4. Place faite pour d'autres écrans | pas demandé cette nuit, pas fait |

## 2. La recherche des cotes, en vrai

**La clé.** Tavily est réglé dans la **Live** (fournisseur `tavily`, clé dans le coffre). **Jarvis Test n'a aucune clé de recherche** (fournisseur `google`, sans clé) : dans Jarvis Test, l'atelier cherche donc encore avec les moteurs sans clé, ceux qui ont bloqué ce PC la nuit du 25. **À faire par toi : mettre la même clé Tavily dans Jarvis Test** (Réglages → Le cerveau de Jarvis → Recherche).

Pour l'essai, la clé a été lue dans une copie temporaire du coffre de la Live, gardée en mémoire le temps du banc, jamais écrite ni affichée ; la copie a été effacée. La Live n'a pas été touchée.

**Le banc** (`npm run banc:cotes-web --workspace @jarvis/desktop`) : la vraie étape de l'atelier (`chercherCotes`), les vraies pages, les vrais plans DXF et PDF, le vrai modèle local (`qwen2.5:7b`). Chaque recherche est **comptée** dans `C:\dev\jarvis-data\atelier-nuit\recherches-2026-11-27.json` (20 au plus pour la journée) et **espacée de 60 secondes**. Avec la clé, seul Tavily est interrogé (pas de repli sur les moteurs sans clé). La carte graphique est prise par la réservation locale (`gpu.json`) le temps de chaque lecture, et rendue.

**Résultats** (détail : `C:\dev\jarvis-data\atelier-nuit\cotes-web-2026-11-27-*.json`) :

| Produit | Recherches | Durée | Ce qui est trouvé |
| --- | --- | --- | --- |
| ESP32-S3-DevKitC-1 | 2 | 1 min 31 s | **Les deux plans DXF d'Espressif lus** : carte de 62,87 × 25,46 mm, aucun trou de fixation, 2 prises (USB, UART), un module qui dépasse. Deux sites disaient 70 × 28 mm : le plan du fabricant l'emporte, comme prévu. Manquent : l'épaisseur et les hauteurs (pas sur un plan vu de dessus). |
| Ampli MAX98357A | 4 | 3 min 11 s | Largeur 17,9 mm, sûre (DFRobot et Adafruit d'accord). Longueur : trois cartes différentes sous le même nom (25,5 / 18 / 19,4 mm), dit tel quel, rien n'est pris. Le plan de DFRobot est un dessin sans texte : dit, pas deviné. |
| Micro INMP441 | 4 | 4 min (temps prévu atteint) | Presque rien : l'épaisseur (1 mm, une seule source). Les pages des vendeurs ne donnent pas la taille de la petite carte. |
| Écran OLED 1,3 pouce SH1106 | 1 puis 4 | 10 min 51 s puis 3 min 10 s | Premier passage : rien (voir ci-dessous). Second passage : carte de 35,4 × 33,5 mm, **une seule source**, donc « à vérifier » ; ni la fenêtre, ni les trous, ni les hauteurs. Un PDF de fabricant est un dessin sans texte : dit, pas deviné. |

**Ce que l'essai en vrai a montré :**

- **La recherche marche** avec Tavily : 15 recherches, toutes ont rendu 6 résultats, aucun blocage.
- **Un vrai défaut, corrigé** : au premier passage, l'écran OLED est resté **10 minutes 51** sur un seul PDF, pour finir par « je n'ai rien pu lire ». La lecture d'une page par le modèle local n'avait aucun délai. Elle en a un maintenant (90 secondes, `DELAI_LECTURE_MS`) : au-delà, la page est passée et la recherche continue. **La cause exacte n'est pas trouvée** : au second passage (avec un chronomètre), chaque lecture par le modèle a pris de 2 à 18 secondes, sans attendre la carte graphique, et le PDF du premier passage n'est pas revenu dans les résultats. Le coupable est donc plutôt le téléchargement ou la lecture de ce PDF que le modèle, et là je n'ai **rien corrigé** : le délai ajouté protège la lecture par le modèle, pas celle d'un PDF. À reprendre si ça revient (le PDF : « 1.3-Inch-I2C-IIC-OLED-LCD-Module-4pin-with-VCC-GND-Blue-1.pdf »).
- **Pour les petits modules sans référence précise** (ampli, micro), Internet ne donne pas de quoi dessiner : plusieurs cartes différentes portent le même nom. C'est ce qui justifie les cotes par défaut du § 4.
- Les corrections de la nuit du 25 (cotes invraisemblables refusées, résumé qui ne se contredit pas) n'ont rien laissé passer de faux ici.

## 3. Tes mesures avant celles d'Internet : c'est dit

Après une recherche, quand tu as mesuré une cote et qu'Internet dit autre chose (plus de 0,25 mm d'écart), ta mesure reste utilisée **et la réponse le dit**, avec les deux nombres :

> « Je garde tes mesures plutôt que celles d'Internet (la longueur de la carte de l'écran : 36 mm mesurés par toi, 35,4 mm sur Internet) : c'est toi qui as la pièce en main. Si elles viennent d'une autre carte, dis « oublie mes mesures de … ». »

- **« oublie mes mesures de l'ESP32 »** existe maintenant : elles sont mises de côté dans le fichier (jamais effacées), et la pièce se refait sans elles.
- **Un cas ne change pas, et il faut que tu le saches** : quand une cote **sûre** (plan du fabricant, ou deux sites d'accord) contredit ta mesure de plus de 1 mm, c'est encore ta mesure qui est mise de côté, avec la phrase « J'ai mis de côté tes anciennes mesures… elles ne collent pas avec « … » ». C'est ce qui s'est passé le 25 au soir avec tes 73 × 83 mm (ta carte sur bornier) contre le plan de la DevKitC nue. La règle date du 25 novembre (une mesure n'a pas de référence, elle a pu être prise sur une autre carte). **À décider par toi** : faut-il que ta mesure gagne toujours, même contre un plan ? Je ne l'ai pas changé sans ton avis.

## 4. Cotes par défaut « à vérifier »

| Composant | Cotes par défaut | D'où |
| --- | --- | --- |
| Ampli MAX98357A | carte de 19,4 × 17,8 mm, épaisseur 1,6 mm, 10 mm au-dessus (bornier à vis), 3 mm dessous | la carte Adafruit, la plus copiée ; la recherche de cette nuit a relu 19,4 et 17,8 mm sur sa page |
| Micro INMP441 | carte de 14 × 14 mm (elle est ronde, 14 mm de diamètre), épaisseur 1,6 mm, 3 mm dessus, 3 mm dessous | les modules ronds courants ; **pas confirmé par la recherche de cette nuit** (aucune page ne donnait la taille) |
| Haut-parleur 3 W 4 Ω | rond de 40 mm, 20 mm de profondeur | le format le plus courant ; **pas vérifié**, et tu en as peut-être un autre (ovale, 50 mm…) |

- « pose l'ampli dans la boîte », « pose le micro dans la boîte » : **plus aucune question**. La pièce est dessinée, et la réponse dit : « Pour ampli I2S MAX98357A, j'ai pris mes cotes par défaut (celles des modules les plus courants, pas les tiens) : à vérifier sur ta pièce avant d'imprimer. Pour donner les tiennes : « je veux mesurer l'ampli ». » À l'enceinte : « Cotes par défaut pour … : à vérifier. »
- **« je veux mesurer l'ampli »** : les cinq questions du pied à coulisse reviennent, et tes mesures remplacent les cotes par défaut.
- « un micro » tout court est maintenant reconnu (avant : seulement « micro I2S »). « micro USB », « micro HDMI », « micro SD » restent des prises.
- **Le haut-parleur** : l'atelier ne sait pas encore le tenir dans une boîte (il lui faut une grille et un appui). Il dit sa place par défaut (« compte environ 40 mm de diamètre et 20 mm de profondeur… à vérifier sur le tien ») et propose des aérations. Le tenir vraiment est un dessin à faire, pas un réglage.
- Une cote par défaut n'est jamais écrite dans un fichier, jamais dite sûre, et disparaît dès qu'il y a une mesure de toi ou une lecture sur Internet.

## 5. Ce qui reste

1. **Mettre la clé Tavily dans Jarvis Test** (§ 2) : sans elle, tout ce qui précède ne sert pas dans Jarvis Test.
2. Ta décision du § 3 (ta mesure contre un plan du fabricant).
3. Tenir le haut-parleur (grille, appui) ; place faite pour d'autres écrans (reste 4 du rapport du 26).
4. Les 7 phrases « web » du banc des phrases n'ont pas été rejouées telles quelles (elles auraient coûté plus de 20 recherches) : la recherche est rejouée par le banc compté, pas par ces phrases.
5. Rien n'a été essayé par toi : voir § 6.

## 6. À essayer par toi (Jarvis Test construit depuis cette branche)

1. « Fais-moi une boîte de 120 par 100 par 40 », puis « pose l'ampli dans la boîte » : pas de question, et la phrase « cotes par défaut… à vérifier ».
2. « pose le micro dans la boîte », « pose le haut-parleur dans la boîte ».
3. « je veux mesurer l'ampli », réponds aux cinq questions, puis « oublie mes mesures de l'ampli ».
4. Après avoir mis la clé Tavily : « un boîtier pour mon ESP32-S3 DevKitC-1 » et regarde s'il lit le plan d'Espressif.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK pour le cœur (npm run build --workspace @jarvis/core) ; l'application elle-même n'a pas été construite ni lancée
Types     : OK (npm run typecheck)
Style     : OK (npm run lint, 0 erreur)
Tests     : cœur 265 fichiers verts (3 365 essais, 1 ignoré comme d'habitude) ; bureau 198 fichiers verts (1 091 essais), 4 fichiers ignorés comme d'habitude
            essais figés verts, aucun __golden__ régénéré
            banc de la recherche en vrai : 15 recherches sur 20, 4 produits, aucun blocage
Secrets   : OK (la clé Tavily lue dans une copie temporaire du coffre de la Live, en mémoire seulement, jamais écrite ni affichée ; copie effacée)
Fichiers  : packages/core/src/atelier/ (composants, discussion, ajouts + essais), apps/desktop/src/main/atelier/ (tourAtelier, atelierPC, cotes-web.banc + essais), apps/desktop/package.json (script du banc), CLAUDE.md, ce rapport
Prêt à fusionner : OUI dans claude/dev, par l'agent Corrections, après ton essai (§ 6)
Testé en vrai (à la voix, sur le PC) : PAS FAIT. Fait en vrai : la recherche des cotes seulement (banc, sans fenêtre ni voix)
```
