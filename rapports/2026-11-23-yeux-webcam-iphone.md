# Les yeux de Jarvis, étape 1, points 3 et 4 : la webcam du PC et la caméra de l'iPhone (23 novembre 2026)

Cahier : `docs/specs/yeux-etape-1.md` (§ 3.2, 3.3). Branche `claude/yeux-etape-1`. Jarvis Test seulement, coupé par défaut. Pas de fusion, pas de publication. Suite de `rapports/2026-11-23-yeux-registre-klipper-ecran.md`.

## 3. La webcam du PC

**Choix (cahier § 3.2) : une fenêtre cachée dédiée**, pas un programme séparé.
- Pourquoi : aucune installation de plus chez l'utilisateur, aucune dépendance native, le même Chromium que le micro ; un programme séparé aurait demandé un outil à installer et à tenir à jour.
- Fenêtre `show: false`, `sandbox`, sans Node, **session à part** (`partition: yeux-webcam`) : la caméra y est accordée **en vidéo seulement** (jamais le micro), tout le reste y est refusé. La session par défaut, celle de la fenêtre de Jarvis, n'est pas touchée : `mediaPermissions.ts` refuse toujours la caméra (essai).
- `getUserMedia` exige un contexte sûr : `about:blank` n'en est pas un (premier essai réel : refusé en 92 ms). La page vide est servie par le schéma déjà privilégié `jarvis-oww:`, **seulement dans la session de la webcam** et seulement à l'adresse fixe `jarvis-oww://webcam/` ; politique `default-src 'none'`.
- À la demande seulement : ouverte pour une photo (ou tant que l'écran « Yeux » la montre), **fermée 5 s après la dernière photo** (flux arrêté, voyant éteint) ; coupée dans l'écran « Yeux » = fermée tout de suite. Chaque étape bornée à 5 s. Image JPEG vérifiée, 5 Mo au plus. L'identifiant de l'appareil n'entre dans le script que par `JSON.stringify`.
- Œil « Webcam du PC », **coupé par défaut**, pièce bureau ou salon (choix sur la carte ; une chambre est refusée), choix de la webcam (« Choisir la webcam »). Raisons dites : Windows refuse la caméra (Confidentialité), webcam introuvable, déjà prise par une autre appli, délai.
- « Montre-moi la webcam », « montre-moi le bureau » (la webcam allumée passe avant le hub prévu de la même pièce).

## 4. La caméra de l'iPhone

- Appli du téléphone : bouton 📷 **« Montrer à Jarvis »** (`<input type="file" accept="image/*" capture="environment">`, aucun flux continu, Jarvis ne peut jamais allumer la caméra de l'iPhone). La photo est réduite sur le téléphone (1600 px, JPEG) puis envoyée par `POST /api/oeil/photo` : jeton du téléphone exigé, `image/jpeg` ou `image/png` vérifié aux octets, 5 Mo au plus. Une question tapée dans le champ part ensuite dans la discussion.
- PC : œil « iPhone » (pièce : mobile), dernière photo **en mémoire**, 30 minutes ; œil coupé = photo refusée. « Montre-moi l'iPhone » la remet dans la discussion ; la carte iPhone de l'écran « Yeux » la montre avec son heure (pas de bandeau « figée » : c'est une photo fixe).
- Les photos de Jarvis sur le téléphone (« montre-moi l'impression » depuis l'iPhone) : l'événement est réécrit en **lien à usage unique** `/api/oeil/image/<32 hex>`, valable 2 minutes, seulement pour le téléphone qui l'a reçu, lu avec son jeton ; la référence de la photo ne part jamais. La page l'affiche en `blob:`. Politique de la page : `img-src 'self' blob:`.
- « Qu'est-ce que c'est ? » sur la photo : au point 5 (modèle de vision, à choisir au banc). Aujourd'hui la photo arrive et se voit, Jarvis ne la décrit pas encore.

## Essais

- `main/yeux/webcam.test.ts` (7) : fausse fenêtre de capture ; photo puis fermeture à 5 s, même fenêtre pour les photos suivantes, refus de Windows / webcam absente / prise / délai (fenêtre fermée à chaque fois), pas une image, identifiant piégé, liste des webcams, session de la webcam vidéo seulement, **fenêtre de Jarvis qui refuse toujours la caméra**.
- `main/phone/yeux.test.ts` (4, vrai port) : photo refusée sans jeton, pas une image, type menteur, plus de 5 Mo ; lien à usage unique (refusé sans jeton, servi une fois, puis 404), lien d'un autre téléphone refusé, lien expiré ; politique `img-src 'self' blob:`.
- `main/yeux-session.test.ts` (+1) : œil iPhone, photo en mémoire 30 min, refusée si coupé.
- Suites complètes : cœur 2898 verts ; bureau 969 verts. Lint 0. Tests figés verts sans régénération.

## Essai en vrai

- Webcam (Logitech C922 du PC), Jarvis Test de développement dans son dossier à part : une seule prise pour vérifier le chemin, **image ni regardée ni gardée** : JPEG de 144 Ko, 2,3 s pour la première image (ouverture), 15 ms pour la suivante, « coupée » juste après. Le voyant s'est allumé pendant ces quelques secondes.
- iPhone : PAS FAIT (le téléphone est relié à Jarvis Live, et la fonction « téléphone » est réservée à Live dans Test) : à essayer avec l'utilisateur.

## RAPPORT DE VÉRIFICATION

- Construction : cœur `tsc` OK ; fenêtre lancée par `electron-vite dev` (Jarvis Test).
- Types : `npm run typecheck` OK. Style : `npm run lint` 0 erreur.
- Essais : voir ci-dessus.
- Secrets : jeton du téléphone exigé pour envoyer ou lire une photo ; aucune image sur le disque sans « Garder cette photo ».
- Relecture : la fenêtre de Jarvis n'a toujours pas la caméra ; la webcam ne tourne qu'à la demande et s'arrête seule ; jamais de caméra dans une chambre ; aucune requête qui agit sur l'imprimante.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT à la voix ; webcam FAIT sur le PC (une prise, métadonnées seulement) ; iPhone PAS FAIT.
