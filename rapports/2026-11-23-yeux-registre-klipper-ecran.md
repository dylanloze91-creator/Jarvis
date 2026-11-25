# Les yeux de Jarvis, étape 1, points 1 et 2 : registre des yeux, caméra de Klipper, « montre-moi l'impression », écran « Yeux » (23 novembre 2026)

Cahier : `docs/specs/yeux-etape-1.md` (version élargie du 23 novembre au soir : toutes les caméras). Branche `claude/yeux-etape-1`. Jarvis Test seulement, coupé par défaut. Pas de fusion, pas de publication. **Lecture seule sur l'imprimante** : une impression tournait pendant tout le travail, seules des requêtes GET sont parties.

## 1. Registre des yeux, contrat commun, faux œil (cœur)

- `packages/core/src/yeux/contrat.ts` : un œil = id, nom, pièce, genre (`klipper`, `pc`, `telephone`, `reseau`), allumé/coupé, adresse ou caméra choisie. `verifierOeil` refuse un œil incomplet, une adresse hors réseau local et **toute chambre** (pièce ou nom : « chambre », « chambre d'amis », « ma chambre » ; « antichambre » passe). Une seule opération : `prendrePhotoOeil(œil)` → image en mémoire, heure, taille, ou une raison en mots simples (coupée, pas encore branché, délai, pas une image, clé refusée…).
- Contrat `reseau` (rover, hub, toute petite caméra) : `OeilReseau`, deux `GET` seulement, `/api/oeil/hello` (nom, version) et `/api/oeil/photo` (jeton Bearer). Yeux prévus présents dès le départ : Rover avant, Rover pince, Hub, « pas encore branché » tant que leur adresse n'est pas réglée.
- Faux œil `fakeOeil.testkit.ts` : un `fetch` qui suit le contrat (image, muet, 503, HTML, redirection, mauvais jeton) et compte les prises (témoin).
- Lecture de l'image partagée (`lireImage`) : `lectureSeule` (seul GET part, le reste est refusé avant l'appel), aucune redirection, 5 s, 5 Mo lus par morceaux, JPEG/PNG vérifié aux octets.

## 2. Caméra de Klipper et « montre-moi … »

- `YeuxImprimante` : caméras (`/server/webcams/list`), photo, état (couches si Klipper les connaît), file d'attente (`/server/job_queue/status`).
- Règle express sans modèle : « montre-moi l'impression / l'imprimante / la caméra de l'imprimante », « où en est l'impression ? », et pour tout œil « montre-moi le bureau », « montre-moi la caméra du rover avant », « montre-moi l'iPhone ». Une phrase qui ne nomme aucun œil connu continue son chemin (« montre-moi une photo de chat »).
- Fenêtre : « 87 %, il reste 1 h 24, buse 255 °C, plateau 80 °C. Photo prise à 22 h 01 min 25 s. » et la photo sous la réponse. Enceinte : « 87 %, il reste 1 h 24. La photo est sur le PC. » (jamais d'image vers l'enceinte). Caméra coupée : « Pas de photo : la caméra « Imprimante » est coupée. »
- PC : registre `userData/yeux.json` (hors `settings.json`, écriture sûre, entrée illisible ou dans une chambre écartée), jeton d'une caméra réseau scellé par `safeStorage` (sans chiffrement : en mémoire seulement, jamais en clair sur le disque). Photos en mémoire (20, 30 min) ; la discussion ne garde que la référence (`ChatMessage.yeux`), jamais l'image. « Garder cette photo » = seule écriture, dans `userData/yeux/photos/`.
- Réglage `yeux: { enabled?, camera? }`, sans défaut Zod ; case dans Réglages → Services → Imprimante 3D (Jarvis Test seulement).

## 3. Écran « Yeux »

- Entrée « Yeux » dans la barre du tableau de bord, visible quand les yeux sont activés. Une carte par œil : nom, genre, pièce, interrupteur allumée/coupée (coupée = plus aucune prise et plus jamais l'ancienne image), témoin « regarde » pendant les prises, heure de l'image, bandeau « image figée » après 10 s, « Photo dans la discussion », « Garder cette photo ». Aucun bouton qui agit sur un appareil.
- Carte de l'imprimante : état, avancement, reste, couche, buse, plateau, fichier, file d'attente (lecture seule).
- Rover et hub : « pas encore branché », champ adresse + jeton et « Brancher » (le `hello` doit répondre avant que l'œil soit gardé).
- Rafraîchissement (`rafraichir.ts`) : toutes les 2 s, seulement écran ouvert, fenêtre visible et œil allumé ; jamais deux demandes à la fois ; arrêt au changement d'écran.
- Aperçu hors Electron : `?scene=yeux` (faux yeux, images dessinées).
- Les cartes iPhone et webcam du PC viennent aux points 3 et 4.

## Essais

- Cœur : `yeux/yeux.test.ts` + `yeux/contrat.test.ts` (32) — fausse caméra Klipper et faux Moonraker HTTP locaux, faux œil réseau, chaque refus du cahier (trop gros, pas une image, délai, redirection, hors réseau local, chambre, œil coupé, mauvais jeton), aucune requête autre que GET sur tout le chemin.
- PC : `main/yeux-session.test.ts` (9, vraie session) et `components/yeux/rafraichir.test.ts` (4, arrêt quand l'écran n'est plus visible).
- Suites complètes : cœur 2898 verts ; bureau 956 verts, 1 rouge sous charge (`platformerMissionPath.test.ts`, sans rapport, vert seul). Tests figés verts sans régénération. Lint : 0 erreur.

## Essai en vrai

Jarvis Test de développement dans un dossier de données à part (le Jarvis Test installé n'est pas touché ; fournisseur de démonstration, aucun modèle), imprimante `http://mainsailos.local` pendant une impression PETG (82 à 87 %) : « Jarvis, montre-moi l'impression » et « Montre-moi la caméra de l'imprimante » → état + vraie photo dans la discussion ; écran « Yeux » → vraie image rafraîchie, état, file d'attente. Seules des requêtes GET sont parties.

## RAPPORT DE VÉRIFICATION

- Construction : cœur `tsc` OK ; fenêtre construite et lancée par `electron-vite dev` (Jarvis Test).
- Types : `npm run typecheck` (bureau) OK.
- Style : `npm run lint` 0 erreur.
- Essais : voir ci-dessus.
- Secrets : jeton d'une caméra réseau scellé, jamais en clair sur le disque (essai) ; la clé Moonraker n'est envoyée qu'à Moonraker.
- Relecture : aucune requête autre que GET possible vers l'imprimante ni vers une caméra ; image jamais dans l'historique ; jamais de caméra dans une chambre.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT à la voix ; FAIT au clavier et à la souris sur le PC (Jarvis Test de développement), avec la vraie caméra pendant une impression.
