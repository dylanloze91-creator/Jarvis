# Jarvis

Assistant personnel intelligent pour Windows. Il vit dans la zone de notification, s'ouvre au clavier avec `Ctrl + Espace`, et peut agir sur l'ordinateur — mais uniquement à travers des outils que l'application contrôle.

Jarvis a un véritable accès au système : lire les processus, la fenêtre active, chercher et lire des fichiers sur tout le disque, ouvrir et fermer des applications, déplacer/copier/supprimer des fichiers, prendre une capture d'écran, et exécuter n'importe quelle commande shell — y compris avec élévation administrateur. Rien de tout cela ne passe directement par le modèle : chaque appel traverse le Tool Manager, qui valide les arguments, applique la politique de permissions de l'utilisateur, et journalise l'action.

## Ce qui fonctionne aujourd'hui

- Application Electron qui tourne en arrière-plan, avec icône de zone de notification
- Fenêtre flottante sans cadre, translucide, toujours au premier plan, qui s'ajuste à la hauteur du contenu
- Raccourci clavier global `Ctrl + Espace` pour ouvrir et fermer ; `Échap` pour masquer
- Conversation avec réponses en streaming et rendu markdown
- Historique des conversations, persisté sur disque et consultable dans l'interface
- Trois fournisseurs de modèle interchangeables, dont un mode démonstration hors ligne qui couvre tous les outils par mots-clés
- Boucle d'appel d'outils complète, avec demande de confirmation pour les actions sensibles
- Outils de contrôle du PC : lecture système (processus, fenêtre active, fichiers, journal d'événements) et actions (applications, fichiers, capture d'écran, commande shell)
- Accès à Internet : recherche web synthétisée avec ses sources, lecture d'une page pour creuser un résultat, cours de bourse d'une ou plusieurs entreprises nommées en langage naturel
- Modèle de permissions configurable par catégorie d'outils, avec un socle incompressible (suppression, élévation, commande arbitraire)
- Journal d'audit persistant de chaque exécution d'outil, consultable dans l'interface
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
  search/           Interface SearchProvider et ses implémentations (Wikipédia, Brave Search)
  market/           Interface MarketDataProvider et ses implémentations (Yahoo Finance, Finnhub)
  web/              Utilitaires purs partagés : extraction de texte lisible, sécurité des URL
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
- Chaque outil déclare un niveau de risque : `safe` s'exécute directement, `confirm` demande l'accord de l'utilisateur (sous réserve de la politique de permissions ci-dessous), `denied` n'est même pas exposé au modèle
- Les arguments produits par le modèle sont validés par un schéma Zod avant toute exécution
- La suppression de fichiers passe toujours par la corbeille du système (spécification XDG Trash sur Linux, `Microsoft.VisualBasic.FileIO.FileSystem` sur Windows, Finder sur macOS) — jamais d'effacement définitif
- `run_command` n'interprète jamais implicitement le shell (pas de pipes/redirections sournoises) sauf si `useShell` est explicitement demandé, et il tronque sa sortie et respecte un délai d'expiration
- La clé API reste sur la machine, dans le dossier de données utilisateur, jamais dans le dépôt

## Modèle de permissions

Le risque d'un outil (`safe` / `confirm` / `denied`) reste figé dans son code. Ce qui est configurable, c'est **si une confirmation est demandée** pour les outils `confirm`, par catégorie, dans les réglages :

| Catégorie | Outils concernés                                         | Politiques possibles                                                                     |
| --------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps`    | `open_application`, `close_application`                  | Toujours confirmer · Confirmer seulement les actions destructrices · Ne jamais confirmer |
| `files`   | `create_folder`, `move_file`, `copy_file`, `delete_file` | idem                                                                                     |
| `capture` | `take_screenshot`                                        | idem                                                                                     |

« Confirmer seulement les actions destructrices » laisse passer sans confirmation les appels sans risque de perte (ouvrir une application, déplacer un fichier sans écraser une destination existante) et continue de bloquer les autres (`close_application` avec `forceKill`, un déplacement avec `overwrite`).

**Trois choses restent incompressibles**, quelle que soit la politique choisie par l'utilisateur : la suppression de fichiers (`delete_file`), l'élévation administrateur et l'exécution de commande arbitraire (`run_command`). Ces outils déclarent `forceConfirm: true` et la fenêtre de confirmation le signale explicitement ; pour `run_command`, cette fenêtre affiche toujours la commande exacte qui sera exécutée. La logique complète est dans `packages/core/src/tools/permissions.ts`, testée unitairement dans `permissions.test.ts`.

## Journal d'audit

Chaque exécution d'outil — qu'elle réussisse, échoue ou soit refusée — est enregistrée : horodatage, nom de l'outil, arguments exacts, décision (`auto` / `approved` / `refused` / `blocked`), résultat et durée. Le journal est persisté sur disque (`audit-log.json` dans le dossier de données utilisateur) et consultable dans l'interface via l'icône dédiée. La construction de l'entrée d'audit (`buildAuditEntry`) et son stockage en mémoire (`InMemoryAuditLogStore`) vivent dans `packages/core/src/audit/`, testés unitairement ; la persistance sur disque (`FileAuditLogStore`) est dans `apps/desktop/src/main/audit-store.ts`.

## Outils livrés

Tous les outils ciblent Windows en priorité (processus, fenêtre active, registre d'applications, journal d'événements, élévation UAC…) mais dégradent proprement sur macOS et Linux : soit une implémentation alternative existe (corbeille, ouverture d'application, fermeture de processus), soit l'outil répond clairement qu'il n'est pas disponible plutôt que d'échouer bruyamment.

### Lecture — niveau `safe`

| Outil               | Rôle                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `get_system_info`   | Système, processeur, charge, mémoire, disque, temps de fonctionnement                              |
| `list_processes`    | Processus en cours avec CPU et mémoire, triables (`cpu`/`memory`/`name`) et filtrables par nom     |
| `get_active_window` | Fenêtre active et liste des applications qui ont une fenêtre ouverte                               |
| `search_files`      | Recherche de fichiers par nom ou motif (`*`, `?`), racine et profondeur paramétrables, tout disque |
| `read_file`         | Lecture d'un fichier texte, tronquée à un nombre de caractères configurable                        |
| `get_system_errors` | Erreurs et avertissements récents du journal d'événements Windows — spécifique à Windows           |
| `web_search`        | Recherche sur Internet, retourne des résultats synthétisés avec leurs sources                      |
| `fetch_page`        | Récupère une page web et en extrait le texte lisible, pour creuser un résultat ou lire une URL     |
| `get_stock_quote`   | Cours de bourse d'une ou plusieurs entreprises (nom ou symbole) : prix, variation, devise, heure   |

### Action — niveau `confirm`

| Outil               | Catégorie | Incompressible | Rôle                                                                                                                              |
| ------------------- | --------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `create_folder`     | `files`   | non            | Crée un dossier dans Documents, Bureau, Téléchargements ou le dossier personnel                                                   |
| `open_application`  | `apps`    | non            | Ouvre une application par son nom courant (« Chrome », « Photoshop »…), résolue sur le système                                    |
| `close_application` | `apps`    | non            | Ferme une application (fermeture propre, ou immédiate avec `forceKill`)                                                           |
| `move_file`         | `files`   | non            | Déplace ou renomme un fichier ou dossier                                                                                          |
| `copy_file`         | `files`   | non            | Copie un fichier ou dossier récursivement                                                                                         |
| `delete_file`       | `files`   | **oui**        | Envoie un fichier ou dossier à la corbeille (jamais un effacement définitif)                                                      |
| `take_screenshot`   | `capture` | non            | Capture l'écran (multi-écrans géré) et l'enregistre dans le dossier Images                                                        |
| `run_command`       | `shell`   | **oui**        | Exécute une commande shell arbitraire — délai d'expiration, sortie tronquée, code de retour, élévation administrateur optionnelle |

Dix-sept outils au total. Ils couvrent les demandes usuelles de pilotage du PC et d'accès à l'information, tout en prouvant que la boucle de confirmation, la politique de permissions et le journal d'audit fonctionnent de bout en bout.

## Accès à Internet : recherche et données boursières

`web_search` et `get_stock_quote` ne parlent jamais directement à un service externe : ils passent par une interface (`SearchProvider`, `MarketDataProvider`) et un registre, exactement comme `LLMProvider` pour les modèles. Le fournisseur actif est choisi dans les réglages, et il est possible d'en ajouter sans toucher aux outils.

### Recherche web (`web_search`, `fetch_page`)

| Fournisseur            | Clé                             | Choisi car…                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wikipédia** (défaut) | Aucune                          | API Wikimedia stable, documentée, et — contrairement à DuckDuckGo ou aux instances SearXNG testées, qui renvoient un défi anti-bot depuis un serveur — ne bloque pas les requêtes automatisées. Limite assumée : couverture strictement encyclopédique, pas d'actualité en temps réel ni de résultats commerciaux ou locaux (« meilleur restaurant près de moi » ne donnera rien de pertinent). |
| **Brave Search**       | Oui (offre gratuite disponible) | Couverture du web ouvert nettement plus large — actualité, avis, résultats locaux. À activer dès qu'une clé est disponible ; reste optionnel, jamais requis.                                                                                                                                                                                                                                    |

`fetch_page` n'a pas de fournisseur interchangeable : c'est une requête HTTP directe, protégée avant chaque tentative (y compris après une redirection) par un double filtre — vérification statique du protocole et de l'hôte, puis résolution DNS réelle pour rejeter toute adresse qui pointerait vers `localhost` ou un réseau privé (10.x, 172.16–31.x, 192.168.x, liens locaux…), y compris via un domaine public détourné (« DNS rebinding »). Les pages sont lues jusqu'à 2 Mo et le texte extrait est tronqué à 6000 caractères avant d'être transmis au modèle.

### Données boursières (`get_stock_quote`)

| Fournisseur                | Clé                                   | Choisi car…                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Yahoo Finance** (défaut) | Aucune                                | Points d'entrée non officiels (recherche par nom + cours), mais accessibles sans inscription : c'est ce qui permet à l'outil de fonctionner immédiatement après l'installation. Limite assumée : ces points d'entrée ne sont pas documentés publiquement, peuvent changer sans préavis et sont parfois limités en débit. |
| **Finnhub**                | Oui (offre gratuite avec inscription) | API officielle et documentée, quota généreux sur le plan gratuit : plus fiable dans la durée que Yahoo Finance. Reste optionnel : désactivé par défaut car il exige une inscription.                                                                                                                                     |

Les deux fournisseurs résolvent eux-mêmes un nom d'entreprise en langage naturel (« Nvidia ») en symbole boursier (« NVDA ») : l'outil accepte donc aussi bien un nom qu'un symbole, et jusqu'à cinq entreprises en une seule fois.

### Comportement commun aux deux abstractions

- Une panne réseau, une limite de débit (HTTP 429) ou une réponse vide produisent un message clair renvoyé au modèle — jamais une exception qui interromprait la conversation.
- Si le fournisseur choisi dans les réglages exige une clé absente, le registre bascule silencieusement sur le fournisseur par défaut (Wikipédia / Yahoo Finance) plutôt que d'échouer.
- Aucune clé n'est jamais committée : elles vivent uniquement dans `settings.json`, sur la machine de l'utilisateur.

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
  category: 'capture', // requis pour un outil `confirm` : catégorie utilisée par la politique de permissions
  isDestructive: false, // ou une fonction (input) => boolean pour un caractère destructeur variable
  schema: z.object({ display: z.number().int().min(0).default(0) }),
  summarize: () => "Capturer l'écran principal.",
  execute: async () => ({ ok: true, content: 'Capture enregistrée.' }),
});
```

Le niveau de risque déclenche la confirmation ; la catégorie détermine si l'utilisateur peut l'assouplir dans les réglages. Ajoute `forceConfirm: true` pour une action qui ne doit jamais pouvoir être assouplie (comme `delete_file` ou `run_command`), et `describeCommand` pour afficher une représentation exacte de l'action dans la fenêtre de confirmation. Il n'y a pas de code d'interface à écrire pour cela.

### Ajouter un fournisseur de modèle

Implémente l'interface `LLMProvider` dans `packages/core/src/providers/`, puis enregistre-la dans `createDefaultRegistry()`. Elle apparaît aussitôt dans les réglages.

Les backends compatibles OpenAI (Ollama, LM Studio, vLLM, OpenRouter, Groq) ne demandent aucun code : il suffit de renseigner l'URL de base dans les réglages.

### Ajouter un fournisseur de recherche ou de données boursières

Même principe que pour les modèles : implémente `SearchProvider` (dans `packages/core/src/search/providers/`) ou `MarketDataProvider` (dans `packages/core/src/market/providers/`), puis enregistre le résultat dans `createDefaultSearchRegistry()` ou `createDefaultMarketDataRegistry()`. Le nouveau fournisseur apparaît aussitôt dans le sélecteur des réglages ; les outils `web_search`, `fetch_page` et `get_stock_quote` n'ont besoin d'aucune modification.

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

Vision de l'écran, mémoire personnelle, automatisation (enchaîner plusieurs outils sans repasser par une confirmation à chaque étape quand la politique le permet), et connexion avec l'application de blocage de sites pour des commandes du type « active mon mode travail ».

La mémoire personnelle se branche comme un outil, à la manière de la recherche Internet. La vision se branche au niveau de la couche provider et du processus principal, sur le même principe que la commande vocale.

### Ce qui reste à valider sur une vraie machine Windows

Ce dépôt est développé et testé en continu sur Linux (typecheck, tests, lint, build, et l'interface elle-même via un serveur d'affichage X). Les outils suivants dépendent d'API Windows (PowerShell, App Paths, UAC, journal d'événements) et n'ont pu être validés que par relecture, pas par exécution réelle : `list_processes` (branche `Get-Process`), `get_active_window` (branche `user32.dll`), `get_system_errors`, `open_application`/`close_application` (résolution par nom sur Windows), la corbeille Windows (`Microsoft.VisualBasic.FileIO.FileSystem`), et surtout l'élévation administrateur de `run_command` (UAC via `Start-Process -Verb RunAs` + `-EncodedCommand`). Une passe de validation sur une machine Windows réelle est nécessaire avant de considérer ces chemins de code fiables en production.

## Développement

```bash
npm run dev         # application en mode développement
npm run build       # compilation complète
npm run typecheck   # vérification des types
npm run test        # tests unitaires du cœur
npm run lint        # analyse statique
```

En mode développement, la fenêtre ne se masque pas à la perte de focus, pour laisser travailler les outils de débogage. Le comportement de lanceur reprend dans l'application packagée.
