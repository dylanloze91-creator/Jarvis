# Cahier des charges — Enceinte Jarvis (5.0.64)

Rédigé par Claude pour Cursor, le 2 novembre 2026. Demande de l'utilisateur : « mettre Jarvis dans des enceintes », une par pièce. Lire `CLAUDE.md` en entier avant de commencer (règles de sécurité, tests figés, « ce qu'il ne faut pas casser »), en particulier les sections 5.0.62 (écoute) et 5.0.63 (téléphone), dont ce travail réutilise les briques.

## Principe

**Le cerveau reste sur le PC.** L'enceinte est une carte ESP32-S3 avec un micro et un haut-parleur, sur le Wi-Fi de la maison. Elle entend « Jarvis » elle-même, enregistre la phrase qui suit, l'envoie au PC, et joue la réponse vocale que le PC lui renvoie. Rien ne passe par Internet.

```
Enceinte (ESP32-S3) ── Wi-Fi local, HTTP ──► Jarvis sur le PC
  mot de réveil + fin de parole                Whisper (transcription)
  envoie la phrase (WAV)                       session de chat (comme le téléphone)
  joue la réponse (WAV)        ◄────────────── voix Windows → WAV
```

## Matériel visé (choix de l'utilisateur : pièces séparées, modulaire)

- Carte **ESP32-S3 DevKitC-1 N16R8** (16 Mo de flash, 8 Mo de PSRAM : nécessaire pour le mot de réveil et les tampons audio).
- Micro **INMP441** (I2S).
- Ampli **MAX98357A** (I2S) + haut-parleur 3 W 4 Ω.
- Broches **configurables** dans `config.h` (valeurs par défaut documentées, avec un schéma de câblage texte dans le README de l'enceinte).

L'utilisateur n'a pas encore le matériel : tout doit être testable sans lui (fausse enceinte, voir « Tests »).

## Priorités pour cette nuit (dans cet ordre ; s'arrêter proprement à la fin d'une phase)

1. **Phase 1 — le pont sur le PC** (indispensable, entièrement testable).
2. **Phase 2 — le programme de la carte** (compile sans erreur ; testé sur la vraie carte plus tard par l'utilisateur).
3. **Phase 3 — le guide d'installation** en français simple pour l'utilisateur (non développeur).

Une phase non finie reste sur la branche, documentée (ce qui marche, ce qui manque) dans le rapport. Mieux vaut une phase 1 solide qu'un tout fragile.

## Phase 1 — le pont sur le PC (`apps/desktop/src/main/speaker/`)

Modèle à suivre : `main/phone/` (5.0.63). Même découpage : `store.ts`, `server.ts`, `service.ts`, tests sur un vrai port.

### Réglages et état

- **Coupé par défaut.** Coupé = aucun port ouvert, rien ne change pour le reste de Jarvis.
- État dans `userData/speakers.json` (**hors de `settings.json`**, pour la même raison que le téléphone) : `enabled`, liste des enceintes `{ id, name, tokenHash, createdAt }`.
- Onglet Réglages **« Enceintes »** (`components/SpeakerSettings.tsx`, appliqué tout de suite, sans « Enregistrer ») :
  - interrupteur « Enceintes Jarvis » ;
  - adresse du PC à mettre dans l'enceinte : IP locale **et** nom `<nom-du-pc>.local`, port ;
  - bouton « Ajouter une enceinte » : demande un nom (« Salon », « Chambre »), crée un **jeton** et affiche **le bloc de configuration à copier** dans `secrets.h` de l'enceinte (adresse du PC, port, jeton). Le jeton n'est affiché qu'à ce moment-là ; seule son empreinte SHA-256 est gardée (comme `phone/store.ts`) ;
  - liste des enceintes, avec « Retirer », et l'heure de la dernière phrase reçue (en mémoire seulement) ;
  - rappel : à la première activation, Windows demande d'autoriser Jarvis sur le réseau : accepter pour les **réseaux privés** seulement.

### Serveur

- `node:http`, port fixe **53131** (`SPEAKER_PORT`, dans `packages/core/src/speaker/`), écoute sur toutes les interfaces **mais** refuse toute requête dont l'adresse distante n'est pas privée (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10). Jamais d'Internet.
- Jeton obligatoire sur toutes les routes (`Authorization: Bearer`), comparaison en temps constant. Limites : corps ≤ 1,5 Mo (environ 45 s d'audio), une seule phrase traitée à la fois par enceinte.
- Routes :
  - `GET /api/speaker/hello` → `{ name, version, followUpMs }` (`followUpMs` = `followUpWindowMs(settings.voice)` de 5.0.62).
  - `POST /api/speaker/turn`, corps `audio/wav` (PCM 16 bits, mono, 16 kHz), en-tête `X-Jarvis-Follow-Up: 1` si la phrase a été dite **sans** « Jarvis » pendant la fenêtre de suivi. Réponse :
    - `200` + `audio/wav` (16 kHz, mono, 16 bits) de la réponse, en-têtes `X-Jarvis-Continue: 1|0` (garder l'écoute de suivi ou non) et `X-Jarvis-Transcript` (transcription, encodée `encodeURIComponent`, pour le journal de la carte) ;
    - `204` quand il n'y a rien à dire : transcription vide ou hallucination Whisper, mention de Jarvis (« tu connais Jarvis ? »), phrase de suivi pas pour Jarvis (vérification de 5.0.62), arrêt (« stop », « tais-toi ») ; avec `X-Jarvis-Continue: 0`.
- Réutiliser : `classifySpokenTurn` / `wakeWordAddress` / `stripTrailingWakeWord` (core, 5.0.62) pour le texte ; le paramètre `followUp` de `SendChatInput` pour la vérification du destinataire.

### Transcription

Whisper tourne dans le renderer (`renderer/src/voice/whisper/pipelineLoader.ts`, `transcribeWithWhisper(pcm, options)`). Le main n'a pas Whisper. Faire un aller-retour IPC étroit :

- main → renderer : `speaker:transcribe-request { requestId, pcm (Float32Array 16 kHz) }` ; renderer → main : `speaker:transcribe-result { requestId, text | error }`, via le preload (jamais `ipcRenderer` brut dans React). Délai 60 s.
- Avant Whisper, même préparation que la dictée (`preprocessDictationPcm`, `refineFrenchDictation` après) et même langue (`WHISPER_DICTATION_LANGUAGE`).
- La fenêtre peut être masquée (elle l'est souvent) : `backgroundThrottling: false` est déjà réglé. Si le renderer ne répond pas, `503` avec un court WAV d'erreur.

### Réponse vocale

Le chat répond en texte ; la voix doit devenir un fichier pour l'enceinte (la synthèse du navigateur ne sait que jouer, pas produire un fichier).

- Par défaut : **voix Windows** par PowerShell (`System.Speech.Synthesis.SpeechSynthesizer`, `SetOutputToWaveFile` avec `SpeechAudioFormatInfo(16000, Sixteen, Mono)`), voix française si elle existe. Script **fixe** ; le texte passe par l'entrée standard ou un fichier temporaire, **jamais** concaténé dans le script (règle `psQuote` de CLAUDE.md). Fichier temporaire supprimé après lecture. Passe par le module d'exécution existant (`tools/platform/exec.ts`) ; documenter cette nouvelle exception fixe dans « Ce qu'il ne faut pas casser ».
- Si l'utilisateur a choisi la synthèse OpenAI avec une clé (`VoiceBridge.speak`) : l'utiliser, puis convertir en WAV 16 kHz mono si nécessaire. Sinon voix Windows.
- Texte dit : sans le bloc des sources (`stripSourcesFooter`), sans blocs de code, 1 500 caractères au plus.
- Hors Windows (tests Linux) : un synthétiseur injectable ; le test utilise un faux qui rend un WAV de silence.

### Discussion

- Une `ChatSession` par enceinte (comme le téléphone, `source: 'voice'`), entourée de `chatActivity`. La discussion continue tant que l'enceinte envoie des phrases ; une nouvelle discussion commence après 10 minutes sans phrase.
- **Pas de carte de confirmation sur une enceinte** : une action qui demande l'accord de l'utilisateur est **refusée**, et Jarvis le dit (« Pour ça, il me faut ton accord : demande-le-moi sur le PC ou le téléphone. »). Les actions `safe` (heure, météo, Spotify, questions, calcul) marchent. Tester ce refus.
- Les discussions des enceintes sont dans l'historique du PC (titre préfixé du nom de l'enceinte si c'est simple ; sinon, ne pas toucher au format de l'historique).

## Phase 2 — le programme de la carte (`firmware/jarvis-speaker/`)

Projet **PlatformIO**, à la racine du dépôt (hors des workspaces npm, aucun impact sur `npm test`). Choisir le cadre (Arduino ESP32 3.x ou ESP-IDF) qui permet le mieux le mot de réveil local ; noter le choix et la raison dans le README.

- **Mot de réveil sur la carte** : rien n'est envoyé au PC avant lui. Pistes à vérifier (ne rien affirmer sans l'avoir vérifié dans la documentation officielle) : WakeNet d'Espressif (ESP-SR) s'il propose « Jarvis » ; sinon microWakeWord (modèle « hey_jarvis ») ; sinon, **en dernier recours seulement**, le bouton BOOT en « appuyer pour parler », clairement signalé comme provisoire.
- **Fin de parole** sur la carte (énergie, comme `core/speech/endOfSpeech.ts` : environ 650 ms de silence après le début), 15 s au plus par phrase ; un peu d'audio avant le mot conservé si possible.
- Envoi `POST /api/speaker/turn` (WAV 16 kHz mono 16 bits), lecture du WAV reçu sur l'ampli I2S.
- **Écho** : pendant que la carte parle, le micro n'écoute pas ; après la réponse, si `X-Jarvis-Continue: 1`, écoute de suivi **sans** mot de réveil pendant `followUpMs`, envoyée avec `X-Jarvis-Follow-Up: 1` ; ensuite retour en veille.
- Retour visuel : la LED de la carte (veille, écoute, réflexion, erreur). Petit son « bip » au réveil (généré, pas de fichier audio commité).
- Wi-Fi qui se reconnecte seul ; PC injoignable : un court son d'erreur, pas de blocage.
- `include/secrets.example.h` (Wi-Fi, adresse du PC, port, jeton, nom) commité ; `include/secrets.h` **dans `.gitignore`**. Aucun secret dans le dépôt.
- `config.h` : broches, volume, sensibilité.
- Vérifier que `pio run` compile dans l'environnement de Cursor (installer PlatformIO par pip si possible). Si la compilation est impossible dans le cloud, le dire clairement dans le rapport.

## Phase 3 — le guide (`firmware/jarvis-speaker/README.md`, en français simple)

Pour un non-développeur, sur Windows : liste d'achat (avec références exactes), câblage pas à pas (tableau broche par broche), installation de l'outil pour envoyer le programme sur la carte, remplissage de `secrets.h` à partir du bloc copié dans Réglages → Enceintes, envoi du programme, premier essai, et que faire si ça ne marche pas (LED, journal série). Pas de jargon non expliqué.

## Tests (obligatoires pour la phase 1)

- `packages/core/src/speaker/*.test.ts` : adresses privées acceptées/refusées, validation des requêtes, construction/lecture WAV (réutiliser `encodeWav`/`decodeWav` du core).
- `apps/desktop/src/main/speaker/server.test.ts` (vrai port, comme `phone/server.test.ts`) : sans jeton = 401 ; adresse non privée refusée ; WAV trop gros = 413 ; phrase → transcription (faux transcripteur) → chat (faux ou vraie `ChatSession` avec faux modèle) → WAV de réponse ; `204` pour vide, mention, « stop », suivi refusé ; enceinte retirée = 401 ; coupé = port fermé.
- Une vraie `ChatSession` : une action à confirmer depuis une enceinte est refusée et le modèle n'est pas relancé (règle 0.4.10).
- **Fausse enceinte** : `apps/desktop/scripts/fake-speaker.mjs` (Node, sans dépendance) qui envoie un WAV au pont et enregistre la réponse, pour essayer sans matériel.
- `chat-unchanged.test.ts` et `ollama-unchanged.test.ts` verts **sans régénération** ; `parseSettings({})` ne gagne aucune clé.

## Règles

- Branche `cursor/enceinte-5064`, inscrite dans `AGENTS-COORDINATION.md`. Ne pas toucher à `main` sauf la fusion finale, et **ne pas publier** de version cette nuit (l'utilisateur décidera après relecture).
- Avant de pousser : `npm run typecheck`, `npm test`, `npm run lint` (les 5 échecs dotnet sont attendus, tout autre échec doit être corrigé).
- `CLAUDE.md` : section « 5.0.64 — Enceinte Jarvis » au même format que 5.0.63, ligne dans « Ce qu'il ne faut pas casser », exception PowerShell fixe documentée.
- Rapport `rapports/2026-11-02-enceinte-5064.md` : ce qui est fait, testé, ce qui manque, choix faits (mot de réveil, cadre du programme), questions pour l'utilisateur. Sans secret.
- Le GPU du PC de l'utilisateur est occupé par la génération de nuit : ne rien lancer qui en dépende (rien ne le demande ici).
