# Cahier des charges : les yeux de Jarvis, étape 2 (regarder n'importe quoi, photo ou vidéo)

Écrit par Claude (le chat, chef d'équipe) le 25 novembre 2026, à la demande de l'utilisateur :

> « J'ai l'impression que les yeux de Jarvis servent qu'aux impressions 3D. Elle doit être utile aussi
> pour l'électronique, pour tout ce genre de choses. Le but c'est vraiment de te remplacer. Toi, quand
> je t'envoie une photo, tu arrives à l'analyser. Pareil pour une vidéo. Des fois tu te trompes, mais
> c'est normal. Je veux que ce soit pareil pour lui. »

Mission pour **l'agent Yeux** (Claude Code), après l'étape 1 (`yeux-etape-1.md`). S'appuie sur le
registre des yeux, le bouton « Montrer à Jarvis » de l'iPhone, la photo jointe de la fenêtre, et le cap
`chef-de-projet.md`.

## 0. En bref, pour l'utilisateur

- Tu montres **n'importe quoi** à Jarvis (photo de l'iPhone, photo jointe sur le PC, webcam, vidéo) et
  tu poses ta question : « c'est quoi ce composant ? », « mon câblage est bon ? », « qu'est-ce qui est
  écrit sur la puce ? », « pourquoi ma soudure est terne ? », « résume cette vidéo ».
- Jarvis répond comme Claude : ce qu'il voit, ce qu'il en pense, **et son doute**. Il se trompera plus
  souvent que Claude au début ; on mesure, puis on améliore.
- Tout reste sur le PC. Rien n'est enregistré sans « garde cette photo ».

## 1. Le principe : un petit modèle qui regarde, des outils qui raisonnent

Un petit modèle de vision local ne raisonne pas aussi bien que Claude. On fait comme pour l'atelier :
**le modèle lit l'image, des outils et des règles font le reste.**

1. **Regarder** : le modèle de vision décrit l'image et lit le texte visible (référence d'une puce,
   sérigraphie d'une carte, étiquette, valeur d'un composant, numéro de broche).
2. **Comprendre** avec des outils, selon la question :
   - **identifier** : une référence lue (« ESP32-S3-WROOM-1 », « MAX98357A ») part en recherche web
     (mêmes outils et mêmes gardes que la recherche de cotes de l'atelier) → fiche, brochage, usage ;
   - **comparer à ce qui est connu** : pour le matériel de l'utilisateur, les câblages de référence
     existent déjà (`firmware/jarvis-speaker/include/config.h`, dossier du rover) ; Jarvis compare ce
     qu'il voit (fil sur telle broche) à la référence et dit ce qui diffère ;
   - **mesurer ce qui se mesure** : jamais une tension ou une valeur « vue » sur une photo n'est donnée
     comme sûre ; Jarvis dit quoi mesurer et comment (comme Claude l'a fait pour l'ampli de
     l'enceinte).
3. **Répondre** : le 7B du chat (ou l'équipe qui convient) écrit la réponse à partir de la description,
   du texte lu et des résultats des outils, en citant ce qui vient de l'image, de la recherche ou de la
   référence, et ce qui reste incertain.

## 2. La vidéo

- Pas de dépendance nouvelle : la fenêtre sait déjà lire une vidéo. On en tire des **images clés**
  (une toutes les 2 à 5 s, plus quand l'image change beaucoup, 40 au plus), et le **son** passe par
  Whisper (déjà là).
- Chaque image clé est décrite brièvement ; le modèle du chat assemble : ce qui se passe, dans l'ordre,
  avec les moments (« à 0:42, … »), plus ce qui est dit.
- Vidéo de 3 minutes au plus pour commencer, 200 Mo au plus ; plus long = « je regarde les 3 premières
  minutes ».
- Sources : vidéo jointe sur le PC, vidéo envoyée depuis l'iPhone (même règle que les photos : jeton,
  taille bornée, en mémoire).

## 3. Choisir le modèle de vision sur **ton** usage (le banc)

- Candidats à mesurer sur la RTX 2060 (vérifier qu'ils existent dans Ollama et ce qu'ils occupent) :
  `gemma3:4b`, `qwen2.5vl:3b`, `qwen2.5vl:7b` (le plus fort pour lire du texte, peut-être juste en
  mémoire : manœuvre « décharger le chat, regarder, recharger »), et un autre petit si l'agent en
  trouve un meilleur. Rien n'est téléchargé sans accord.
- **Examen tiré de ton usage réel**, pas d'images génériques : photos de l'utilisateur (cartes de
  l'enceinte, câblages, soudures, impressions, composants du rover), rangées par l'utilisateur ou par
  l'agent dans `C:\dev\jarvis-data\yeux\examen\`, avec pour chacune la question et la réponse attendue
  (écrites par l'utilisateur, ou proposées par Claude et **validées** par l'utilisateur). Cet examen
  sert à **mesurer**, jamais à entraîner (règle du projet : rien d'écrit par Claude dans un jeu
  d'entraînement).
- Mesures : bonnes réponses, texte lu juste (références), fausses affirmations sûres d'elles (le pire),
  durée, mémoire. Le rapport donne les chiffres seulement.
- Plus tard (« Model Development ») : un modèle de vision affiné sur les photos de l'utilisateur, sur
  carte louée, si le banc montre que ça vaut le coup.

## 4. Ce qui ne bouge pas

- Les règles des caméras de l'étape 1 (rien d'enregistré, pas de chambre, témoin, coupure).
- Une analyse n'est **jamais** une raison d'agir seule (pas d'impression lancée, pas de pièce commandée,
  pas de câble « validé » qui ferait mettre sous tension sans que l'utilisateur ait vérifié).
- Jarvis Test seulement, coupé par défaut, réglages sans défaut Zod ; tests figés sans régénération.
- Une seule chose sur la carte graphique à la fois (réservation dans `AGENTS-COORDINATION.md`).

## 5. Fonctions appelables (cap chef de projet, § 5)

- `regarder({ image | video, question })` → description, texte lu, réponse, incertitudes, sources.
- `identifierComposant({ image })` → références lues, fiches trouvées (avec sources).
- `verifierCablage({ image, reference })` → différences vues, ce qu'il faut mesurer.
Un projet (par exemple « fais-moi un boîtier pour ça » avec une photo) doit pouvoir les appeler.

## 6. Ordre

1. Photo + question, n'importe quel sujet (fenêtre et iPhone), avec le modèle de vision choisi
   provisoirement (gemma3:4b) ; texte lu → recherche web.
2. Banc sur l'examen de l'utilisateur ; choix du modèle avec lui.
3. Vérifier un câblage par rapport à une référence connue (l'enceinte d'abord).
4. Vidéo.
Chaque point : rapport court, ligne de coordination, « Testé en vrai : FAIT / PAS FAIT ».
