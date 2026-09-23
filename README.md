# Jarvis

Assistant personnel intelligent pour Windows. Il vit dans la zone de notification, s'ouvre au clavier avec `Ctrl + Espace`, et peut agir sur l'ordinateur — mais uniquement à travers des outils que l'application contrôle.

Ce dépôt contient le premier socle fonctionnel. Il est volontairement léger en fonctionnalités et solide en architecture : l'objectif est de pouvoir ajouter la voix, la vision de l'écran ou le pilotage d'autres applications sans rien réécrire.

## Ce qui fonctionne aujourd'hui

- Application Electron qui tourne en arrière-plan, avec icône de zone de notification
- Fenêtre flottante sans cadre, translucide, toujours au premier plan, qui s'ajuste à la hauteur du contenu
- Raccourci clavier global `Ctrl + Espace` pour ouvrir et fermer ; `Échap` pour masquer
- Conversation avec réponses en streaming et rendu markdown
- Historique des conversations, persisté sur disque et consultable dans l'interface
- Trois fournisseurs de modèle interchangeables, dont un mode démonstration hors ligne
- Boucle d'appel d'outils complète, avec demande de confirmation pour les actions sensibles
- Commande vocale : écoute permanente avec mot de réveil détecté localement (« Jarvis »), transcription, envoi automatique dans la conversation, réponse lue à voix haute et interruptible à tout moment

## Démarrer

```bash
npm install
npm run dev
```

L'application démarre en mode démonstration hors ligne : aucune clé API n'est nécessaire pour la prendre en main. Ouvre les réglages (icône engrenage) pour brancher un vrai modèle.

Pour produire l'installateur Windows :

```bash
npm run package:win
```

L'exécutable est généré dans `apps/desktop/release`.

## Architecture

```
Utilisateur → Assistant IA → Tool Manager → Outils autorisés → Windows
```

Le modèle ne touche jamais le système directement. Il ne voit que les outils enregistrés, ses arguments sont revalidés avant exécution, et les actions sensibles passent par l'utilisateur.

```
packages/core/      Logique pure, sans aucune dépendance à Electron, Node ou au DOM
  providers/        Interface LLMProvider et ses implémentations
  speech/           Interfaces SpeechToTextProvider / TextToSpeechProvider, registres,
                     moteurs OpenAI (Whisper, synthèse), détection locale du mot de réveil
  tools/            Tool Manager, validation et politique de risque
  agent/            Boucle appel du modèle → outils → relance
  history/          Contrat de persistance des conversations
  settings.ts       Schéma de configuration

apps/desktop/       Application Electron
  src/main/         Processus principal : fenêtre, tray, raccourci, IPC, outils, voix distante
  src/preload/      Pont typé à surface minimale entre les deux processus
  src/renderer/     Interface React (Tailwind, composants shadcn/ui)
    voice/          Micro, niveau sonore, moteurs locaux (navigateur), proxys IPC vers OpenAI
  src/shared/       Types d'IPC partagés par les trois processus
```

`packages/core` ne dépend ni d'Electron, ni de Node, ni du DOM. C'est délibéré : une future application iOS réutilisera ce package tel quel et n'aura à réécrire que la couche d'outils et l'interface.

### Sécurité

- `contextIsolation` activé, `nodeIntegration` désactivé, preload à surface minimale
- Chaque outil déclare un niveau de risque : `safe` s'exécute directement, `confirm` demande l'accord de l'utilisateur, `denied` n'est même pas exposé au modèle
- Les arguments produits par le modèle sont validés par un schéma Zod avant toute exécution
- Les outils de fichiers contraignent les chemins aux dossiers personnels
- La clé API reste sur la machine, dans le dossier de données utilisateur, jamais dans le dépôt

## Outils livrés

| Outil             | Risque    | Rôle                                                                            |
| ----------------- | --------- | ------------------------------------------------------------------------------- |
| `get_system_info` | `safe`    | Système, processeur, charge, mémoire, disque, temps de fonctionnement           |
| `create_folder`   | `confirm` | Crée un dossier dans Documents, Bureau, Téléchargements ou le dossier personnel |

Deux outils seulement, volontairement : ils suffisent à prouver que la boucle fonctionne de bout en bout, confirmation comprise.

## Commande vocale

```
Micro → détection locale du mot de réveil → capture de la phrase → silence détecté
      → transcription (SpeechToTextProvider) → conversation existante → réponse
      → synthèse (TextToSpeechProvider) → lecture, interruptible à tout moment
```

- **Le mot de réveil se détecte toujours localement et hors ligne**, quel que soit le
  moteur de transcription choisi ensuite : aucun audio ne quitte la machine avant sa
  détection. L'algorithme (`WakeWordDetector`, dans `packages/core/src/speech/wakeword.ts`)
  compare l'enveloppe d'énergie du flux audio à un gabarit enregistré une fois par
  l'utilisateur dans les réglages (« Calibrer le mot de réveil »). C'est volontairement
  simple pour un MVP : suffisant pour démontrer le mécanisme de bout en bout, mais
  remplaçable sans toucher au reste de l'application par un moteur dédié (Vosk, Porcupine,
  openWakeWord…) si une meilleure précision est nécessaire un jour.
- Une fois réveillé, l'application capture la phrase, détecte la fin de parole par
  silence, puis transcrit et envoie le texte dans la boucle de conversation **exactement
  comme un message tapé** — le reste de l'application (agent, outils, historique) ne sait
  pas que la phrase vient de la voix.
- La réponse de l'assistant peut être lue à voix haute, que le message d'origine ait été
  tapé ou parlé, avec un bouton pour couper la lecture à tout moment.
- Comme pour les modèles de langage, la transcription et la synthèse passent par des
  interfaces dédiées — `SpeechToTextProvider` et `TextToSpeechProvider`, dans
  `packages/core/src/speech/types.ts` — avec un registre par capacité
  (`SpeechToTextRegistry`, `TextToSpeechRegistry`). Deux moteurs sont livrés pour chacune :
  - **local (navigateur)** : Web Speech API pour la reconnaissance, `speechSynthesis` pour
    la synthèse — gratuit, sans clé, et **c'est le repli automatique** dès qu'aucune clé
    API n'est configurée ;
  - **OpenAI** : Whisper pour la transcription, l'API de synthèse d'OpenAI pour la voix.
- La clé API ne quitte jamais le processus principal. Les moteurs OpenAI vivent dans
  `packages/core` (comme les autres providers OpenAI : uniquement `fetch`, aucune
  dépendance DOM) mais sont appelés depuis le renderer via deux canaux IPC dédiés
  (`voice:transcribe`, `voice:speak`) qui portent la clé côté processus principal. Tout le
  reste — micro, mot de réveil, moteurs locaux — reste dans le renderer, sans IPC.
- Réglages disponibles : écoute permanente on/off, mot de réveil (texte + calibrage),
  microphone, moteur de reconnaissance, réponse vocale on/off, moteur de synthèse, voix, et
  une clé API OpenAI dédiée à la voix (facultative : elle réutilise celle du fournisseur de
  modèle si celui-ci est déjà OpenAI).

### Limites connues

- Electron ne fournit pas de clé Google API par défaut : la reconnaissance vocale du
  navigateur (`webkitSpeechRecognition`) peut donc échouer selon la version d'Electron. Le
  code signale cette erreur clairement plutôt que de rester silencieux ; si elle se
  confirme à l'usage, le remède est d'écrire un nouveau `SpeechToTextProvider` local basé
  sur un moteur embarqué (Vosk, whisper.cpp…) — l'abstraction est faite pour ça.
- Le mot de réveil doit être calibré une fois (bouton dans les réglages) avant que
  l'écoute permanente puisse le détecter ; sans gabarit enregistré, l'écoute reste active
  mais ne se réveille jamais toute seule (le champ de simulation de la barre vocale permet
  de tester le reste du pipeline en attendant).

## Étendre l'application

### Ajouter un outil

Écris un `defineTool` dans `apps/desktop/src/main/tools/`, puis ajoute-le au catalogue dans `tools/index.ts`. Rien d'autre n'est à modifier — ni l'agent, ni l'IPC, ni l'interface.

```ts
export const takeScreenshotTool = defineTool({
  name: 'take_screenshot',
  description: "Capture l'écran principal.",
  risk: 'confirm',
  schema: z.object({ display: z.number().int().min(0).default(0) }),
  summarize: () => "Capturer l'écran principal.",
  execute: async () => ({ ok: true, content: 'Capture enregistrée.' }),
});
```

Le niveau de risque suffit à déclencher la confirmation : il n'y a pas de code d'interface à écrire pour cela.

### Ajouter un fournisseur de modèle

Implémente l'interface `LLMProvider` dans `packages/core/src/providers/`, puis enregistre-la dans `createDefaultRegistry()`. Elle apparaît aussitôt dans les réglages.

Les backends compatibles OpenAI (Ollama, LM Studio, vLLM, OpenRouter, Groq) ne demandent aucun code : il suffit de renseigner l'URL de base dans les réglages.

### Ajouter un moteur vocal

Même principe que pour un fournisseur de modèle, une interface par capacité :

- **Reconnaissance (STT)** : implémente `SpeechToTextProvider` (`packages/core/src/speech/types.ts`).
  Si le moteur capture lui-même le micro (reconnaissance embarquée), mets
  `managesOwnCapture = true` et ignore les appels à `pushAudio` ; sinon (moteur qui reçoit
  l'audio, comme Whisper), mets-le à `false` et accumule les trames reçues jusqu'à `stop()`.
- **Synthèse (TTS)** : implémente `TextToSpeechProvider`. Même logique avec
  `managesOwnPlayback` : `true` si le moteur lit lui-même l'audio (voix système), `false`
  s'il renvoie des octets à jouer (API de synthèse distante).
- Enregistre le nouveau moteur dans le registre correspondant :
  - un moteur **sans DOM/micro réel** (un nouveau moteur cloud, par exemple) va dans
    `packages/core/src/speech/default-registries.ts`, comme `OpenAISttProvider` ;
  - un moteur qui **a besoin du DOM ou du micro** (reconnaissance embarquée locale
    alternative) va dans `apps/desktop/src/renderer/src/voice/registries.ts`, comme
    `LocalBrowserSttProvider`.
- S'il a besoin d'une clé API, expose-la dans `VoiceBridge`
  (`apps/desktop/src/main/voice.ts`) plutôt que dans le renderer : la clé ne doit jamais
  quitter le processus principal.

Le reste — `useVoice`, la barre d'état, les réglages — ne change pas : le nouveau moteur
apparaît dans les listes déroulantes dès qu'il est enregistré dans le registre.

### Prochaines étapes prévues

Vision de l'écran, mémoire personnelle, recherche Internet, contrôle avancé du PC (processus, fenêtre active, recherche de fichiers), automatisation, et connexion avec l'application de blocage de sites pour des commandes du type « active mon mode travail ».

La mémoire personnelle et la recherche Internet se branchent comme des outils. La vision se branche au niveau de la couche provider et du processus principal, sur le même principe que la commande vocale.

## Développement

```bash
npm run dev         # application en mode développement
npm run build       # compilation complète
npm run typecheck   # vérification des types
npm run test        # tests unitaires du cœur
npm run lint        # analyse statique
```

En mode développement, la fenêtre ne se masque pas à la perte de focus, pour laisser travailler les outils de débogage. Le comportement de lanceur reprend dans l'application packagée.
