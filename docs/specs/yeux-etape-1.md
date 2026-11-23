# Cahier des charges : les yeux de Jarvis, étape 1 (toutes ses caméras, et l'écran « Yeux »)

Écrit par Claude (le chat, chef d'équipe) le 23 novembre 2026, à la demande de l'utilisateur :
« j'aimerais faire un tableau de bord lié à Jarvis, avec la caméra […] que Jarvis ait des yeux »,
précisé le même soir : **pas seulement la caméra de l'imprimante**. Les yeux voulus : la caméra de
Klipper, la webcam du PC (bureau ou salon), la caméra de l'iPhone, les caméras du rover, la caméra du
futur hub (boîtier à écran tactile).

Mission pour **Claude Code** (agent « Yeux »).

S'appuie sur :

- `docs/specs/jarvis-development.md`, section 4.1 (les yeux) et 3.7 (règles des caméras) ;
- `docs/specs/imprimante-surveillance.md` (la surveillance de l'imprimante, qui viendra après) ;
- le cœur déjà écrit : `packages/core/src/impression/printerWatch.ts` (`webcams()`, `snapshotAddress`),
  le socle des appendices (`apps/desktop/src/main/appendices/` : registre, contrat, faux appendice) ;
- le téléphone (`apps/desktop/src/main/phone/`) et l'enceinte (`apps/desktop/src/main/speaker/`).

## 0. En bref, pour l'utilisateur

- Jarvis a **plusieurs yeux**, tous rangés au même endroit, et un **écran « Yeux »** dans le tableau
  de bord qui les montre tous.
- Dans cette étape :
  1. **la caméra de l'imprimante** (déjà branchée sur Klipper, rien à acheter) ;
  2. **la webcam du PC** ;
  3. **la caméra de l'iPhone** : tu prends une photo dans l'appli Jarvis du téléphone et tu
     demandes « qu'est-ce que c'est ? » ;
  4. **les yeux du rover et du hub** sont **prévus mais pas branchés** (le matériel n'est pas prêt) :
     leur place est faite, un faux œil sert aux essais, et ils s'ajouteront sans changer l'écran.
- Ce qu'on dit à Jarvis :
  - « montre-moi l'impression », « montre-moi le bureau » : la photo dans la discussion ;
  - « qu'est-ce que tu vois ? », « est-ce que l'impression se passe bien ? », « le plateau est
    vide ? » : Jarvis **regarde** avec un petit modèle de vision local et répond, avec son doute.
- **Jarvis regarde seulement.** Il ne met rien en pause, n'annule rien, ne lance rien. Agir viendra
  avec la surveillance de l'imprimante.
- Rien n'est enregistré, rien ne part sur Internet.

## 1. Ce qui ne bouge pas

- **Jarvis Test seulement**, coupé par défaut (réglages facultatifs, **sans défaut Zod** :
  `parseSettings({})` ne gagne aucune clé). Live ne change pas. Aucun `__golden__` régénéré.
- **Lecture seule sur l'imprimante** (une impression peut tourner pendant les essais) : seulement des
  `GET` vers Moonraker et la caméra. Un test l'impose.
- **Règles des caméras** (cahier Jarvis Development, 3.7) :
  - image traitée sur le PC, **rien dans le cloud** ;
  - **rien d'enregistré par défaut** : l'image vit en mémoire ; une photo n'est gardée que si
    l'utilisateur le demande (« garde cette photo »), dans `userData`, jamais dans le dépôt ;
  - **jamais de caméra dans une chambre** : chaque œil porte le nom de sa pièce ; « chambre » est
    refusé à l'ajout ;
  - un **témoin visible** quand une caméra regarde (voir chaque œil) ;
  - une caméra se **coupe** d'un geste (interrupteur par œil dans l'écran « Yeux », et le matériel) ;
    Jarvis dit alors « la caméra est coupée », **jamais une vieille image** présentée comme actuelle
    (l'heure de la prise est toujours affichée) ;
  - l'image ne part vers le téléphone que par le lien privé existant (Tailscale).
- Aucune dépendance native. Réseau local seulement (`checkRoverBaseUrl`), pas de redirection suivie,
  chaque prise bornée (5 s), image de 5 Mo au plus, `image/jpeg` ou `image/png`.

## 2. Le contrat d'un œil (le même pour tous)

Un œil, dans le registre des yeux (à côté du registre des appendices, même style d'état sûr) :

| Champ | Exemple |
| --- | --- |
| nom | « Imprimante », « Bureau », « iPhone », « Rover avant », « Rover pince », « Hub » |
| pièce | atelier, bureau, salon… (« chambre » refusé) |
| genre | `klipper`, `pc`, `telephone`, `reseau` (rover, hub, et toute caméra qui suit le contrat) |
| coupé / allumé | coupé par défaut pour la webcam du PC |

Une seule opération pour tous : **`prendrePhoto(œil)`** → image en mémoire, heure de prise, taille ;
ou une raison en mots simples (coupée, injoignable, délai, pas une image).

- **`klipper`** : adresse lue par `webcams()` (`/server/webcams/list`) puis `snapshotAddress`.
- **`pc`** : la webcam du PC, voir 3.2.
- **`telephone`** : pas de prise à distance. L'œil reçoit la photo que l'utilisateur envoie depuis
  l'appli du téléphone (voir 3.3). Jarvis ne peut jamais allumer la caméra de l'iPhone tout seul.
- **`reseau`** : contrat HTTP des appendices, pour le rover (`robot/oeil/` sur le Pi), le hub et
  toute petite caméra Wi-Fi qu'on construira : `GET /api/oeil/hello` (nom, version), `GET
  /api/oeil/photo` (une image, jeton Bearer), rien d'autre. **Pas de flux continu.** Le témoin
  lumineux est sur l'appareil, commandé par son programme. Un **faux œil** (`fakeOeil.testkit.ts`)
  suit ce contrat pour les essais ; le programme du rover et du hub sera écrit avec leur matériel.

## 3. Ce qu'il faut faire

### 3.1 La caméra de l'imprimante

Adresse de Moonraker déjà réglée pour l'imprimante (atelier). Plusieurs caméras sur Klipper : la
première activée, ou celle choisie.

### 3.2 La webcam du PC

- La fenêtre principale de Jarvis **continue de refuser la caméra** (`mediaPermissions.ts`) : règle
  gardée.
- La prise passe par un moyen **séparé et à la demande seulement**, au choix de l'agent, justifié
  dans le rapport :
  - une **fenêtre cachée dédiée** à la capture (seule autorisée à la caméra, ouverte pour une photo
    puis fermée, choix de l'appareil par son identifiant) ;
  - ou un programme séparé déjà installé par l'utilisateur (jamais lié à l'application).
- Le voyant de la webcam s'allume pendant la prise ; l'écran « Yeux » montre « la webcam regarde ».
  Pas de flux continu en dehors de l'écran « Yeux » ouvert.
- Coupée par défaut. L'allumer = un interrupteur dans l'écran « Yeux » (pièce : bureau ou salon).

### 3.3 La caméra de l'iPhone

- Dans l'appli du téléphone (page servie par le PC, Tailscale), un bouton **« Montrer à Jarvis »**
  ouvre l'appareil photo de l'iPhone (champ fichier `accept="image/*"` avec `capture`, sans flux
  continu), et envoie la photo avec la question tapée ou dite.
- Envoi : `POST` avec le jeton du téléphone, 5 Mo au plus, image seulement. La photo vit en mémoire
  le temps de la réponse, sauf « garde cette photo ».
- La page peut aussi **afficher** une photo envoyée par Jarvis (« montre-moi l'impression » depuis
  le téléphone) : adresse à usage unique, jeton exigé, durée de vie courte. Politique de sécurité de
  la page : `img-src 'self' blob:` seulement.

### 3.4 Les phrases (règle express d'abord, sans modèle)

- « montre-moi l'impression / l'imprimante », « montre-moi le bureau », « montre-moi la caméra de
  … » : la photo de cet œil dans la discussion + l'état de l'impression pour l'œil de l'imprimante
  (« 42 %, il reste 1 h 10, buse 215 °C, plateau 60 °C »).
- « qu'est-ce que tu vois ? » sans œil nommé : l'œil le plus récent utilisé, sinon la question
  « Avec quelle caméra ? » et la liste des yeux allumés.
- **Depuis une enceinte** : une phrase courte seulement (« La photo est sur le PC »), jamais d'image
  envoyée à l'enceinte.

### 3.5 L'écran « Yeux » du tableau de bord

- Une entrée « Yeux » dans le tableau de bord (fenêtre large), visible dès qu'un œil existe.
- **Une carte par œil** : image, nom, pièce, heure de l'image, interrupteur coupé / allumé, boutons
  « Photo dans la discussion » et « Garder cette photo ». **Aucun bouton qui agit sur un appareil.**
- Image rafraîchie toutes les 2 s **seulement pendant que l'écran est ouvert et visible**, et
  seulement pour les yeux allumés ; arrêt quand on change d'écran ou que la fenêtre est cachée.
  Plus de 10 s sans nouvelle image : bandeau « image figée ».
- Carte de l'imprimante : en plus, l'état (en cours / en pause / terminé), pourcentage, temps
  restant, couche, températures, nom du fichier, et la file d'attente (lecture seule).
- Carte de l'iPhone : la dernière photo envoyée, avec son heure, tant qu'elle est en mémoire.
- Cartes du rover et du hub : « pas encore branché » tant que leur adresse n'est pas réglée.
- Aperçu hors Electron : scène `?scene=yeux` avec des faux yeux.

### 3.6 « Qu'est-ce que tu vois ? » (à la demande, modèle de vision local)

- D'abord les **règles sans modèle** : caméra coupée, image noire ou figée ; pour l'imprimante,
  erreur de Klipper ou température qui s'écarte → réponse directe.
- Ensuite un **petit modèle de vision local** dans Ollama, à choisir **au banc** sur le PC de
  l'utilisateur. Candidats à mesurer : `qwen2.5vl:3b`, `gemma3:4b` (vérifier qu'ils existent dans la
  bibliothèque Ollama et qu'ils tiennent sur la RTX 2060 avec la manœuvre « décharger le modèle du
  chat, regarder, le recharger » du module images). Rien n'est téléchargé sans accord.
- La réponse dit ce qui est vu **et** son doute. Elle n'est jamais une raison d'agir.
- Banc de mesure : un dossier de photos de l'utilisateur, **sur son PC seulement** ; le rapport donne
  seulement les chiffres.

## 4. Essais

- Faux yeux pour les quatre genres (fausse caméra Klipper et faux Moonraker, fausse webcam, photo
  du téléphone, faux œil réseau).
- Refusés et dits : image trop grosse, pas une image, délai, redirection, adresse hors réseau local,
  pièce « chambre », œil coupé.
- L'écran « Yeux » arrête de demander des images quand il n'est plus visible.
- La fenêtre principale refuse toujours la caméra.
- Enceinte : phrase courte, jamais d'image.
- Téléphone : photo acceptée seulement avec le jeton ; image servie avec une adresse qui expire.
- Aucune requête qui agit sur l'imprimante dans tout le chemin.
- Tests figés verts sans régénération.

## 5. Ordre

1. Registre des yeux + contrat + faux œil ; caméra de l'imprimante ; « montre-moi l'impression »
   (essai en vrai possible **pendant** une impression).
2. Écran « Yeux ».
3. Webcam du PC.
4. Caméra de l'iPhone (envoi d'une photo, et affichage des photos de Jarvis).
5. Banc du modèle de vision, puis « qu'est-ce que tu vois ? ».

Chaque point : rapport court (`rapports/`), ligne dans `AGENTS-COORDINATION.md`,
« Testé en vrai : FAIT / PAS FAIT ».

## 6. Après cette étape

- Les yeux du rover : programme `robot/oeil/` sur le Pi (caméra Pi Module 3 Wide à l'avant, caméra
  USB au poignet, dossier Rover V3.7), même contrat `reseau`.
- La caméra du hub : même contrat, avec le programme du hub.
- La surveillance complète de l'imprimante (`imprimante-surveillance.md`).
- Le Holo desk (piloter l'atelier avec les mains devant la webcam du PC) reste dans les idées en
  attente ; il réutilisera l'œil du PC.
