# Cahier des charges — L'enceinte, oreilles et bouche de Jarvis ; le PC, ses yeux

Rédigé par Claude pour Cursor, le 10 novembre 2026. Lire `CLAUDE.md` (5.0.64 « Enceinte Jarvis », 5.0.62 suivi de discussion, 5.0.71 Jarvis Imager, Spotify), `docs/specs/enceinte-jarvis.md` et `docs/specs/regles-communes-lots.md` (branche `claude/specs-feuille-de-route`).

## Ce que veut l'utilisateur

« Il faut que l'enceinte connectée soit vraiment les oreilles et la bouche de Jarvis. Quand je lui demande de générer une image, qu'il la génère sur le PC. Quand c'est un produit, qu'il la génère sur le PC. Et quand je lui demande de mettre un truc sur Spotify, qu'il me demande : la Devialet ou le PC ? »

Principe : **l'enceinte écoute et parle ; tout le travail et tout ce qui se regarde se passent sur le PC.** L'enceinte (ESP32-S3, pont `apps/desktop/src/main/speaker/`) n'affiche rien : Jarvis y dit une phrase courte et montre le reste sur l'écran du PC.

## 1. Ce qui se regarde va sur l'écran du PC

Quand un tour venu d'une enceinte produit quelque chose à voir — image générée par Jarvis Imager (`generer_image`, rendu produit compris), carte de mission, liste ou tableau long, code, sources, document —

- la fenêtre de Jarvis sur le PC s'affiche (sans la mettre au premier plan si l'utilisateur tape ailleurs : `showInactive`) sur **la discussion de cette enceinte** (« Salon · … »), avec le résultat ; une image est aussi ouverte selon le réglage existant `openAfterGeneration` ;
- l'enceinte dit une phrase courte et vraie : « C'est fait, l'image est sur l'écran du PC. », « Je t'ai mis la liste sur le PC. » ; pour une longue réponse écrite, elle lit 2 ou 3 phrases puis « le détail est sur le PC » ;
- si le téléphone est relié, la même discussion y est disponible (historique du PC, rien de nouveau à construire) ;
- génération d'image : elle tourne sur le PC comme d'habitude (Forge + SDXL) ; pendant le calcul l'enceinte dit « Je la prépare sur le PC, ça prend environ une minute » (durée estimée par Imager si elle existe, sinon cette phrase), puis la phrase de fin quand l'image est prête — **sans bloquer l'enceinte** : la requête de l'enceinte reçoit d'abord la phrase d'attente, et la phrase de fin est rendue au tour suivant ou annoncée par l'indicateur de l'enceinte s'il existe ; à défaut d'un canal de notification vers l'enceinte, la phrase de fin s'affiche sur le PC seulement (le dire dans le rapport) ;
- rien ne change pour un tour tapé ou dit au PC.

Les règles de sécurité des enceintes ne changent pas : une carte de confirmation reste refusée d'office depuis l'enceinte (`SPEAKER_CONFIRMATION_REFUSAL`), une mission n'est jamais lancée depuis l'enceinte (`SPEAKER_MISSION_PROPOSAL`) ; `generer_image` est `safe`, donc autorisé.

## 2. Spotify : « Sur la Devialet ou sur le PC ? »

À faire **sur la branche `cursor/spotify-voix-appareil`** (choix de l'appareil à la voix, relue et approuvée, pas encore fusionnée), qui devient la base de cette partie.

- Nouveau réglage facultatif, sans défaut Zod : `spotifyAskDevice` (Réglages → Services → Musique : « Me demander où jouer la musique »). Absent ou faux : comportement de la branche (appareil du réglage `spotifyDeviceName`, sinon le PC).
- Activé, et la phrase **ne nomme pas** d'appareil (« mets Daft Punk ») : si une musique joue déjà sur un appareil, on joue là sans demander (« mets autre chose ») ; sinon Jarvis demande, avec les vrais noms : « Sur la Devialet ou sur le PC ? » (enceinte du réglage ou seule enceinte Connect visible ; plusieurs enceintes : il les cite, trois au plus). La recherche demandée est gardée **60 s** dans la session (chaque session a la sienne : fenêtre, téléphone, chaque enceinte).
- Réponses acceptées, sans « Jarvis » (fenêtre de suivi) : « la Devialet », « l'enceinte », « sur le PC », « l'ordi », « l'ordinateur », le nom d'un appareil visible, « peu importe » / « comme d'habitude » (→ appareil du réglage). Réponse floue : une seule relance « Devialet ou PC ? », puis l'appareil du réglage, et c'est dit.
- **Depuis l'enceinte** : la question garde le micro ouvert (`X-Jarvis-Continue: 1`) pour qu'il réponde directement.
- Phrase qui nomme déjà l'appareil (« mets Daft Punk sur la Devialet ») : aucune question.
- Express sans modèle, comme le reste de Spotify.

## 3. Ce qui ne change pas

`chat-unchanged`, `ollama-unchanged`, `orchestra-session` verts sans régénérer les `__golden__` ; `parseSettings({})` ne gagne aucune clé ; `spotify_transfer` toujours absent du catalogue sans appareil Connect choisi ; un arrêt (« stop », « pause ») n'attend jamais une question.

## Tests

Pont des enceintes (faux ESP32 : `apps/desktop/scripts/fake-speaker.mjs` ou le serveur de test) : demande d'image depuis l'enceinte → image générée par un faux Imager, fenêtre du PC affichée sur la discussion de l'enceinte, phrase « sur l'écran du PC » ; longue réponse → lecture courte + « le détail est sur le PC » ; carte de confirmation toujours refusée. Spotify : question posée seulement si le réglage est actif et qu'aucun appareil n'est nommé ; réponse « la Devialet » → lecture sur la Devialet ; « peu importe » → appareil du réglage ; réponse floue → une relance puis l'appareil du réglage ; musique déjà en cours → pas de question ; question depuis l'enceinte → `X-Jarvis-Continue: 1` ; 60 s dépassées → la réponse n'est plus prise pour un choix d'appareil.

## Livraison

Partie 2 sur `cursor/spotify-voix-appareil` ; partie 1 sur la même branche si elle touche peu de fichiers, sinon `cursor/enceinte-ecran-pc` depuis `origin/main`. Pas de fusion dans `main`, pas de publication : Claude relit, Claude Code publie après les tests sur Windows. Avant de pousser : `npm run typecheck`, `npm test`, `npm run lint`. Rapport `rapports/2026-11-XX-enceinte-oreilles-bouche.md` (fait, testé, **non testé avec la vraie enceinte**), puis le RAPPORT DE VÉRIFICATION.
