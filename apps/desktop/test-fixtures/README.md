# Fixtures audio pour le test de régression du mot de réveil

Ce dossier peut contenir deux enregistrements réels, volontairement **non
commités** (`.gitignore`) puisqu'il s'agit de la voix d'une personne réelle :

- `mot-de-reveil-thedexios.mp3` — le mot de réveil seul (« Jarvis »).
- `phrase-complete-thedexios.mp3` — le mot de réveil suivi d'une commande
  complète (« Jarvis, ouvre Chrome »).

Le test `whisperWakeWord.fixture.test.ts` (à la racine de
`src/renderer/src/voice/`) rejoue la chaîne de détection réelle sur ces deux
fichiers, dès qu'ils sont présents ici, pour détecter une régression future
(changement de modèle, de fenêtrage, de seuils…). **Le test est ignoré
proprement (`skip`) si ces fichiers sont absents** — c'est le cas par défaut
sur un dépôt cloné, et `npm run test` reste vert sans eux.

Pour activer ce test en local : dépose ici un court enregistrement MP3 ou
WAV de toi-même prononçant le mot de réveil, avec ces deux noms de fichier
(ou adapte les chemins en tête du fichier de test), puis relance
`npm run test --workspace @jarvis/desktop`. Le premier lancement télécharge
le modèle Whisper `base` (~75 Mo, mis en cache localement par
`@huggingface/transformers` — voir `node_modules/@huggingface/transformers/.cache`) ;
les lancements suivants sont hors ligne.

Nécessite `ffmpeg` (transcodage MP3 → WAV 16 kHz mono) — voir
`apps/desktop/scripts/diagnose-wake-word.mjs`, dont ce test réutilise les
fonctions.
