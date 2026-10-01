# Jarvis 0.4.19 — contexte pour un autre développeur

Ce fichier est à la **racine du code**. Les chemins ci-dessous partent de ce dossier. Ce n’est pas un résumé marketing : c’est l’état réel de cet arbre. La voix a été refaite dans cet arbre (publiée en 0.4.11, section « Voix ») : la transcription restait « Chargement… 100 % » sur l’installateur Windows. La refonte du tableau de bord est dans cet arbre : fenêtre étroite = overlay, fenêtre large = tableau de bord.

**Version confirmée :** `apps/desktop/package.json` → `"version": "0.4.19"`. Le `package.json` racine est encore à `0.3.0` : c’est le monorepo, pas l’appli. La version qui compte pour l’exe, l’updater et GitHub est celle de `@jarvis/desktop`. La voix corrigée en 0.4.11 (installateur Windows) est inchangée. Le modèle par défaut reste `qwen2.5:3b`. `qwen3.5:4b` est le modèle recommandé documenté ; le repli est réglable (`fallbackModel`, défaut `qwen2.5:3b`).

Lis ce fichier avant de modifier le code.

---

## Qu’est-ce que c’est

Jarvis est un **assistant Windows** : une fenêtre Electron **sans cadre, translucide, always-on-top**, absente de la barre des tâches, avec icône près de l’horloge. Raccourci global par défaut : `Control+Space`. `Échap` masque. Par défaut la fenêtre **reste visible** si on clique ailleurs (`stayVisibleOnBlur: true` dans `packages/core/src/settings.ts` ; l’ancienne clé `hideOnBlur` est ignorée).

Un modèle d’IA converse et agit sur le PC **uniquement** via des outils déclarés. Flux :

```
Utilisateur → Agent → Tool Manager → outils → Windows
```

Le modèle ne touche jamais le système directement. TypeScript strict, Electron 44, React 19, Tailwind 4, Zod, Vitest, npm workspaces. **Aucune dépendance native à compiler.** Cible machine : Windows, 64 Go RAM, RTX 2060 6 Go, i7 10e gén. Beaucoup d’outils (PowerShell, journal d’événements, Spotify desktop, SiteBlock) n’ont de sens que sur Windows.

Google Agenda / Gmail / Drive **n’est pas** dans cette 0.4.17.

---

## Installer les deps et lancer

Node `>= 20.19.0` (`package.json` racine). Workspaces : `packages/*` et `apps/*`. Depuis cette racine :

```bash
npm install
npm run build --workspace @jarvis/core   # obligatoire : @jarvis/core expose dist/
npm run dev              # = npm run dev --workspace @jarvis/desktop
```

`apps/desktop` dépend de `@jarvis/core` via `"main": "./dist/index.js"`. Sans build du core, le desktop ne résout pas le paquet. En parallèle, pour itérer le core : `npm run dev --workspace @jarvis/core` (tsc --watch).

Scripts utiles (racine) :

| Script | Effet |
| --- | --- |
| `npm run dev` | electron-vite, après `setup:voice` |
| `npm test` | Vitest des workspaces |
| `npm run typecheck` | tsc des workspaces |
| `npm run build` | core puis desktop |
| `npm run package:win` | installateur NSIS, `--publish never` |

Le script `setup:voice` remplit `apps/desktop/voice-assets/` (runtime ONNX, Whisper, openWakeWord, modèle Vosk français ; non commité, voir `.gitignore`). Premier `dev` / `build` : besoin de réseau.

L’installateur publié est `Jarvis-Setup-0.4.19.exe` (release GitHub `v0.4.19`).

Données utilisateur (Electron `userData`, typiquement `%APPDATA%\Jarvis`) :

- `settings.json` — **toutes** les clés (LLM, recherche, Spotify, SiteBlock, voix)
- `conversations/` — un JSON par conversation
- `personalization.json`
- `knowledge-index.json`
- `audit-log.json`
- `spotify-token.json` (PKCE, mode 0600)

---

## Carte des dossiers

```
./
  package.json                 workspaces npm, scripts racine
  CLAUDE.md                    ce contexte
  packages/core/               logique sans Electron
    src/settings.ts            schéma Zod unique de la config
    src/providers/             Ollama, OpenAI, Anthropic, mock
    src/tools/                 ToolManager, risques, confirmations
    src/agent/agent.ts         boucle modèle → outils
    src/speech/                contrats voix + chemins Whisper/openWakeWord
    src/search/                Google (défaut, sans clé), Wikipédia, Brave
    src/market/                Yahoo Finance (défaut), Finnhub
    src/knowledge/             prompt + URL locale embeddings
    src/siteblock/             intent, prompt, URL loopback
    src/media/                 intent Spotify
    src/update/                lecture latest.yml GitHub
    src/history/  src/audit/
  apps/desktop/                Electron (version 0.4.19)
    electron-builder.yml       NSIS, extraResources, publish GitHub
    electron.vite.config.ts    aliases onnxruntime-web (wasm, pas JSEP)
    scripts/setup-whisper.mjs
    scripts/setup-openwakeword.mjs
    src/shared/ipc.ts          canaux IPC (main + preload + renderer)
    src/main/index.ts          bootstrap, tray, raccourci, IPC
    src/main/window.ts         overlay 720×…, frameless, alwaysOnTop
    src/main/store.ts          lecture/écriture settings.json
    src/main/session.ts        un tour de chat + confirmations
    src/main/tools/            implémentations Windows + registre
    src/main/tools/index.ts    createToolManager() — point d’extension
    src/main/knowledge.ts      RAG local (index + embeddings Ollama)
    src/main/media/            Spotify PKCE + lecteur desktop
    src/main/siteblock/        pont HTTP loopback
    src/main/updater.ts
    src/main/voiceAssetsProtocol.ts    schéma jarvis-oww: (fichiers voix)
    src/preload/index.ts       surface window.jarvis uniquement
    src/renderer/src/App.tsx   overlay : chat / historique / réglages / journal
    src/renderer/src/index.css overlay « futuriste » (orbe, glow cyan)
    src/renderer/src/voice/    STT/TTS/wake word côté DOM
    voice-assets/              ort/, whisper/, openwakeword/, vosk/ après setup:voice
```

Règle : **`packages/core` n’importe pas Electron.** Fenêtre, fs, PowerShell, IPC, Spotify, SiteBlock, index disque → `apps/desktop`. Contrats, Zod, agent, registres → core.

---

## Fournisseurs LLM

Registre : `packages/core/src/providers/registry.ts` (`createDefaultRegistry`).

| id | Fichier | Clé | Modèle par défaut |
| --- | --- | --- | --- |
| `ollama` | `providers/ollama.ts` | non | **`qwen2.5:3b`** (`OLLAMA_DEFAULT_MODEL`) |
| `openai` | `providers/openai.ts` | oui | `gpt-4o-mini` |
| `anthropic` | `providers/anthropic.ts` | oui | `claude-sonnet-4-5` |
| `mock` | `providers/mock.ts` | non | `jarvis-demo` |

Ollama : API native `/api/chat` (pas le compat OpenAI), `num_ctx` forcé à 8192 (`OLLAMA_RECOMMENDED_NUM_CTX`), URL `http://127.0.0.1:11434`. Recos RTX 2060 6 Go : `packages/core/src/providers/ollamaModels.ts`. UI dédiée : `apps/desktop/src/renderer/src/components/OllamaSettings.tsx` (liste des modèles installés, test d’appel d’outil).

**Où vit la clé :** champ `apiKey` de `settings.json`, lu/écrit par `apps/desktop/src/main/store.ts`. Jamais `process.env`. Commentaire explicite dans `packages/core/src/settings.ts` (Spotify / SiteBlock : même règle). OpenAI et Anthropic : champ « Clé API » du panneau, `type="password"`. Sans clé alors que `requiresApiKey` : `createOrFallback` bascule sur le mock et l’UI affiche « démonstration ».

Schéma vide (premier lancement, pas encore de `settings.json`) : `provider: 'mock'`. Le chemin produit recommandé est **Ollama + `qwen2.5:3b`** : l’utilisateur le choisit dans les réglages (engrenage → « Ollama (local, gratuit) » → Tester → Enregistrer). Il faut `ollama pull qwen2.5:3b` sur la machine.

Backend compatible OpenAI (LM Studio, OpenRouter…) : provider `openai` + `baseUrl`, **pas** un nouveau fichier.

---

## Tool manager, risques, confirmation

Cœur : `packages/core/src/tools/manager.ts`, types `packages/core/src/tools/types.ts`, politiques `packages/core/src/tools/permissions.ts`. Catalogue Electron : `apps/desktop/src/main/tools/index.ts`.

Trois niveaux `risk` :

- `safe` — lecture / réversible, exécuté tout de suite
- `confirm` — passe par `requestConfirmation` sauf si la politique de catégorie l’assouplit
- `denied` — enregistré mais **pas** exposé au modèle

Catégories des outils `confirm` : `apps`, `files`, `capture`, `shell`. Politiques : `always` (défaut) / `destructive-only` / `never`. Réglables dans l’UI **sauf `shell`**. `forceConfirm: true` **ignore** la politique.

Confirmations incompressibles dans cet arbre :

- `run_command` (`apps/desktop/src/main/tools/shell.ts`) — affiche la commande exacte
- `delete_file` (corbeille)
- mutations SiteBlock (`siteblock_set_blocking`, add/remove domain/period, start/stop focus)
- `index_jarvis_folder`, `clear_jarvis_memory`

UI : `apps/desktop/src/renderer/src/components/ConfirmationCard.tsx`. IPC `confirm` / `chat:confirm-respond` (`apps/desktop/src/shared/ipc.ts`). Session : `apps/desktop/src/main/session.ts`. Chaque exécution (ok / erreur / refus) va dans `audit-log.json`.

Spotify est volontairement `safe` (voix : une confirmation à chaque « pause » rendrait la chose inutilisable) — voir le commentaire dans `apps/desktop/src/main/tools/spotify.ts`.

---

## Voix (openWakeWord + Whisper)

Défauts (`packages/core/src/settings.ts`) : écoute **off** jusqu’à activation ; mot `jarvis` ; STT `local-whisper` ; TTS `browser-local` (voix Windows). Un seul mot de réveil, un seul Whisper. `browser-local` **STT** n’est plus enregistré (cassé dans Electron). Les anciennes clés `wakeWordEngine`, `wakeWordAccessKey`, `sttModel` sont ignorées à la lecture.

**Fichiers et chargement (un seul chemin, dev comme installateur) :**

- `npm run setup:voice` (`apps/desktop/scripts/setup-voice-assets.mjs`) remplit `apps/desktop/voice-assets/{ort,whisper,openwakeword,vosk}` (Vosk : zip d’alphacephei vérifié par SHA-256 puis converti en `.tar.gz` par `scripts/zipToTarGz.mjs`, sans dépendance). Liste unique : `REQUIRED_VOICE_ASSETS` (`packages/core/src/speech/voiceAssets.ts`), reprise par `after-pack.cjs` et par le diagnostic.
- `electron-builder.yml` → `extraResources` copie ces quatre dossiers dans `resources/`, à côté de `app.asar`.
- Le renderer ne lit ces fichiers que par `jarvis-oww://<ort|whisper|openwakeword|vosk>/<chemin>` (`apps/desktop/src/main/voiceAssetsProtocol.ts`) : flux, `content-length`, `HEAD`, MIME `application/wasm`, chemins Windows via `path.join`. Schéma privilégié `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `stream`.
- **Un seul onnxruntime-web** (1.31, la version exigée par transformers.js, devDependency épinglée). `electron.vite.config.ts` envoie `onnxruntime-web` et `onnxruntime-web/webgpu` vers le même `ort.wasm.min.mjs`. Configuration unique : `apps/desktop/src/renderer/src/voice/onnxRuntime.ts` (`wasmBinary` + fabrique `.mjs` en blob, 1 thread, `initTimeout` 30 s).

**Whisper** (`voice/whisper/pipelineLoader.ts`) : transformers.js npm, `Xenova/whisper-base` q8, wasm. Configuration « modèle local » : `allowLocalModels = true`, `localModelPath = 'jarvis-oww://whisper/'`, `allowRemoteModels = false`, `useBrowserCache = false`, `useWasmCache = false`. **Ne pas** revenir à `remoteHost = jarvis-oww` : transformers.js 4.x teste l’existence des fichiers par une requête `Range` réservée à http(s) ; sous `jarvis-oww:` tokenizer et `preprocessor_config.json` passaient pour absents (erreurs `feature_extractor` en 0.4.9, `tokenizer_class` en 0.4.10, et « Chargement… 100 % » en boucle). Chargement borné à 90 s (erreur qui nomme l’étape), pipeline incomplet refusé et libéré, pas de nouvel essai pendant 30 s après un échec (sauf « Préparer maintenant » / « Tester la voix »). Jetons générés bornés (dictée 96, confirmation 12, YouTube 224). Le même Whisper sert la dictée, la confirmation du mot de réveil et YouTube.

**Mot de réveil** (`voice/registries.ts` → `createWakeWordEngine`, 0.4.16) : openWakeWord (`hey_jarvis_v0.1.onnx`) pour « Hey Jarvis » **et**, en parallèle, Vosk (`vosk-model-small-fr-0.22`, vosk-browser dans son Web Worker) pour « Jarvis » seul : grammaire fermée `jarvis` + leurres (`gervais`, `javel`, `j'avais`, `avis`, `parvis`, `jardin`, `service`) + `[unk]`, confiance du mot ≥ 0,9 à la sensibilité par défaut (`packages/core/src/speech/voskWakeWord.ts`). Sur les 9 prises de thedexios : 9/9, 0 faux réveil sur 17 négatifs. L’audio transmis à la dictée part d’un peu avant le mot (temps des mots de Vosk). Si Vosk ne se charge pas (120 s), l’ancien déclencheur (rafale d’énergie confirmée par Whisper EN puis FR) prend le relais — lui fait tourner Whisper sur chaque rafale, sur le fil principal. L’audio reçu pendant la confirmation est gardé pour la dictée (`commandOffset`). Après un réveil, la dictée exige ≥ 0,3 s de parole et un transcript d’un seul mot non reconnu n’est pas une commande (`commandAfterWakeWord`, qui retire aussi une tête « J…V…S » : « J'en avise », « J'ai envie ce »). Porcupine et le moteur « transcription continue » sont supprimés.

**À ne pas défaire (trouvé en testant le build installable)** :
- Tout appel au runtime ONNX (création de session, `run`, `pipe()` de Whisper) passe par `withOrtLock` (`voice/onnxRuntime.ts`). Whisper et openWakeWord partagent la même instance WebAssembly ; des appels entrelacés faisaient planter la fenêtre (SIGSEGV).
- La capture micro est un `AudioWorklet` (`voice/audioCapture.ts`), pas un `ScriptProcessorNode` : Whisper tourne sur le fil principal, et l’ancien nœud y perdait l’audio pendant chaque inférence (la commande dite après « Jarvis » disparaissait). Le silence de fin de dictée se mesure en durée d’audio, pas à l’horloge.

**Diagnostic** : Réglages → « Tester la voix » (`components/VoiceDiagnostic.tsx`, `voice/voiceDiagnostic.ts`) vérifie fichiers sur disque, protocole, WebAssembly, openWakeWord, Whisper, une inférence, le micro et une phrase dite ; « Copier le détail » ; « Analyser un fichier audio ». En terminal : `scripts/check-voice-recordings.mjs` sur un build empaqueté.

Barre vocale (`components/VoiceBar.tsx`) : aucun champ de saisie (l’ancien champ « simuler » se posait sur le composer). En veille, une erreur reste en détail sous « En veille — dis « Jarvis » ».

**Micro (0.4.16).** Un seul propriétaire du micro : `MicrophoneService` (`voice/microphone.ts`, instance `microphone` dans `voice/audioCapture.ts`). L’écoute, « Tester la voix », le test du mot de réveil et les échantillons prennent un bail (`acquire`) sur le même flux ; jamais deux `getUserMedia`. Ouverture mesurée : autorisation (`permissions.query`), liste, `getUserMedia` borné à 10 s, graphe Web Audio (un `AudioContext` 16 kHz partagé + `AudioWorklet`), première trame (chien de garde 4 s, puis `NoAudioError`). Contraintes (`captureConstraints`, core) : **sans** annulation d’écho, réduction de bruit ni contrôle de gain (l’AGC de Chromium modifie le volume d’entrée Windows pour toutes les applis) ; défaut Windows = pas de `deviceId` ; choix explicite = `exact`. Un choix enregistré absent → défaut Windows avec avis, repris quand il revient. Changement de micro sur place (l’ancien flux continue tant que le nouveau n’est pas ouvert ; un échec garde l’ancien). Reprise : `ended` → nouvelle ouverture (0,3/1/2/5/10 s), `devicechange`, et un contrôle de la liste toutes les 5 s (Chromium sous Linux/PulseAudio et certains pilotes ne signalent rien). Le choix du micro (panneau « Micro » des réglages, `components/MicrophonePanel.tsx`) s’applique et s’enregistre tout de suite, sans « Enregistrer ». Les erreurs gardent le nom exact (`describeCaptureFailure`, core) : `NotAllowedError : Permission denied by system` = confidentialité Windows (bouton « Ouvrir les réglages Windows » → IPC `voice:open-microphone-privacy`, URI fixe `ms-settings:privacy-microphone`). `micError` = micro seulement ; Whisper, synthèse et réveil vont dans `voiceError` (effacé après 20 s) — avant 0.4.16 une erreur de synthèse affichait « Micro indisponible ». Journal : `userData/logs/voice-capture.log` (et console du main), durée de chaque étape, identifiants abrégés ; « Copier le détail » ajoute les 60 dernières lignes. La capture reste mono (moyenne des canaux) à 16 kHz ; un mixage (Broadcast Stream Mix…) est ouvert tel quel s’il est choisi ou par défaut.

**openWakeWord (0.4.16).** Le mel reçoit les 480 échantillons précédents (`OpenWakeWordMelStream`, core), comme `AudioFeatures` en Python : 8 trames par 80 ms, un embedding par trame, tampon initial à 1. Sans ce contexte (0.4.15), 5 trames par 80 ms et un score ~18× trop bas (0,012 au lieu de 0,207 sur la prise GoXLR ; identique au Python à 4 décimales après correction). Seuil : 0,5 à la sensibilité par défaut (0,85 − 0,5 × s) — du bruit blanc atteignait 0,34. Échelle PCM 16 bits et atténuation des crêtes ≥ 1 inchangées.

Ne pas réintroduire `ort.min.mjs` (JSEP/WebGPU), un import CDN de transformers.js, ni un second onnxruntime-web. Vosk n’utilise pas onnxruntime (Kaldi en WebAssembly). Son worker embarqué est corrigé au build (`scripts/voskCspPatch.mjs`, plugin Vite) : la colle Embind faisait `new Function`, refusé par la CSP ; **ne pas** ajouter `unsafe-eval` à la CSP.

**Démarrage (0.4.14).** La première frame n’attend pas Whisper, openWakeWord, Ollama, Spotify, ni le réseau. Le moteur de réveil démarre après l’affichage de la fenêtre (`window:shown`). Whisper reste déchargé jusqu’à ce qu’un réveil demande une transcription (confirmation du mot, ou dictée). `onnxruntime-web` 1.31 n’est importé qu’à ce moment-là, toujours le même module (`ort.wasm.min.mjs`). Le contrôle de mise à jour reste 15 s après le démarrage.

---

## Spotify, SiteBlock, mémoire, recherche web

**Spotify** — 8 outils `spotify_*` dans `apps/desktop/src/main/tools/spotify.ts` (play, pause, resume, next, previous, volume, shuffle, current_track). Pont : `apps/desktop/src/main/media/SpotifyBridge.ts` / `SpotifyProvider.ts`. Client ID dans les réglages (`spotifyClientId`), **pas de Client Secret**, PKCE, redirect **exact** `http://127.0.0.1:53124/callback`. Premium requis pour piloter la lecture. Cible : appli de bureau Windows, pas le téléphone.

**SiteBlock** — 8 outils `siteblock_*` (`apps/desktop/src/main/tools/siteblock.ts`). URL défaut `http://127.0.0.1:18741` ; **loopback uniquement** (`packages/core/src/siteblock/url.ts`). Jeton dans les réglages, ou lecture de `%APPDATA%\SiteBlock\api.json` s’il est vide. Toute mutation = `forceConfirm`.

**Mémoire / RAG local** — `apps/desktop/src/main/knowledge.ts`. Index `knowledge-index.json` : chunks fichiers / conversations / souvenirs. Embeddings **uniquement** via Ollama local, modèle `nomic-embed-text` (`/api/embed` puis `/api/embeddings`). Une `baseUrl` OpenAI/Anthropic/publique est refusée (`packages/core/src/knowledge/localUrl.ts`). Recherche hybride cosine + lexical. Outils : `search_jarvis_memory`, `remember_jarvis`, `index_jarvis_folder`, `get_jarvis_memory_stats`, `clear_jarvis_memory`. Les conversations sont indexées en fin de tour (`session.ts`). Distinct de la **personnalisation** (`personalization.json` : nom, ton, règles) — outils `*_jarvis_personalization`.

**Recherche web sans clé** — défaut `searchProvider: 'google'` (`settings.ts`). HTML public, pas d’API (`packages/core/src/search/providers/google.ts`). Si Brave est choisi sans clé → repli Google (`search/registry.ts` `createOrFallback`). Outils : `web_search`, `web_research`, `fetch_page` (`apps/desktop/src/main/tools/web.ts`). `fetch_page` refuse les IP privées (`packages/core/src/web/urlSafety.ts`). Wikipédia et Brave restent dans le registre. Bourse : Yahoo Finance sans clé, Finnhub optionnel.

---

## UI

Overlay compact (`apps/desktop/src/main/window.ts` + `App.tsx`) tant que la fenêtre fait moins de 1100 px : coins 22px, fond transparent, glows cyan (`index.css`). Quatre vues : **chat**, **historique**, **réglages**, **journal d’audit**. Bouton « Ouvrir le tableau de bord » (`window.setChrome('dashboard')`).

Fenêtre large : `apps/desktop/src/renderer/src/dashboard/Dashboard.tsx`. Sidebar, orbe, cartes (Google et Automatisation désactivés, libellé « Bientôt », y compris « Lire mes emails »), discussion avec pastilles d’URL réellement citées, bloc système. CPU / RAM / version viennent de `system:snapshot` (`machineStats.ts`, `os`). Température affichée = `settings.temperature` (température du modèle, pas une sonde). Micro = réglage voix + libellé du périphérique s’il est connu, sinon « indisponible ». Mot de réveil : « Jarvis ».

États : boot « Démarrage de Jarvis… », vide, erreur de chargement, confirmation, barre vocale sous le composer. Les actions rapides passent par le chat (donc par les confirmations), jamais par un appel direct d’outil.

Scènes de capture (`?scene=chat|settings`, `?layout=compact`) : `App.tsx` + `preview/`. Aperçu hors Electron : `apps/desktop/vite.ui.config.ts` (port 43173).

## UI telle que livrée en 0.4.9

L’overlay compact ci-dessus est celui de la 0.4.9, conservé pour la fenêtre étroite.

## 0.4.17 — écoute visible, latence, apprentissage du réveil, réglages en onglets

- **Whisper dans un worker** (`voice/whisper/whisperWorker.ts`, `pipelineLoader.ts` = façade, `loaderCore.ts` = l’ancien chargeur). Même onnxruntime-web 1.31, même `.wasm` (`jarvis-oww://ort/`) ; le worker en charge sa propre instance (contexte JS séparé), multi-thread (moitié des cœurs, 4 au plus) grâce à `SharedArrayBuffer`, activé par `app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')` dans le main (sans isolation cross-origin). Si le worker ne démarre pas ou plante : retour automatique au chargeur dans la page (0.4.16), la dictée en cours est rejouée. Whisper est préchargé au **premier réveil** (pas à l’activation de la voix), puis reste prêt.
- **Fin de parole** (`packages/core/src/speech/endOfSpeech.ts`) : 650 ms de silence une fois la commande commencée (1,5 s avant), mesuré en audio par fenêtres de 16 ms ; trames du micro de 1024 échantillons (était 4096). Whisper reçoit ~1 s de silence de fin (`extendTrailingSilence` répète le silence capté) : **ne pas couper le silence de fin** — Whisper complète à 30 s (même coût) et la coupe faisait tomber l’exactitude de « quelle heure est-il ? » à 60 %. Mesures VM (« Jarvis, quelle heure est-il ? » en boucle) : fin de parole → texte à l’agent, médiane 4,09 s (0.4.16) → 2,97 s (0.4.17) ; fin de parole détectée 1 024 → 704 ms ; Whisper 3,06 → 2,27 s ; exactitude 19/26 → 52/73 (71 %). Détail : `internal/apprentissage-reglages-0417.md`.
- **Orbe et logo** (`components/JarvisOrb.tsx`) : niveau du micro seulement pendant la captation d’une commande (`voice.state === 'listening'`), immobiles (respiration habituelle) en attente de « Jarvis ». Hors captation, `level` n’est rafraîchi que 4 fois par seconde.
- **Indicateur hors fenêtre** (`main/listeningIndicator.ts`, page `renderer/indicator.html`, preload `preload/indicator.ts`) : pastille 184×48 en haut à droite de la zone de travail de l’écran du curseur, du réveil à la fin de la captation, seulement si la fenêtre principale est cachée, réduite ou sans le focus. `focusable: false`, `showInactive`, `setIgnoreMouseEvents(true)`, `skipTaskbar`, `type: 'toolbar'` sous Windows (ni barre des tâches ni Alt-Tab). IPC `listening:indicator` / `listening:level`, acceptés seulement depuis la fenêtre principale.
- **Apprentissage du réveil** (option `voice.wakeLearning`, désactivée par défaut ; désactivée = détection 0.4.16 à l’identique). Core : `speech/wakeLearning/` (caractéristiques = moyenne/max/écart-type des embeddings openWakeWord sur 2 s ; régression logistique ; seuil du veto borné 0,05–0,5 et actif seulement si la validation croisée garde ≥ 97 % des vrais réveils ; rattrapage des quasi-réveils borné 0,8–0,98 ; étiquetage automatique ; un quasi-réveil < 1,5 s avant un réveil = même « Jarvis », pas un raté ; plafond). Renderer : `voice/wakeLearning/` (sessions mel+embedding à part, sous `withOrtLock`). Main : `main/wakeLearningStore.ts`, uniquement `userData/wake-learning/` (`index.json`, `clips/*.wav`, `verifier.json`), au plus 300 extraits / 20 Mo, journal sans audio ni texte. « Effacer » = extraits supprimés, modèle gardé ; « Réinitialiser » = dossier supprimé. Les détecteurs Vosk et openWakeWord ne changent pas ; Vosk et openWakeWord signalent des quasi-réveils seulement si la couche est active.
- **Réglages en onglets** (`components/SettingsTabs.tsx`) : Voix et détection, Modèle IA, Recherche et mémoire, Spotify, Outils et sécurité, Fenêtre et démarrage, Mises à jour. Un seul brouillon et un seul « Enregistrer » ; les onglets inactifs restent montés (cachés). Détails techniques repliés (`ui/disclosure.tsx`).

---

## 0.4.18 — discussion courte après le réveil

Le réveil (Vosk, openWakeWord, vérificateur, seuils, choix du micro) est celui de 0.4.17. Seul l’après-réveil change (`packages/core/src/speech/conversationSession.ts`, branché dans `useVoice.ts`).

- **Grâce 3 s.** Dès qu’un réveil est accepté, la captation ne peut pas se fermer avant 3 s d’audio, même si le silence ou la fin de parole l’aurait coupée. L’orbe et, fenêtre masquée, la pastille « Jarvis écoute » restent en écoute. Un second « Jarvis » dans cette fenêtre ne relance pas la commande.
- **Suivi sans mot de réveil.** Après l’envoi, le micro reste chaud pendant que la réponse s’écrit et se dit, puis 2 s après la fin (fin de la synthèse, ou le texte si la synthèse est coupée). Une parole dans cette fenêtre est un nouveau tour, sans « Jarvis ». Parler pendant la synthèse la coupe. Passé 2 s sans reprise, retour en veille : mot de réveil à nouveau, orbe au repos, pastille cachée. 0.4.18 laissait 8 s ; la conversation de la pièce était reprise.
- **Arrêt.** « stop », « tais-toi », « merci c’est bon » reviennent en veille tout de suite.
- **Pas d’écoute infinie.** La veille entre deux discussions exige le mot de réveil. Un suivi utilise la même fin de parole qu’une commande (une toux trop courte n’en est pas un). `...`, le vide et les phrases hallucinées connues de Whisper ne sont pas un tour et ne prolongent pas les 2 s.

## 0.4.19 — suivi de 2 s

Même discussion qu’en 0.4.18, sauf la fenêtre après la fin de la réponse : 2 s, pas 8. Sans parole dans ces 2 s, veille (mot de réveil, orbe au repos, pastille cachée). Grâce de 3 s, micro chaud pendant la réponse, coupure si l’utilisateur parle, et les trois arrêts sont inchangés. Le réveil ne change pas.

## Updater / GitHub

Dernière publication : **0.4.19** (`https://github.com/dylanloze91-creator/Jarvis/releases/tag/v0.4.19`) — exe, `.blockmap` et `latest.yml` publiés : l’updater intégré la propose.

- `apps/desktop/electron-builder.yml` : `publish.provider: github`, owner `dylanloze91-creator`, repo `Jarvis`, `releaseType: release`, artifact `Jarvis-Setup-${version}.exe`
- `apps/desktop/src/main/updater.ts` : contrôle 15 s après le démarrage puis toutes les 4 h ; téléchargement auto ; **installation seulement si l’utilisateur clique**
- Hors exe packagé, le bouton « Vérifier » lit `latest.yml` public (`packages/core/src/update/feed.ts`, `githubLatestYmlUrl`) **sans jeton**
- Ne pas committer ni lire un jeton GitHub. Les clés de publication ne font pas partie de cet arbre.

---

## Comment ajouter

### Un outil

1. `defineTool({…})` dans un fichier sous `apps/desktop/src/main/tools/`
2. L’ajouter au tableau de `createToolManager()` dans `apps/desktop/src/main/tools/index.ts`
3. Rien d’autre : pas l’agent, pas l’IPC, pas l’UI de confirmation (`risk` suffit)

```ts
export const monOutil = defineTool({
  name: 'nom_technique',
  description: 'Pour le modèle, en français, précis.',
  risk: 'safe', // ou 'confirm' (+ category) ou 'denied'
  schema: z.object({ chemin: z.string() }),
  summarize: ({ chemin }) => `Action sur ${chemin}.`,
  execute: async ({ chemin }) => ({ ok: true, content: 'Texte pour le modèle.' }),
});
```

`forceConfirm` seulement pour suppression, élévation, commande arbitraire, blocage de sites, indexation/effacement mémoire.

### Un provider LLM

1. Implémenter `LLMProvider` (`packages/core/src/providers/types.ts`)
2. `register()` dans `createDefaultRegistry()` (`providers/registry.ts`)
3. Il apparaît dans le `<Select>` des réglages (`SettingsPanel.tsx` lit `settings.providers()`)

Compatible OpenAI : ne pas ajouter de classe — `baseUrl` suffit.

Même schéma pour la recherche (`packages/core/src/search/registry.ts`) et la bourse (`market/registry.ts`). Voix : STT/TTS via `apps/desktop/src/renderer/src/voice/registries.ts` si DOM, sinon core ; le mot de réveil n’a qu’un moteur (`createWakeWordEngine`).

### Un réglage

1. Champ Zod dans `packages/core/src/settings.ts` (défaut inclus) — `parseSettings` absorbe l’inconnu
2. Contrôle dans `SettingsPanel.tsx` (ou une section dédiée) ; `window.jarvis.settings.set(draft)`
3. Si le main a besoin d’un nouvel IPC : `src/shared/ipc.ts` → `preload/index.ts` → `main/index.ts`
4. **Jamais** `process.env` pour une clé, un token, un client id

---

## Catalogue d’outils (0.4.9)

Enregistrés dans `apps/desktop/src/main/tools/index.ts` :

| Outil | risk |
| --- | --- |
| `get_system_info`, `list_processes`, `get_active_window`, `search_files`, `read_file`, `get_system_errors` | safe |
| `web_search`, `web_research`, `fetch_page`, `get_stock_quote`, `youtube_transcript` | safe |
| `spotify_play/pause/resume/next/previous/set_volume/set_shuffle/current_track` | safe |
| `siteblock_get_status` | safe |
| `get_jarvis_personalization` | safe |
| `search_jarvis_memory`, `get_jarvis_memory_stats` | safe |
| `create_folder`, `open_application`, `close_application` | confirm |
| `move_file`, `copy_file`, `delete_file` (force) | confirm |
| `take_screenshot` | confirm |
| `run_command` (force) | confirm |
| `siteblock_set_blocking`, `add/remove_domain`, `start/stop_focus`, `add/remove_period` (force) | confirm |
| `set/add/forget/reset_jarvis_personalization` | confirm |
| `remember_jarvis` | confirm |
| `index_jarvis_folder`, `clear_jarvis_memory` (force) | confirm |

---

## Revue 0.4.10 — règles ajoutées (ne pas défaire)

Corrections de la revue complète (détail : `docs/audit-0410.md` du store du projet). Version inchangée, rien de publié.

- **Réglages** : `parseSettings(input, fallback)` ne remplace que le champ invalide (modèle vidé, raccourci effacé…) par la valeur de `fallback`. À l’enregistrement, `main/index.ts` passe les réglages précédents : un champ vide ne remet plus tout à zéro (clés API comprises).
- **Tool Manager** : `defineTool` applique les défauts Zod avant `summarize`, `describeCommand` et `isDestructive` — la confirmation voit les mêmes valeurs que `execute`.
- **Agent** : si tous les appels d’un tour ont été refusés, la réponse est un texte fixe (« je n’ai rien fait… »), le modèle n’est pas relancé (même logique que Spotify / YouTube forcés). Les messages `tool` portent `toolStatus` pour que l’historique affiche « refusé » / « échec ».
- **PowerShell** : `runPowerShell` force la sortie UTF-8 (`POWERSHELL_UTF8_PREAMBLE`). Un texte venu du modèle n’entre dans un script que via `psQuote` (apostrophes), jamais entre guillemets doubles (`$(...)` s’y exécuterait). `get_system_errors` teste `NoMatchingEventsFound`, pas le message anglais.
- **Fenêtre** : `will-navigate` bloque toute navigation hors de l’interface ; un lien cliqué s’ouvre dans le navigateur seulement s’il est `http(s)`. `show()` recentre selon la largeur réelle (tableau de bord compris).
- **`take_screenshot`** : sans argument = écran principal (`getPrimaryDisplay`), source choisie par `display_id`, `getSources` borné à 15 s (`SCREENSHOT_TIMEOUT_MS`) avec un message d’erreur au lieu de rester « en cours ».
- **Journal d’audit** : écritures en file (`FileAuditLogStore`), plus d’entrée perdue quand deux outils finissent ensemble.
- **YouTube** : `loadYoutubePlayer` essaie tous les clients avant d’accepter un refus ; si YouTube bloque (`LOGIN_REQUIRED`, anti-robot), la réponse le dit (`youtubeRefusedMessage`) au lieu de prétendre « pas de sous-titres ». L’écoute abandonne après 5 min sans progression du renderer (`LISTEN_IDLE_TIMEOUT_MS`). Le filtre de chiffres garde les retours à la ligne (paragraphe puis points).
- **Mise à jour** : aucun contrôle périodique une fois la mise à jour téléchargée (le bouton « Installer » reste).
- **Voix** : `cancel()` de la synthèse (`interrupted` / `canceled`) n’est pas une erreur. Micro choisi débranché → micro par défaut ; erreurs `getUserMedia` en français.
- **Statut** : le fournisseur de démo (`mock`, défaut d’une première installation) s’affiche « démonstration », jamais « en ligne » (`lib/runtimeStatus.ts`).

---

## Ce qu’il ne faut pas casser

- **Le Tool Manager comme seul passage** vers le système. Pas d’`exec` / `fs` / `shell.openExternal` déclenché par le renderer (exceptions : un lien `http(s)` cliqué, ouvert dans le navigateur par `window.ts` ; l’URI fixe `ms-settings:privacy-microphone`, sans paramètre venu du renderer).
- **Preload étroit** (`contextIsolation: true`, `nodeIntegration: false`). Pas d’`ipcRenderer` brut dans React.
- **`packages/core` sans Electron.**
- **Clés uniquement dans `settings.json`**, jamais d’env, jamais dans git (`.gitignore` ignore `.env`).
- **`forceConfirm`** sur `run_command`, `delete_file`, mutations SiteBlock, indexation/effacement mémoire. `ConfirmationCard` doit montrer `command` tel quel pour le shell.
- **Protocole `jarvis-oww:` + extraResources** (`voice-assets/`) pour le runtime ONNX, Whisper, openWakeWord et Vosk. Ne pas remettre les ONNX dans asar ni charger transformers depuis jsDelivr. Ne pas bundler `onnxruntime-node` / `@huggingface/transformers` dans l’exe (`electron-builder.yml`).
- **Whisper** : garder la configuration « modèle local » de transformers.js (`configureTransformersEnv`) et `preprocessor_config.json` / `tokenizer*.json` dans `REQUIRED_VOICE_ASSETS`.
- **UI** : overlay compact sous 1100 px, tableau de bord au-dessus. Ne pas retirer les confirmations. Google / Automatisation / « Lire mes emails » restent « Bientôt ».
- **Spotify PKCE** sans secret ; URI de redirect exacte ; outils `safe`.
- **SiteBlock loopback** uniquement.
- **Embeddings mémoire** : Ollama local seulement.
- **Recherche Google sans clé** comme repli. Ne pas rendre Brave obligatoire.
- **STT `browser-local`** : ne pas le réenregistrer.
- **`ort.wasm.min.mjs`** (pas `ort.min.mjs`), un seul onnxruntime-web pour Whisper et le mot de réveil.
- **Instance unique** (`requestSingleInstanceLock`), tray qui ne quitte pas à la fermeture de fenêtre, `stayVisibleOnBlur` par défaut.
- **Version** : bump `apps/desktop/package.json`, pas seulement la racine.
- **Modèles / voix réelles** : ne pas committer `voice-assets/**` (sauf son README), `test-fixtures/*.wav|mp3`.

Travaux **hors scope** de cet arbre (ne pas les reprendre ici) : Suite Google, publication GitHub.

## Contrats 0.4.14

- **Outil** : `ToolResult.outcome` vaut `success`, `recoverable`, `definitive`, `timeout`, `cancelled` ou `missing_dependency`. `content` est une phrase française. `technicalDetail` est le journal. `ok` reste le booléen historique.
- **Secrets** : `redactSecrets` / `redactValue` avant l’audit et `debugLog`. Le drapeau est `settings.debugLogging`.
- **Web** : `web_search` et `web_research` (2 à 4 requêtes, dédoublonnage, lecture, comparaison). Libellés `FAIT`, `SOURCE`, `INTERPRÉTATION`, `INCERTITUDE`. HTML sans clé. Le premier lien n’est pas un fait.
- **Spotify** : succès seulement si `is_playing === true` et l’URI en cours est celle demandée. Redirect PKCE inchangé : `http://127.0.0.1:53124/callback`.
- **Mémoire** : `remember_jarvis`, `search_jarvis_memory`, `index_folder`, `search_documents`, `read_document`, `remember_video`. Passages seulement, jamais l’index entier dans le prompt. Embeddings `nomic-embed-text` si le modèle est là, sinon lexical.
- **Vidéo** : segments, score 0–100, synthèse, cadre finance, mémoire vidéo. `visionHook` répond « vision indisponible » sans prétendre lire un graphique.
- **Réveil** : buffer circulaire et cooldown dans le chemin openWakeWord existant. `scripts/setup-openwakeword.mjs` délègue à `setup-voice-assets.mjs`. Un seul `onnxruntime-web` 1.31. Whisper et `jarvis-oww` inchangés.

## Micro 0.4.16 — à ne pas défaire

- Un seul `getUserMedia` (le service `microphone`), contraintes brutes, `getUserMedia` borné, reprise sur `ended` / `devicechange` / contrôle 5 s.
- `micError` ne contient que des échecs du micro, avec le nom exact de l’erreur. Jamais « Micro indisponible » seul.
- Le choix du micro s’applique tout de suite ; l’étape « Accès au micro » passe en premier dans « Tester la voix ».
- Autorisations : `setPermissionRequestHandler` (micro seul, depuis l’interface) **et** `setPermissionCheckHandler` (audio accordé, caméra refusée), décisions journalisées (`main/mediaPermissions.ts`).
- `backgroundThrottling: false` : la fenêtre masquée écoute toujours.
- Whisper ne tourne qu’après un réveil (ou en repli si Vosk manque). Depuis 0.4.17 il tourne dans un worker (voir « 0.4.17 ») ; s’il retombe dans la page, chaque inférence y bloque l’interface. Avec le déclencheur Whisper de 0.4.15, un son continu dans l’entrée retardait `getUserMedia` de 18 à 65 s (mesuré sur la VM).
