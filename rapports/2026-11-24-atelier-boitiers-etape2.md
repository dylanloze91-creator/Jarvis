# Atelier 3D, boîtiers électroniques : étape 2, la bibliothèque de composants (nuit du 23 au 24 novembre 2026)

Écrit par Claude Code (agent Atelier), branche `claude/atelier-boitiers`. Fait la nuit, sans attendre l'utilisateur, à sa demande : « Cette nuit, sans m'attendre : je ferai l'essai de l'étape 1 des boîtiers demain. […] fais l'étape 2 (la bibliothèque de composants). Ensuite, lance un grand contrôle avec le processeur seulement […]. N'envoie rien à l'imprimante. Ce qui demande mon accord, note-le pour demain. »

**Avant de commencer :**
- la carte graphique a été libérée dans `AGENTS-COORDINATION.md` (l'agent Yeux en a besoin vers 2 h 30) ;
- la fenêtre Jarvis Test d'essai a été fermée ;
- le modèle `qwen2.5:7b` qu'elle avait laissé sur la carte a été déchargé (`keep_alive: 0`).

Rien n'a été envoyé à l'imprimante. Pas de fusion, pas de publication.

## 1. Ce qui a été fait

| Demande de la mission | Où | Résultat |
| --- | --- | --- |
| `composants.ts`, fait depuis `donnees/composants.json` | `composantsDonnees.ts` (copie fidèle du JSON, générée, pas retapée), `composants.ts` | États `sur`, `incertain`, `a_mesurer` et sources gardés. Les 8 composants sont là. |
| Un composant à mesurer ne sert pas tant que l'utilisateur ne l'a pas mesuré, une question à la fois | `composants.ts` (`prochaineMesure`, `questionMesure`), `discussion.ts` (état `mesure`) | Exemple : « Je n'ai pas de cotes fiables pour ESP32-S3… : il faut le mesurer au pied à coulisse (9 mesures, une à la fois). Mesure 1 sur 9 : la longueur de la carte, en millimètres. Pour ça, pose les becs du pied à coulisse sur les deux petits bords de la carte, sans compter ce qui dépasse. » Une valeur absurde est refusée et la même question revient. |
| Mesures gardées et servant partout | `tourAtelier.ts` : `C:\dev\jarvis-data\atelier\composants-mesures.json` (écrit à part puis renommé) | Une autre discussion ne redemande pas ce qui a déjà été mesuré. Les mesures sont aussi recopiées dans la pièce : une version reste juste même si le fichier change. |
| Encombrement (enveloppe prudente), trous de fixation, prises avec leur jeu | `geometrieCarte`, `enveloppeCarte` | Raspberry Pi 5 : carte et trous « sûrs ». Le ventilateur officiel est « incertain » : on garde 15,5 mm de haut plus 4 mm d'air, soit 19,5 mm libres au-dessus de la carte. |
| Poser les plots, percer les prises dans la paroi qui leur fait face, amincir de l'extérieur à 1 mm | `poserCarte` | Même place que la référence, au centième de millimètre. |
| Manières de tenir : plots et vis ; logement, rebord et retenues souples ; chariot réglable | `tenir.ts` (`retenue`, `volet`, `bouton`, `chariot`, `flexionRetenue`, `champCamera`), sur un petit moteur de formes `csg.ts` (mêmes formes que `csg.py`) | Les 4 pièces rendues par OpenSCAD ont la taille des STL de la référence à 0,01 mm près. |

Dans la discussion : « mets des plots pour un Raspberry Pi 5 dans le fond, ports vers l'arrière » pose maintenant le Pi, ses plots et ses prises. Jarvis dit aussi les vis : « Raspberry Pi 5 : 4 vis autotaraudeuses M2,5 × 6 (4,5 mm dans les plots) ».
- **Carte inconnue** (Arduino) : Jarvis la dit, et propose l'entraxe.
- **Écran tactile et caméra** : ils ne se posent pas sur des plots. Jarvis dit qu'ils viendront avec le boîtier électronique (étape 3).

## 2. Les essais de la mission

| Essai | Résultat |
| --- | --- |
| Pi 5 : chaque plot tombe sur son trou à 0,01 mm près | Oui. Avec les ports à l'arrière, dans le socle de la référence (202,5 × 120, parois 2,4), les plots sont aux places de `hub.py` : (196,1 ; 34,6), (147,1 ; 34,6), (196,1 ; 92,6), (147,1 ; 92,6). |
| Pi 5 : chaque prise passe dans son ouverture avec 0,45 mm de jeu au moins | Oui, dans les 4 sens (ports à l'arrière, à l'avant, à gauche, à droite) : 0,5 mm pour l'Ethernet et les USB, 0,6 mm pour l'USB-C et les micro-HDMI. Les coins de l'ouverture sont arrondis du rayon du jeu seulement : un coin plus arrondi mangerait le jeu dans l'angle (calcul dans `jeuPrise`). L'USB-C a 1 mm de paroi devant lui, à la même place que la référence (z de 8,3 à 12,7). |
| Écran : retenues de 0 à 3 mm de flèche pour un bord de 7,5 à 10,5 mm, allongement de 2,5 % au plus | Oui (essai tous les 0,25 mm). Mêmes chiffres que le banc de la référence : 1,1 mm, 3,7 N et 0,7 % pour 8,6 mm ; 3 mm, 10,2 N et 2,0 % pour 10,5 mm. |
| Caméra : champ de 120° en diagonale coupé par rien, objectifs décalés de ±0,5 mm | Oui, après un écart voulu avec la référence (voir plus bas). Même méthode que `banc_hub.py`. Champ : 2 880 rayons, 0 bloqué. Coins de l'image à 120° : 240 rayons, 0 bloqué. Pour −0,5, 0 et +0,5 mm. |
| Réglage du chariot | De 4,5 à 14,5 mm : couvre 5,75, 9,5 et 13,4 mm (les trois sources). |

**Écart avec la référence, à ta décision demain.**
- Ce que j'ai trouvé : avec la fenêtre de la référence, 14 mm de large dedans et au trou du cache, les coins de l'image à 120° touchent le bord quand l'objectif est décalé de 0,5 mm (2 rayons sur 240, de quelques centièmes de millimètre).
- Pourquoi la référence ne l'a pas vu : son banc n'essayait les coins qu'avec l'objectif centré, alors que la mission demande ±0,5 mm.
- Ce que j'ai fait : la bibliothèque prend 15 mm, ce qui passe partout. Le cache fermé couvre toujours la fenêtre : son plein va de 15,5 à 34 mm, la fenêtre fermée de 17,5 à 32,5 mm.
- Ce qui reste à décider : garder 15 mm pour le boîtier de l'étape 3, ou revenir à 14 mm.

## 3. Grand contrôle, au processeur seulement

Commande : `npm run banc:atelier --workspace @jarvis/desktop` (nouveau banc, hors de `npm test`). Fichier : `apps/desktop/src/main/atelier/grand-controle.banc.ts`.

Le banc fait passer chaque pièce par la même chaîne que l'atelier :
- **OpenSCAD** : rendu de la pièce ;
- **`controlerStl`** : pièce fermée et aux cotes de `taille()` ;
- **`controlerImpression`** : pas de surplomb de plus de 45°, pas de pont de plus de 25 mm ;
- **OrcaSlicer** : la pièce est préparée avec tes préréglages (Textured PEI). Ils sont lus et copiés aplatis à part, jamais modifiés.

Pour les pièces de la référence, il compare aussi la taille au STL du hub. Le détail pièce par pièce est dans `C:\dev\jarvis-data\atelier\_grand-controle\grand-controle.md` et `.json`, avec chaque `.scad`, `.stl` et `.gcode`.

- **Processeur seulement.** Ni carte graphique, ni Ollama (vérifié : `/api/ps` vide à la fin). Le tranchage d'OrcaSlicer en ligne de commande n'utilise que le processeur.
- **Rien envoyé à l'imprimante.**

**Résultat : 55 pièces bonnes sur 56.** Le passage complet dure un peu plus de 2 minutes (3 pièces à la fois).

| Famille | Pièces | Résultat |
| --- | --- | --- |
| Les 10 gabarits par défaut | 10 | toutes bonnes, préparées par OrcaSlicer |
| Variantes (cas limites) | 14 | 13 bonnes. **Casse : support de téléphone « dos-long »** (inclinaison 40°), voir plus bas. |
| Avec découpes | 20 | toutes bonnes. Détail : boîte avec trou, ouverture, encoche, trous aux coins, deux trous, au millimètre, centrée en hauteur, coins arrondis, fenêtre évasée, et une boîte avec cinq découpes ensemble. Boîte à couvercle percée sur le couvercle, encoche, ouverture. Bac : trou, encoche. Socle : trous aux coins, rainure, ouverture dessus. Entretoise percée de côté, cale percée. |
| Ajouts de matière (étape 1) | 3 | toutes bonnes : bossages et emboîtement (72 s de rendu), plots et nervure, rebord intérieur |
| Composants (étape 2) | 3 | toutes bonnes : Pi 5 ports à l'arrière, Pi 5 ports à droite avec couvercle emboîté, ESP32 avec des **mesures d'essai** (pas les tiennes, écrites nulle part) |
| Manières de tenir | 4 | toutes bonnes, dans leur sens d'impression. Écart avec les STL du hub : 0 à 0,01 mm. Retenue 3,2 × 12,3 × 36 mm, cache 1,6 × 22 × 34, bouton 2,85 × 5 × 5, chariot 5,5 × 27 × 78. |
| Refus attendus | 2 | bons : un trou dans un support de téléphone est refusé (« Je ne sais pas encore faire de découpes… ») ; des bossages dans un crochet aussi (« dans les boîtes seulement ») |

**Ce qui casse :**
1. **Support de téléphone incliné à 40°** (variante « dos-long »).
   - Ce que dit le contrôle : « surplomb de plus de 45° sur 119,2 cm², de 4 à 99,8 mm de haut ».
   - Pourquoi : le dossier penche de 50° par rapport à la verticale, il lui faut un support d'impression.
   - Ce qui passe : 45°, 60° et 75°.
   - Pas corrigé : c'est un gabarit d'avant la mission (voir section 4, point 1).

**Ce qui a cassé en route et a été corrigé :**
- **Retenue et chariot** : je les avais d'abord rendus dans leur sens de montage. Le contrôle d'impression les refusait (« partie en l'air… »), avec raison. Ils ont maintenant leur sens d'impression, comme dans la référence (`piecesATenirAImprimer`).
- **Cale, crochet et socle rond** : mes phrases d'essai ne donnaient pas toutes les mesures. L'atelier posait sa question, ce qui est le bon comportement. Le banc répond maintenant « oui » à la proposition, comme tu le ferais.

**Temps de rendu à surveiller.** OpenSCAD 2021 met 72 s pour la boîte à couvercle à bossages, et 26 à 32 s pour une boîte avec le Raspberry Pi 5 (les cylindres à 96 facettes coûtent cher). La limite de l'atelier est de 180 s. Le boîtier de l'étape 3 aura beaucoup plus de formes : il faudra peut-être réduire les facettes des petits trous, ou relever la limite.

## 4. Ce qui demande ton accord (pour demain)

1. **Support de téléphone à moins de 45°.** Le contrôle d'impression le signale, et la pièce est montrée avec « Sans support, ça risque de mal s'imprimer ». Deux corrections possibles :
   - le gabarit l'imprime couché sur le côté (aucun surplomb, quel que soit l'angle) ;
   - le gabarit refuse les angles sous 45°.
2. **Fenêtre de la caméra.** La bibliothèque prend 15 mm au lieu de 14 mm (section 2), sinon les coins de l'image sont coupés avec l'objectif décalé de 0,5 mm. Garder 15 mm pour le boîtier de l'étape 3 ?
3. **L'essai rapide des étapes 1 et 2 dans Jarvis Test**, avant l'étape 3. Phrases :
   - étape 1 : celles de `rapports/2026-11-23-atelier-boitiers-etape1.md` ;
   - étape 2 :
     1. « Fais-moi une boîte de 120 par 100 par 40 »
     2. « mets des plots pour un Raspberry Pi 5 dans le fond, ports vers l'arrière »
     3. « mets des plots pour l'ESP32 » : Jarvis te demande la première mesure ; tu peux dire « laisse tomber ».
4. **Les mesures des composants à mesurer** : ESP32 sur sa carte à borniers, ampli MAX98357A, micro INMP441, petit écran OLED, haut-parleur. Ce sont des mesures au pied à coulisse, à donner quand tu veux. Jarvis les demande une à une et les garde dans `C:\dev\jarvis-data\atelier\composants-mesures.json`. Rien n'est inventé en attendant.
5. **Les vis des cartes.** Jarvis annonce « M2,5 × 6 (4,5 mm dans les plots) » pour le Raspberry Pi 5, comme la référence : 0,1 mm de plus que l'avant-trou de 4,4 mm, accepté par la référence pour une vis autotaraudeuse. À confirmer si tu préfères des plots un peu plus hauts.
6. **La carte graphique** est libre depuis 23 h 30 pour l'agent Yeux. Le banc de l'atelier ne s'en sert pas.

## RAPPORT DE VÉRIFICATION

- Construction : cœur `tsc` OK (`npm run build --workspace @jarvis/core`).
- Types : `npm run typecheck`, 0 erreur pour le cœur et pour le bureau.
- Style : `npm run lint`, 0 erreur.
- Tests (sans `npm test` en entier, pour ne pas charger de modèle sur la carte graphique, réservée cette nuit à l'agent Yeux) :
  - **Cœur** : `vitest run` sans le seul essai qui appelle le vrai Ollama (« appelle le modèle réel », dans `lab.test.ts`). 2 921 bons et 1 délai dépassé, dans `learning/experienceFamilies.test.ts`. Relancé seul, il passe (5 sur 5) : c'était la charge du processeur.
  - **Bureau** : 951 bons, 8 ignorés comme avant. Seul souci : le rangement de fin de `developer/project/platformerMissionPath.test.ts` dépasse 10 s sous Windows. Ses 6 essais passent, le fichier n'a pas été touché, et il passait au contrôle de l'étape 1 : essai instable, sans rapport avec l'atelier.
  - **Nouveaux essais** :
    - `composants.test.ts` (18) : données, mesures une à la fois, Pi 5 posé (plots à 0,01 mm, prises à 0,45 mm de jeu au moins, 1 mm de paroi), retenues, champ de la caméra, réglage du chariot, discussion avec Pi 5, ESP32 et refus ;
    - `tourAtelier.test.ts` (+1 : mesure gardée dans `composants-mesures.json`, pas redemandée ensuite) ;
    - `ajouts.test.ts` : l'essai « Raspberry Pi 5 refusé à l'étape 1 » est remplacé par « posé à l'étape 2, carte inconnue dite ».
- OpenSCAD et OrcaSlicer : grand contrôle 55 sur 56. La casse est un vrai défaut, connu, et dit (section 3).
- Secrets : aucun. Préréglages OrcaSlicer lus seulement. Les mesures d'essai de l'ESP32 n'existent que dans le banc, jamais écrites dans le fichier des mesures.
- Relecture :
  - aucune cote inventée : tout vient de `composants.json`, ou des mesures de l'utilisateur, ou est un choix de dessin nommé comme dans `hub.py` ;
  - un composant « à mesurer » ne sert jamais sans ses mesures ;
  - l'imprimante n'est jamais appelée par le banc.
- Imprimante : rien envoyé.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT. L'essai dans Jarvis Test est pour demain (section 4).
