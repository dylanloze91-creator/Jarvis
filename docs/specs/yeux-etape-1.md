# Cahier des charges : les yeux de Jarvis, étape 1 (la caméra de l'imprimante et l'écran « Yeux »)

Écrit par Claude (le chat, chef d'équipe) le 23 novembre 2026, à la demande de l'utilisateur :
« j'aimerais faire un tableau de bord lié à Jarvis, avec la caméra […] que Jarvis ait des yeux ».
Mission pour **Claude Code** (un agent « Yeux », ou l'agent Imprimante prévu par la feuille de route).

S'appuie sur :

- `docs/specs/jarvis-development.md`, section 4.1 (les yeux) et 3.7 (règles des caméras) ;
- `docs/specs/imprimante-surveillance.md` (la surveillance, dont celle-ci est la **première partie**) ;
- le cœur déjà écrit : `packages/core/src/impression/printerWatch.ts` (`webcams()`, `snapshotAddress`),
  `vision.ts`, `camera3d.ts` ; le socle des appendices (`apps/desktop/src/main/appendices/`).

## 0. En bref, pour l'utilisateur

- **Rien à acheter.** La webcam est déjà branchée sur l'ordinateur de Klipper ; Mainsail la montre.
- Jarvis **voit** par cette caméra :
  - « Jarvis, montre-moi l'impression » : la photo arrive dans la discussion (PC et téléphone) ;
  - un **écran « Yeux »** dans le tableau de bord : l'image de la caméra, l'état de l'impression
    (pourcentage, temps restant, températures, couche) et la file d'attente ;
  - « Est-ce que l'impression se passe bien ? », « Le plateau est vide ? » : Jarvis **regarde**
    la photo avec un petit modèle de vision local et répond. Il ne fait **rien** d'autre.
- Lecture seule : Jarvis ne met pas en pause, n'annule et ne lance rien dans cette étape. Ça vient
  à l'étape suivante (la surveillance, avec la prise).
- Plus tard, le **même écran** montrera les yeux du robot (caméra Pi Module 3 Wide à l'avant,
  caméra USB au poignet de la pince, dossier Rover V3.7).

## 1. Ce qui ne bouge pas

- **Jarvis Test seulement**, coupé par défaut (réglage facultatif, **sans défaut Zod** :
  `parseSettings({})` ne gagne aucune clé). Live ne change pas. Aucun `__golden__` régénéré.
- **Lecture seule sur l'imprimante.** Une impression peut tourner pendant les essais : seules des
  requêtes de lecture partent vers Moonraker et la caméra (`GET`). Aucun `POST`.
- **Règles des caméras** (cahier Jarvis Development, 3.7) :
  - image traitée sur le PC, **rien dans le cloud** ;
  - **rien d'enregistré par défaut** : l'image vit en mémoire ; une photo n'est gardée que si
    l'utilisateur le demande (« garde cette photo »), dans `userData`, jamais dans le dépôt ;
  - l'image ne part vers le téléphone que par le lien privé existant (Tailscale) ;
  - caméra injoignable : Jarvis le dit (« la caméra ne répond pas »), **jamais une vieille image**
    présentée comme actuelle (l'heure de la prise est toujours affichée) ;
  - jamais de caméra dans une chambre (pour les yeux suivants).
- La fenêtre de Jarvis **n'ouvre jamais** la webcam du PC (`mediaPermissions.ts` refuse la caméra :
  règle gardée). Les yeux passent par le réseau local, côté processus principal.
- Aucune dépendance native. Réseau local seulement (`checkRoverBaseUrl`), pas de redirection suivie,
  chaque appel borné (5 s pour une image), image de 5 Mo au plus, type `image/jpeg` ou `image/png`.

## 2. Ce qu'il faut faire

### 2.1 Le chemin de l'image (processus principal)

- Adresse de la caméra : `webcams()` de `printerWatch.ts` (liste Moonraker `/server/webcams/list`),
  puis `snapshotAddress(origine, snapshot_url)`. Plusieurs caméras : la première activée, ou celle
  choisie dans les réglages.
- `prendrePhoto()` : une image, en mémoire, avec son heure de prise et sa taille. Échec → raison en
  mots simples (caméra coupée dans Mainsail, adresse absente, délai, pas une image).
- L'adresse de Moonraker est celle déjà réglée pour l'imprimante (lot B / atelier). Rien de neuf à
  saisir si elle est réglée.

### 2.2 « Montre-moi l'impression » (règle express, sans modèle)

- Phrases : « montre-moi l'impression », « montre l'imprimante », « fais voir l'impression »,
  « montre-moi la caméra de l'imprimante », « où en est l'impression ? » (photo + état).
- Réponse : la photo dans la bulle de Jarvis + une phrase d'état lue dans Moonraker (« 42 %, il
  reste 1 h 10, buse 215 °C, plateau 60 °C »). Heure de la photo sous l'image.
- **Depuis une enceinte** : une phrase courte seulement (« 42 %, il reste 1 h 10. La photo est sur
  le PC. ») et la photo va dans la discussion du PC.
- **Téléphone** : la page du téléphone affiche aujourd'hui le texte seulement (`textContent`). Ajouter
  l'affichage d'une image servie par le PC (adresse à usage unique, jeton du téléphone exigé,
  durée de vie courte, jamais une image venant d'ailleurs). Politique de sécurité de la page à
  ajuster pour `img-src 'self'` seulement.

### 2.3 L'écran « Yeux » du tableau de bord

- Une entrée « Yeux » dans le tableau de bord (fenêtre large), cachée si aucune caméra n'est réglée.
- Une carte par œil. Aujourd'hui une seule : **Imprimante**.
  - L'image, rafraîchie toutes les 2 s **seulement pendant que l'écran est ouvert et visible**
    (arrêt quand on change d'écran ou que la fenêtre est cachée). Heure de l'image affichée ;
    plus de 10 s sans nouvelle image : bandeau « image figée ».
  - L'état : en cours / en pause / terminé / en attente ; pourcentage, temps restant, couche,
    températures (buse, plateau) ; nom du fichier.
  - La file d'attente de Moonraker (lecture seule ici).
  - Boutons : « Photo dans la discussion », « Garder cette photo ». **Aucun bouton qui agit sur
    l'imprimante** dans cette étape.
- Prévu pour d'autres yeux : la carte prend un nom, une adresse d'image et un état ; le robot
  (`robot/oeil/` sur le Pi, cahier Jarvis Development 4.1) s'y ajoutera sans changer l'écran.
- Aperçu hors Electron : scène `?scene=yeux` avec une fausse caméra.

### 2.4 « Est-ce que l'impression se passe bien ? » (à la demande, modèle de vision local)

- Phrases : « est-ce que l'impression se passe bien ? », « le plateau est vide ? », « qu'est-ce que
  tu vois sur l'imprimante ? ».
- D'abord les **règles sans modèle** : imprimante en erreur, température qui s'écarte de sa
  consigne, image noire ou figée → réponse directe.
- Ensuite seulement un **petit modèle de vision local** dans Ollama, à choisir **au banc** sur le PC
  de l'utilisateur (candidats à mesurer : `qwen2.5vl:3b`, `gemma3:4b` ; vérifier qu'ils existent dans
  la bibliothèque Ollama et qu'ils tiennent sur la RTX 2060 avec la manœuvre « décharger le modèle
  du chat, regarder, le recharger » du module images). Rien n'est téléchargé sans accord.
- La réponse dit ce qui est vu **et** son doute (« je crois que… »). Elle n'est jamais une raison
  d'agir dans cette étape.
- Banc de mesure : un dossier de photos de l'utilisateur (réussies, ratées, plateau vide, plateau
  occupé), **sur son PC seulement**, pour compter les bonnes réponses et les fausses alertes. Le
  rapport donne seulement les chiffres.

## 3. Essais

- Fausse caméra (HTTP local qui sert une image dessinée par le test) et faux Moonraker qui l'annonce.
- Image trop grosse, pas une image, délai, redirection, adresse hors réseau local : refusés et dits.
- L'écran « Yeux » arrête de demander des images quand il n'est plus visible.
- Enceinte : phrase courte, jamais d'image envoyée à l'enceinte.
- Téléphone : image servie seulement avec le jeton, adresse qui expire.
- Aucune requête `POST` vers l'imprimante dans tout le chemin (test qui l'interdit).
- Tests figés verts sans régénération.

## 4. Ordre

1. Chemin de l'image + « montre-moi l'impression » sur le PC (essai en vrai possible **pendant**
   une impression : lecture seule).
2. Écran « Yeux ».
3. Téléphone.
4. Banc du modèle de vision, puis « est-ce que ça se passe bien ? ».

Chaque point : rapport court (`rapports/`), ligne dans `AGENTS-COORDINATION.md`,
« Testé en vrai : FAIT / PAS FAIT ».

## 5. Après cette étape

- La surveillance complète (`imprimante-surveillance.md`) : pause, alerte, annulation, prise.
- Les yeux du robot : caméra Pi Module 3 Wide à l'avant et caméra USB au poignet (dossier Rover V3.7),
  programme `robot/oeil/` sur le Pi, même carte dans l'écran « Yeux ».
- L'œil de pièce (idée en attente) et le Holo desk (piloter l'atelier avec les mains) restent dans
  les idées en attente.
