# L'atelier 3D branché dans Jarvis Test (23 novembre 2026)

Écrit par Claude Code (agent Atelier), branche `claude/atelier-3d`. Suite de `rapports/2026-11-19-atelier-3d-coeur.md` (section 2) et de `rapports/2026-11-23-atelier-ecran-3d.md`. **Pas de fusion dans `claude/dev` (l'agent Corrections fusionne), pas de publication, aucune impression lancée.** `claude/dev` a été fusionné dans la branche (conflits du registre et de CLAUDE.md : les deux côtés gardés).

## 1. Ce qui a été fait

| Étape | Résultat |
| --- | --- |
| OpenSCAD 2021.01 (installé par winget à la demande de l'utilisateur) | 10 pièces par défaut et 14 variantes : **24 sur 24** fermées et aux cotes de `taille()`, contrôlées par `controlerStl(lireStl(…), piece.taille)` (`npm run atelier:rendre --workspace @jarvis/core`). |
| Gabarit corrigé | `support_telephone` : hauteur annoncée 4 mm trop haute (77,9 mesurés), et longueur fausse quand le dossier dépasse la base. `taille()` suit maintenant la géométrie du `.scad` ; essai avec les cotes mesurées sur les STL. |
| Images | `--render` : l'aperçu cadrait aussi le cube de découpe (support minuscule dans un coin). |
| OrcaSlicer 2.4.2 | Tranchage en ligne de commande avec les copies aplaties des préréglages de l'utilisateur (lus, jamais modifiés). À l'essai, `OrcaSlicer.conf` finissait par `# MD5 checksum …` après le JSON : lecture corrigée, avec son essai. |
| Branchement (rapport du 19, section 2, points 4 et 5) | Voir la section 2. |

## 2. Le déroulé dans la discussion (Jarvis Test seulement)

- **Cœur, sans modèle** (`packages/core/src/atelier/discussion.ts`, `deciderAtelier`) : « fais-moi / imprime-moi / dessine-moi / il me faut un … » avec une pièce de la bibliothèque ; une pièce inconnue est dite, jamais devinée (« dessine-moi un chat » reste une image). Questions une à la fois avec une proposition ; une phrase sans rapport n'est pas une réponse. Versions : « plus haute », « hauteur 45 », « trou plus gros », « moins large » ; l'ancienne version reste. « imprime-la », « imprime la version 2 », « imprime la boîte ». « reviens à la version 1 ».
- **L'état vit dans la discussion** : `ChatMessage.atelier` (question en cours, ou pièce avec ses versions). Rien en mémoire dans le processus principal ; une discussion rouverte depuis l'historique réaffiche l'écran 3D.
- **PC** (`apps/desktop/src/main/atelier/tourAtelier.ts`, `atelierPC.ts`) : pièces dans `C:\dev\jarvis-data\atelier\<pièce>-<jour>-<n>\v<N>.scad|stl|png`. Limite = surface du préréglage OrcaSlicer (250 aujourd'hui ; 250 aussi si le préréglage ne se lit pas, décision de l'utilisateur).
- **Session** (`session.ts`, dépendance `atelier`) : avant l'imprimante du lot B et tout modèle ; bulle « OpenSCAD dessine la pièce… » / « OrcaSlicer prépare le fichier… » ; événement `atelier` vers la fenêtre.
- **Fenêtre** : `AtelierDiscussion` affiche `AtelierEcran` sous la réponse ; les STL arrivent par l'IPC `atelier:fichier` (nom simple, dans un dossier de pièce, sous le dossier de l'atelier, `.stl`/`.png` seulement). « Imprimer cette version… » envoie « Imprime la version N » dans la discussion.
- **Imprimer** : jamais depuis une enceinte ; STL recontrôlé ; tranché ; imprimante non réglée = « le fichier est prêt, je n'envoie rien » ; imprimante en cours d'impression ou en pause = rien envoyé, pas de carte ; sinon **carte** « Lancer l'impression de « boîte », version 1. Environ 17 min et 4,3 g de filament (1,40 m). Plaque : …, lit … °C, buse … °C, filament …. Vérifie que le plateau est vide. » ; envoi Moonraker seulement après « oui » ; « lancée » seulement si l'imprimante dit `printing`.
- **Jarvis Live** : `edition.atelier` absent, la dépendance n'est pas passée, rien ne change (essai `atelier-session.test.ts`).

## 3. Essai sur le PC (Jarvis Test de développement, dossier de données à part)

Jarvis Test installé n'a pas été touché : l'essai tourne dans un dossier à part (script de lancement hors du dépôt qui redirige `appData`), sans imprimante réglée, piloté par le port de débogage.

- « Fais-moi une boîte de 80 par 50 par 30 » → pièce rendue, « fermée et aux bonnes mesures », plateau de 250 dessiné. **Souris** : glisser = rotation, molette = zoom, cotes qui suivent (80, 50, 30 mm).
- « plus haute » → version 2 (30 → 38 mm), liste des versions, retour à la version 1 par un clic.
- « Jarvis, fais-moi un support de téléphone » → « Inclinaison : je propose 60°… » → « oui » → 90 × 80 × 77,9 mm.
- « Imprime-la » → OrcaSlicer réel avec les préréglages de l'utilisateur : **environ 2 h 03, 48,2 g de PETG, Cool Plate, lit 60 °C, buse 245 °C** ; imprimante non réglée dans ce Jarvis d'essai : rien envoyé.
- Historique : discussion rouverte, écrans 3D réaffichés.
- **Pas essayé** : la carte de confirmation et l'envoi à Moonraker en vrai (impression en cours chez l'utilisateur, lecture seule demandée) ; couverts par les essais automatiques (faux Moonraker : carte, refus, impression en cours, enceinte).

## 4. Décisions de l'utilisateur (23 novembre, soir)

1. **Plaque : Textured PEI.** L'atelier tranche avec `--curr-bed-type "Textured PEI Plate"` (`PLAQUE_ORCA`, `atelierPC.ts`). Vérifié en vrai : `; curr_bed_type = Textured PEI Plate`, `PRINT_START EXTRUDER=245 BED=80`.
2. **Plateau 300 × 300 × 300** (Klipper : X 316, Y 304, Z 300). À sa demande, le préréglage OrcaSlicer « MyKlipper 0.4 nozzle - Copie » a reçu `printable_area` 300 × 300 et `printable_height` 300 (le reste du fichier inchangé). Copie de l'ancien (`.json` et `.info`) : `C:\dev\jarvis-data\atelier\_sauvegardes\orca-2026-11-23\`. Vérifié : l'atelier lit 300 × 300 × 300, une boîte de 290 mm est acceptée (refusée à 250).
3. **Imprimante** : une impression tourne ; rien n'est touché. `[exclude_object]` était déjà dans `printer.cfg`, ajouté par l'utilisateur lui-même : Jarvis n'a rien à y écrire. Vérifié en lecture seule (`GET /printer/objects/query?exclude_object`, 23 novembre au soir) : Klipper l'a chargé, l'objet `exclude_object` répond et liste déjà l'objet de l'impression en cours (`BAC_ARD.STL_ID_0_COPY_0`). Aucun redémarrage de Klipper nécessaire. Reste, au « impression finie » de l'utilisateur : l'adresse `http://mainsailos.local` dans Jarvis Test.

## 4 bis. File d'attente (23 novembre, soir)

Demande de l'utilisateur : « mets-la dans la file », et « imprime-la » quand l'imprimante est occupée.

- **Déroulé** (`tourAtelier.ts`, `mettreEnFile`) : STL recontrôlé, tranché ; réglages de la file lus (`GET /server/config`) ; **refus avant la carte** si `[job_queue]` manque, ou si `automatic_transition` ou `load_on_startup` est vrai (Jarvis ne les change jamais) ; carte « Ajouter à la file d'attente « boîte », version 1. … Rien ne sera lancé » (précédée de « L'imprimante est occupée. » pour « imprime-la ») ; envoi avec `print=false` sous un nom libre (jamais le fichier en cours) ; `POST /server/job_queue/job` ; **file relue** : le fichier doit y être et la file en pause, sinon c'est dit.
- **Jamais l'impression en cours touchée** : aucun appel `/printer/*` pendant l'ajout. Une file laissée « ready » est mise en pause avant l'envoi (la pause de la file n'agit pas sur l'impression, vérifié dans `job_queue.py` de Moonraker). `job_queue/start` n'est jamais appelé.
- **Relancer** : seulement « le plateau est vide, lance la suivante » (la phrase doit dire que le plateau est vide), imprimante libre, après une carte ; la première pièce est lancée directement (`/printer/print/start`) puis retirée de la file, qui reste en pause. Jamais depuis une enceinte.
- **Moonraker relu dans son code** (`moonraker/components/job_queue.py`) : un ajout ne lance jamais rien ; la pièce suivante ne part seule que si `automatic_transition` est vrai et la file « ready », ou au redémarrage de Klipper si `load_on_startup` est vrai.
- **Imprimante de l'utilisateur, lecture seule** (`GET` seulement, impression en cours) : `[job_queue]` présent, `automatic_transition: false`, `load_on_startup: false`, file vide et en pause.
- Essais : faux Moonraker du cœur (`fakeMoonraker.testkit.ts`) qui suit `job_queue.py` (ajout, refus d'un fichier absent, passage automatique, démarrage de Klipper), avec le vrai client Moonraker ; `moonraker.test.ts` (2), `discussion.test.ts` (3), `tourAtelier.test.ts` (6, dont « impression déjà en cours » remplacé). **Essayé sur la vraie imprimante** (accord de l'utilisateur, 23 novembre au soir, pendant son impression de 8 h 32) : Jarvis Test d'essai réglé sur `http://mainsailos.local` ; « Fais-moi une boîte de 40 par 30 par 15 » puis « Mets-la dans la file » → tranchée (environ 20 min 42 s, 6,8 g), carte validée par l'utilisateur dans la fenêtre, réponse « « boîte », version 1, est dans la file d'attente : boite-2026-11-23-5-v1.gcode. Rien n'est lancé, la file reste en pause. » Relu ensuite sur Moonraker : `queued_jobs` = `boite-2026-11-23-5-v1.gcode`, `queue_state` = `paused` ; l'impression en cours toujours `printing`, même fichier. « Le plateau est vide, lance la suivante » n'a pas été essayé en vrai (impression en cours).

## 5. Hors de l'atelier, à signaler

- `npm run build` et `package:win:test` s'arrêtent sur l'empreinte de la voix Piper Siwis (Hugging Face rend `b1d946fd…`, attendu `641d1ab0…`) : l'installateur de Test ne se construit pas tant que ce n'est pas réglé (agent Corrections).
- `Vue3D.tsx` : une ligne `eslint-disable` visait une règle non chargée, `npm run lint` échouait ; ligne retirée.

## RAPPORT DE VÉRIFICATION

- Construction : cœur `tsc` OK ; fenêtre construite et lancée par `electron-vite dev` (Jarvis Test). `npm run build` complet : bloqué par l'empreinte Piper (section 5), sans rapport avec l'atelier.
- Types : `npm run typecheck` 0 erreur.
- Style : `npm run lint` 0 erreur.
- Tests : `npm test` complet vert, cœur 2 842 sur 2 842, bureau 944 (8 ignorés, comme avant), Ollama réservé pendant le passage ; essais figés (`chat-unchanged`, `orchestra-session`) verts sans régénération. Nouveaux : `discussion.test.ts` (19), `tourAtelier.test.ts` (9), `atelier-session.test.ts` (2), essai du support et de `OrcaSlicer.conf`.
- Secrets : aucun ; aucune clé lue ni écrite ; les préréglages OrcaSlicer de l'utilisateur seulement lus.
- Relecture : chemins de la fenêtre bornés (nom simple, `.stl`/`.png`, dossier de l'atelier) ; aucune impression sans carte ; jamais depuis une enceinte ; Live inchangé.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT à la voix ; FAIT au clavier et à la souris sur le PC (Jarvis Test de développement, section 3), sans envoi à l'imprimante.
