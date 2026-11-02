# Cahier des charges — La voix de Jarvis (5.0.67)

Rédigé par Claude pour Cursor, le 2 novembre 2026. Lire `CLAUDE.md` en entier (sections « Voix », 5.0.62, 5.0.63, enceinte, « Ce qu'il ne faut pas casser »).

## Décision de l'utilisateur

- Jarvis doit parler avec une **voix naturelle, gratuite, illimitée et locale** (sans abonnement, sans Internet, rien envoyé ailleurs). Pas d'ElevenLabs comme voix principale.
- À terme, Jarvis aura **sa propre voix, inventée** : un timbre unique qui n'imite aucune personne réelle (ni l'acteur des films, ni un proche).
- La même voix doit servir **partout** : fenêtre Jarvis sur le PC, appli iPhone, enceintes, robot.

Deux chantiers, dans cet ordre. Le premier est livrable seul.

---

## Chantier 1 — Voix locale Piper dans Jarvis (application)

Aujourd'hui : voix Windows (`browser-local`, synthèse du navigateur), OpenAI en option payante ; l'enceinte produit son WAV par la voix Windows (PowerShell) ; l'iPhone lit avec sa propre voix.

### Ce qu'on veut

Un **moteur de voix unique dans le processus principal** : `texte → WAV` (mono, 16 bits ; 22 050 Hz pour la fenêtre et l'iPhone, rééchantillonné à 16 kHz pour l'enceinte), avec des voix **Piper** (modèles ONNX, voix françaises existantes : vérifier lesquelles, leur qualité et leur licence sur leurs pages officielles, et en proposer 2 ou 3 à l'écoute).

1. **Moteur** : choisir la façon la plus sûre de faire tourner Piper sous Windows sans dépendance native à compiler (règle de CLAUDE.md) : programme Piper précompilé lancé à part (arguments fixes, texte par l'entrée standard, jamais dans la ligne de commande), ou sherpa-onnx, ou autre. **Vérifier les licences** du moteur, du phonétiseur (espeak-ng est GPL : rester un programme séparé, jamais lié dans l'appli) et de chaque voix ; les noter dans CLAUDE.md. Ne pas ajouter un second onnxruntime-web dans la fenêtre (règle existante).
2. **Fichiers** : moteur et voix récupérés comme les autres fichiers voix (`setup:voice`, `voice-assets/`, `extraResources`, empreinte SHA-256 vérifiée), ou téléchargés à la première utilisation avec la même vérification. Taille ajoutée à l'installateur notée dans le rapport.
3. **Réglage** : nouveau moteur de synthèse `local-piper` dans le registre TTS, choix de la voix dans Réglages → Voix (bouton « Écouter » sur une phrase d'exemple). **Défaut inchangé** (`browser-local`) : `chat-unchanged.test.ts` et les réglages par défaut figés ne bougent pas ; l'utilisateur choisira Piper lui-même.
4. **Partout la même voix**, quand `local-piper` est choisi :
   - fenêtre Jarvis : le WAV est joué par la fenêtre (fin de lecture = `replyFinished`, la coupure par la parole de 5.0.62 marche toujours) ;
   - **enceintes** (`main/speaker/synth.ts`) : Piper à la place de la voix Windows, voix Windows en repli si Piper manque ;
   - **iPhone** (`main/phone/`) : nouvelle route `POST /api/speak` (jeton obligatoire, texte ≤ 1 500 caractères, même nettoyage que l'enceinte : sans sources, sans blocs de code) qui rend le WAV ; l'appli du téléphone le joue au lieu de la voix de l'iPhone quand le PC le propose (`/api/me` indique `voice: "piper"`), sinon garde la voix de l'iPhone ;
   - robot : il passe par le pont des enceintes, rien à faire de plus.
5. **Vitesse** : mesurer le temps pour une réponse de 200 caractères sur processeur (sans carte graphique, qui est prise par le modèle). Lire la réponse **phrase par phrase** (la première phrase part pendant que la suite se fabrique) si le délai dépasse 1 s.
6. **Tests** : moteur simulé (pas de vrai Piper dans les tests sous Linux si impossible), découpage en phrases, nettoyage du texte, route `/api/speak` (jeton, taille, WAV), repli voix Windows, réglage absent = comportement d'avant. Essai réel de Piper dans l'environnement de Cursor si le programme tourne sous Linux : noter le temps mesuré.

---

## Chantier 2 — La voix inventée de Jarvis (« studio de voix »)

Dossier `voice-studio/` à la racine (Python, hors workspaces npm, comme `training/`). **Rien à lancer sur la carte graphique de l'utilisateur pendant la génération de nuit.**

### Principe (comme le professeur et l'élève)

Un gros modèle de voix **invente** un timbre et **fabrique** des heures de paroles dans ce timbre ; une voix **Piper** légère apprend dessus ; Jarvis garde la voix Piper, rapide et gratuite pour toujours.

### Étapes à livrer

1. **Recherche, avec un rapport court (`voice-studio/RECHERCHE.md`)** : les méthodes réalistes en novembre 2026 pour **inventer** une voix française qui n'appartient à personne, et leurs licences (modèle **et** droit d'utiliser ses sorties pour entraîner une autre voix). Pistes à vérifier, sans rien affirmer de mémoire :
   - une voix décrite par du texte (« voix d'homme grave, posée, chaleureuse ») si un modèle libre le fait en français ;
   - un mélange de plusieurs voix existantes sous licence libre (voix multi-locuteurs, mélange des empreintes de voix) ;
   - un modèle qui imite une voix à partir d'un court extrait (Chatterbox ou équivalent), alimenté par une voix **déjà inventée** par l'une des méthodes ci-dessus, jamais par l'enregistrement d'une vraie personne.
   Recommander une méthode, avec la raison.
2. **`inventer.py`** : fabrique **6 voix candidates** différentes (graves, médium, plus ou moins posées), chacune disant les mêmes 10 phrases d'écoute, dans `voice-studio/candidates/` + une petite page HTML locale pour les écouter et les comparer. L'utilisateur choisira.
3. **`corpus.py`** : avec la voix choisie, fabrique environ 1 h 30 de paroles. **Textes** : phrases françaises libres de droits (par exemple le jeu de phrases de Common Voice sous CC0, ou des textes du domaine public), **jamais des textes écrits par Claude ou Cursor**. Contrôle qualité automatique : chaque extrait est retranscrit par Whisper et écarté s'il ne correspond pas au texte, volume harmonisé, silences coupés, liste des écarts.
4. **`entrainer_piper.py`** + guide pour une **carte louée** (même approche que `training/`, réutiliser ce qui existe) : affinage d'une voix Piper française existante sur le corpus, export ONNX + configuration, essai d'écoute. Vérifier et noter le coût et la durée sur les pages de prix actuelles.
5. **Installation** : la voix devient « Jarvis » dans la liste des voix Piper du chantier 1.
6. **`voice-studio/LICENCES.md`** : chaque modèle, voix de départ et jeu de phrases utilisés, avec sa licence et le lien. Une source dont la licence ne permet pas cet usage n'est pas utilisée.

### Règles

- **Aucune imitation d'une personne réelle**, même transformée. Une voix candidate trop proche d'une voix connue est écartée.
- Aucun enregistrement de voix réelle, aucune clé ni aucun corpus audio commité (dans `.gitignore`) ; seuls les scripts, la page d'écoute et les licences sont dans le dépôt.
- Tests pytest sur ce qui se teste sans modèle (découpage, contrôle qualité avec un faux Whisper, écriture des fichiers de configuration).

---

## Livraison

- Deux branches : `cursor/voix-piper-5067` (chantier 1) et `cursor/studio-voix` (chantier 2), à partir de `origin/main`, inscrites dans `AGENTS-COORDINATION.md`. Elles peuvent avancer en parallèle (le chantier 2 ne touche pas à l'application).
- Avant chaque push : `npm run typecheck`, `npm test`, `npm run lint` (5 échecs dotnet attendus seulement) ; `chat-unchanged.test.ts` et `ollama-unchanged.test.ts` verts sans régénération.
- `CLAUDE.md` : section « 5.0.67 — voix locale Piper » et ligne dans « Ce qu'il ne faut pas casser » ; section « Studio de voix ».
- Pas de fusion dans `main`, pas de publication : Claude relit d'abord. Rapports `rapports/2026-11-0X-voix-piper.md` et `rapports/2026-11-0X-studio-voix.md` (fait, testé, non testé, choix, licences, questions pour l'utilisateur).
