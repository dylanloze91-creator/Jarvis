# Nuit du 25 au 26 novembre : l'atelier 3D passé en revue, réparé, et la Live 5.0.81 préparée

Écrit par Claude Code. Branches : `claude/atelier-nuit-1126` (fusionnée dans `claude/dev`, Jarvis Test `5.1.0-test.4`) et `claude/live-5081` (Live 5.0.81). **Rien n'est publié. Rien n'a été envoyé à l'imprimante** (une impression de 8 h 34 tournait) : tous les essais d'impression et de file d'attente sont passés par une fausse imprimante en mémoire, et le banc refuse tout appel vers `mainsailos` ou le port 7125. La Live installée et le Jarvis Test installé n'ont pas été touchés. La carte graphique a été partagée avec l'agent Yeux toute la nuit (ses photos toutes les 10 minutes ont continué).

## 1. Résumé

| | Avant | Après |
| --- | --- | --- |
| Phrases de la nuit (203 au départ, 216 à la fin) | **154 sur 202** (76 %) | **209 sur 209**, hors les 7 phrases de recherche web |
| Premier examen à l'aveugle (38 phrases neuves) | | 28 sur 38 au premier passage, 38 sur 38 après corrections |
| Deuxième examen à l'aveugle (32 phrases neuves) | | 27 sur 32 au premier passage, 32 sur 32 après corrections |
| Passage final, tout ensemble | | **279 sur 279** |
| Recherche des cotes sur Internet (7 phrases) | 6 sur 7 | 7 sur 7, mais **sans vraie recherche** : voir § 5 |
| Phrases d'atelier parties à un modèle par erreur | 45 tours au modèle sur 202 | 16 sur 279, toutes voulues (« quelle heure il est », « mets la musique »…) |
| Un boîtier de Raspberry Pi 5 | 30 à 34 s | 12 s |
| Le boîtier à écran (9 pièces, 64 contrôles) | 4 min 10 s | 1 min 47 s |

Sur les 48 ratés du départ, 5 étaient des erreurs de mes propres attentes (la réponse de l'atelier était bonne) ; les 43 autres étaient de vrais ratés. Les deux examens servent à ne pas me tromper moi-même : leurs phrases ont été écrites après les corrections et passées une seule fois avant d'être regardées. Ils ont trouvé 15 trous de plus, corrigés ensuite. Un troisième examen en trouverait encore : compter 85 % de réussite sur des phrases jamais vues, pas 100 %.

## 2. L'inventaire : ce que l'atelier sait faire

Tout se décide par règles, sans modèle (`packages/core/src/atelier/`), et le PC fait le travail (`apps/desktop/src/main/atelier/`).

- **Onze pièces** : boîte, boîte avec couvercle, bac à compartiments, entretoise, équerre, crochet mural, support de téléphone, socle (rond ou carré), porte-étiquette, cale, boîtier à écran.
- **Mesures et questions** : « 80 par 50 par 30 », « 12 cm », nombres en lettres, une question à la fois avec une valeur proposée.
- **Versions** : chaque changement fait une version, l'ancienne reste ; « plus haute », « hauteur 45 », « reviens à la version 1 ».
- **Trous, ouvertures, encoches** : ronds ou rectangulaires, sur une face, à une hauteur, aérations, passage de câble.
- **Boîtiers électroniques** : plots, bossages à insert, nervure, rebord, couvercle qui s'emboîte ; le Raspberry Pi 5 posé avec ses prises percées en face ; bibliothèque de composants (Pi 5, écran tactile 7 pouces, caméra, ESP32 sur bornier, écran OLED, micro, ampli, haut-parleur), ceux « à mesurer » demandés au pied à coulisse ou cherchés sur Internet (pages, plans DXF et PDF), chaque cote avec sa source.
- **Boîtier à écran** : Pi 5 + écran 7 pouces + caméra, 9 pièces, 64 contrôles avant d'être montré.
- **Écran 3D** dans la fenêtre ; **images et vue 3D sur l'iPhone** par liens à usage unique.
- **OrcaSlicer** avec les préréglages de l'utilisateur (lus seulement) : temps et filament ; **carte de confirmation**, envoi à l'imprimante, **file d'attente** laissée en pause, « le plateau est vide, lance la suivante ».
- **Depuis une enceinte** : la pièce se fait, la réponse est courte, rien ne s'imprime.

## 3. Les essais

`npm run banc:phrases-atelier --workspace @jarvis/desktop` (`apps/desktop/src/main/atelier/phrases-atelier.banc.ts`, phrases dans `phrasesAtelier.ts`).

- **286 phrases** écrites par Claude dans le style de l'utilisateur (ses vraies phrases lues dans le journal des tours de la Live et de Jarvis Test, ses essais du 24 novembre depuis l'iPhone et du 25 au soir, le carnet des ratés) : sans ponctuation, « du coup », « genre », « rajoute », suites (« non plus large », « et en plus grand »), nombres en lettres, fautes de dictée (« rasberry pie », « 15mn », « joute »), demandes floues. **Aucune n'est recopiée ; elles ne servent qu'aux essais, jamais à l'entraînement.**
- Chaque phrase est dite dans la **vraie session** : copie des réglages de Jarvis Test (lus seulement), vrai chef d'orchestre et `qwen2.5:7b`, vrai OpenSCAD, vrai OrcaSlicer, atelier dans un dossier à part avec ses propres données. Fenêtre, téléphone et enceinte.
- Trois contrôles par phrase : la bonne équipe (l'atelier, ou surtout pas lui), le bon résultat (pièce, question, réponse, appel à l'imprimante attendu ou interdit), une réponse juste (STL relu : fermé et aux cotes attendues ; images présentes ; texte attendu). La durée est notée.
- Résultats et journaux : `C:\dev\jarvis-data\atelier-nuit\` (`resultats-avant.json`, `resultats-final.json`, `resultats-examen.json`, `resultats-examen2.json`).
- Essais automatiques ajoutés : `packages/core/src/atelier/style.test.ts` (79 essais, une phrase par correction), `apps/desktop/src/main/atelier/atelierPC.test.ts`, un essai de session.
- Grand contrôle des pièces (`npm run banc:atelier`) après le changement des facettes : **67 pièces sur 67** (rendues, fermées, aux cotes, imprimables, préparées par OrcaSlicer).

## 4. Ce qui a été réparé

**Le défaut principal : l'atelier lâchait la main.** Une réponse qu'il ne savait pas lire partait à un modèle, qui répondait « je ne peux pas imprimer », ou imitait l'atelier et annonçait une « Version 5 » avec des cotes inventées. C'est ce qui est arrivé le 25 au soir avec « daccord dessinne tout ca pour moi » et « modelise ».

- Question en attente : « ouais vas-y », « fais comme tu veux », « je sais pas trop », « peu importe » gardent la valeur proposée ; « c'est quoi déjà la question » la redit ; « 10 par 6 par 3 centimètres » répond à trois questions ; une réponse courte illisible repose la question ; « attends je reviens » est compris. Une vraie autre demande (« quelle heure il est », « mets pause ») suit toujours son chemin.
- Mesure d'un composant en attente : « dessine-le avec ce que t'as », « vas-y modélise » prennent de la marge partout où c'est possible, en le disant ; ce n'est plus cherché sur Internet comme si c'était une référence de carte ; « je sais pas c'est quoi comme modèle » non plus.
- La pièce reste à l'écran six demandes (elle se perdait après deux échanges sans rapport).
- « tu sais faire quoi en 3D », « modélise-moi ça », « tu peux m'imprimer quelque chose » donnent la liste des pièces ; ensuite « une boîte alors » suffit.
- Les équipes du chef d'orchestre savent que l'atelier existe, et ne voient plus ses réponses (elles les imitaient).

**Des réponses fausses, notées « bonnes » par un contrôle trop simple, trouvées en relisant chaque réponse :**

- « rajoute un trou de 50 » refusé, puis « bon alors de 10 » : la **longueur de la boîte** passait à 10 mm. Maintenant le trou est refait à 10 ; un nombre dit seul demande « 10 pour quelle mesure ? ».
- « boîte avec couvercle de 100 par 60 par 40 » était dite « de 210 × 60 × 40 mm » (la place sur le plateau). Elle est dite à ses cotes.
- « une boîte pour mon raspberry pi 4 » ou « pi zero » recevait les plots et les prises du **Pi 5**. Ils sont dits inconnus, boîte simple.
- « un trou de 15mn par 5mn à 20mn de hauteur » faisait un trou rond de 15 mm. C'est maintenant l'ouverture de 15 × 5 mm à 20 mm du bas.
- « un bac de 150 par 100 par 30 avec 3 cases par 2 » était refusé (150 colonnes).
- « et aussi une cale de 60 de long… » changeait la boîte à l'écran au lieu de faire la cale.
- Un écran d'une taille inconnue (« écran de 5 pouces ») était oublié sans rien dire.
- « non plus large » après « plus haute » gardait la hauteur refusée.
- Cotes lues sur Internet : 53,7 mm de haut au-dessus d'une carte et 4,6 mm entre deux trous (le 25 au soir) sont maintenant refusées ; le résumé de recherche ne se contredit plus.

**Autres :** « encore un peu », « remets-le », « non enlève-le », « la version 2 », « reprends la version une », « les ports à gauche », « et le même à droite », « vas-y imprime », « tu peux la lancer », « mets-la plutôt en file d'attente », « envoie-moi les images », « imprime-la » sans pièce (« je n'ai pas de pièce à imprimer »), « lance la suivante » (partait à la musique), « imprime le fichier boite.gcode » (dessinait une boîte), réponses courtes à l'enceinte (la fiche entière, vis et ventilateur compris, était dite à voix haute).

**Lenteur :** les petits arrondis étaient dessinés avec 96 facettes. Elles suivent maintenant le rayon (écart avec le cercle sous 0,02 mm) : le boîtier du Pi 5 passe de 30 à 12 s, le boîtier à écran de 4 min 10 s à 1 min 47 s.

## 5. Ce qui reste

1. **Recherche des cotes sur Internet : pas rejouée pour de vrai.** Vers minuit, après mes passages répétés, les moteurs de recherche ont bloqué ce PC (DuckDuckGo : défi anti-robot ; Google : page vide ; Bing : résultats hors sujet). Les 7 phrases passent, mais la réponse est « je n'ai rien pu lire sur Internet… réessaie plus tard ». Les corrections de cette partie (cotes invraisemblables, résumé, lien donné) sont couvertes par les essais automatiques seulement. **À rejouer demain** : `JARVIS_ATELIER_SEULEMENT=web`. Ce blocage peut aussi t'arriver en usage normal après beaucoup de recherches.
2. **Le 25 au soir, l'atelier a pris ta carte ESP32 pour celle de sa liste** (la DevKitC sur bornier) et a cherché les cotes de la DevKitC nue, alors que tu avais déjà mesuré 73 × 83 mm. Tes mesures passent avant les cotes d'Internet, mais la réponse ne le dit pas. Pas réglé : il faut décider quoi dire, et je ne pouvais pas rejouer la recherche.
3. **Le micro, l'ampli et le haut-parleur** sont dans la bibliothèque mais « à mesurer » : l'atelier pose jusqu'à cinq questions par composant. Long à la voix. À décider : des cotes par défaut pour les modules courants.
4. **Un écran autre que le 7 pouces officiel et l'OLED 1,3 pouce** n'a pas de place faite : c'est dit, et il faut demander la fenêtre à la main.
5. « mets en six plutôt » sur un bac demande « 6 pour quelle mesure ? » au lieu de deviner les colonnes. Voulu (un nombre seul ne change rien sans nommer la mesure), mais un peu raide.
6. « fais-moi un pot de fleurs » sans rien d'atelier avant reste au modèle, qui renvoie maintenant vers l'atelier. Je ne l'ai pas donné à l'atelier : « fais-moi un résumé » ou « fais-moi un café » partiraient avec.
7. **Les bossages** (boîte à couvercle avec quatre bossages) : 71 s avant ; pas remesuré seul après le changement des facettes (les autres contrôles tournaient en même temps).
8. **Pas essayé à la voix, ni à la souris, ni sur le vrai iPhone** : les phrases sont tapées par le banc. L'écran 3D et la page du téléphone sont couverts par les essais automatiques et par l'essai de l'installateur (§ 7), pas par ta main.
9. **Le grand contrôle a écrit ses résultats dans `C:\dev\jarvis-data\atelier\_grand-controle\`** (son dossier habituel) : ceux de l'agent Atelier du 25 y sont remplacés par ceux de cette nuit.

## 6. Jarvis Test 5.1.0-test.4

`claude/atelier-nuit-1126` contient `claude/dev` et le dernier travail de l'agent Atelier (l'examen du hub, `680b350`), puis les corrections de la nuit. Version `5.1.0-test.4`. Contrôles : types, style, cœur 264 fichiers (3 338 essais), bureau 195 fichiers (1 054 essais, 4 fichiers ignorés comme d'habitude), essais figés sans régénération.

## 7. Live 5.0.81

Branche `claude/live-5081`, partie de `claude/live-5080` (la 5.0.80 avec l'enceinte par USB et le volume). **Seul l'atelier y entre** : ni les yeux, ni l'imprimante surveillée, ni le carnet, ni les éditions de Jarvis Test.

- Ce qui est porté : `packages/core/src/atelier/`, le client Moonraker, `apps/desktop/src/main/atelier/`, l'écran 3D, la carte de pièce du téléphone, le crochet dans la session (avant tout modèle), `SendChatInput.place` (pour que rien ne se lance depuis une enceinte).
- **Sans réglage** : OpenSCAD et OrcaSlicer sont trouvés seuls ; les pièces vont dans `C:\dev\jarvis-data\atelier` ; l'imprimante est jointe à `http://mainsailos.local` tant que rien n'est réglé. Réglages → Ce que Jarvis sait faire → « Atelier 3D » : décocher l'envoi, changer l'adresse, clé, téléphone.
- Dans la Live, « imprime » seul sans pièce reçoit aussi « je n'ai pas de pièce à imprimer » (dans Jarvis Test, cette phrase reste à l'imprimante du lot B).
- `parseSettings({})` ne gagne aucune clé ; les essais figés passent sans régénération.
- Le programme de l'enceinte ne change pas : il reste étiqueté 5.0.80.

- **Essai de la Live empaquetée** (le dossier `win-unpacked` de l'installateur, lancé dans un dossier de données à part, avec une copie des réglages de la Live ; la Live installée tournait à côté, non touchée) : « fais moi une boite de 80 par 50 par 30 » tapé dans la discussion → pièce dessinée en 5 s, « fermée et aux bonnes mesures », écran 3D affiché avec ses cotes ; « plus haute » → version 2 (30 → 38 mm), liste des versions, « Imprimer cette version… ». Captures : `C:\dev\jarvis-data\atelier-nuit\live-5081-essai.png` et `live-5081-essai-3d.png`. Le dossier de pièce créé par l'essai a été retiré. **Pas essayé** : « imprime-la » (l'imprimante tournait), l'installation elle-même, les réglages « Atelier 3D » à l'écran.

## 8. Où sont les installateurs

| | Fichier | Taille |
| --- | --- | --- |
| Live 5.0.81 | `C:\dev\Jarvis\apps\desktop\release\Jarvis-Setup-5.0.81.exe` (avec `latest.yml` et `.blockmap`) | 451 Mo |
| Jarvis Test 5.1.0-test.4 | `C:\dev\Jarvis-nuit\apps\desktop\release-test\Jarvis-Test-Setup-5.1.0-test.4.exe` (avec `test.yml`) | 450 Mo |

Aucun n'est installé, aucun n'est publié. Pour publier la Live : `claude/live-5081` n'est pas fusionnée dans `main` ; `release.sh` part de `main`. À ton « publie », il faudra fusionner `claude/live-5081` dans `main`, puis lancer `bash release.sh` (qui refait ses contrôles et son propre installateur).

## 9. À essayer par toi avant de dire « publie »

1. Installer la Live 5.0.81, dire ou taper « fais-moi une boîte de 80 par 50 par 30 », la tourner à la souris, « plus haute », « rajoute un trou de 8 à l'arrière ».
2. « Je veux un boîtier pour mon raspberry pi 5 » → « ouais vas-y » → « tu peux ajouter un couvercle ».
3. Depuis l'iPhone : la même boîte, les images, « Voir en 3D ».
4. Depuis une enceinte : « fais-moi une boîte de 80 par 50 par 30 », puis « imprime-la » (il doit refuser).
5. Quand l'impression en cours sera finie : « imprime-la » sur une petite pièce, lire la carte, refuser ou accepter. C'est le seul point jamais essayé avec ta vraie imprimante depuis la Live.
6. Réglages → Ce que Jarvis sait faire → « Atelier 3D » : l'adresse de l'imprimante, la case d'envoi.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (cœur construit ; Live 5.0.81 empaquetée lancée et essayée ; installateurs de Live et de Jarvis Test fabriqués)
Types     : OK (npm run typecheck, sur claude/atelier-nuit-1126 et sur claude/live-5081)
Style     : OK (npm run lint, sur les deux branches)
Tests     : Jarvis Test : cœur 264 fichiers verts (3 338 essais), bureau 195 fichiers verts (1 054 essais), 4 fichiers ignorés comme d'habitude
            Live 5.0.81 : cœur 237 fichiers verts (3 044 essais), bureau 174 fichiers verts (926 essais), 4 fichiers ignorés comme d'habitude
            essais figés (chat-unchanged, ollama-unchanged, orchestra-session, machineProfile, profiles/jarvis) verts, aucun __golden__ régénéré
            banc des phrases en vrai : 279 sur 279 ; grand contrôle des pièces : 67 sur 67
Secrets   : OK (aucune clé ; réglages de la Live et de Jarvis Test lus et copiés dans des dossiers temporaires, effacés ; phrases écrites par Claude)
Fichiers  : packages/core/src/atelier/ (discussion, lecture, gabarits, composants, csg + essais), apps/desktop/src/main/atelier/ (tourAtelier, atelierPC, chercherCotes, banc et phrases), session.ts (note aux équipes, réponses masquées) ; pour la Live : types.ts, settings.ts, ipc.ts, preload, index.ts, session.ts, serveur du téléphone et des enceintes, écran 3D, réglages « Atelier 3D », CLAUDE.md
Prêt à fusionner : Jarvis Test : OUI, fusionné dans claude/dev. Live 5.0.81 : prête sur claude/live-5081, à fusionner dans main sur ton « publie »
Testé en vrai (à la voix, sur le PC) : PAS FAIT à la voix. FAIT au texte : 286 phrases dans la vraie session (modèle, OpenSCAD, OrcaSlicer, fausse imprimante), et la Live empaquetée pilotée dans sa vraie fenêtre (2 phrases, écran 3D vu en capture)
```
