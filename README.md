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

**Objectif de conception : toute la chaîne doit pouvoir fonctionner à zéro euro.** Les
options payantes (Porcupine, OpenAI) restent des améliorations facultatives, jamais un
passage obligé — voir le tableau de coûts en fin de section pour l'état réel, honnête, de
chaque brique.

### Mot de réveil : Whisper par transcription, par défaut

Le mot de réveil se détecte **toujours localement et hors ligne**, quel que soit le
moteur choisi : aucun audio ne quitte la machine avant sa détection (ni jamais, dans le cas
du moteur par défaut — voir plus bas). C'est la seule brique de la chaîne vocale qui n'a pas
de version « cloud » — juste des moteurs locaux de qualité différente, derrière une
interface dédiée, `WakeWordEngine` (`packages/core/src/speech/wakewordEngine.ts`), avec son
propre registre (`WakeWordEngineRegistry`), sur le même principe que
`SpeechToTextProvider` et `TextToSpeechProvider`.

- **Whisper local, par transcription (`whisper-transcript`, moteur par défaut, gratuit,
  sans compte)** — le gabarit par énergie (ci-dessous) ne compare que des _volumes_ dans le
  temps, sans aucune information spectrale : vérifié peu fiable en conditions réelles (le
  mot de réveil ne se déclenchait pas de façon fiable avec un vrai micro). `WhisperWakeWordEngine`
  (`apps/desktop/src/renderer/src/voice/whisperWakeWordEngine.ts`) fait tourner Whisper sur
  de courtes fenêtres glissantes (1,6 s) et cherche le mot de réveil dans le texte produit
  (`evaluateWakeWordWindow` + `matchesWakeWord`, cœur pur et testable dans `packages/core`).
  Trois précautions contre un usage CPU excessif en écoute permanente : une garde d'énergie
  (aucune transcription tentée sur une fenêtre silencieuse), un intervalle minimal entre deux
  analyses, et une seule analyse en vol à la fois. La comparaison texte tolère les fautes de
  transcription fréquentes (« jarviss », « djarvis », « javice »…) via une liste de variantes
  extensible dans les réglages, plus une distance d'édition pour les fautes imprévues —
  **volontairement pas appliquée à la liste intégrée elle-même** : vérifié contre le
  dictionnaire français `hunspell-fr` (~81 000 mots), l'appliquer aussi à cette liste créait
  144 collisions (« paris », « avis »…) ; restreinte au seul mot canonique, une seule
  subsiste (« parvis »), documentée dans le code plutôt que corrigée en douce.
  **Constat vérifié sur deux enregistrements réels** (voix humaine, pas un synthétiseur) :
  le modèle `tiny` hallucine systématiquement une phrase sans rapport, quelle que soit la
  langue forcée — `base` est donc le plus petit modèle qui fonctionne vraiment pour cette
  tâche, pas `tiny`. Autre constat contre-intuitif mais vérifié : Whisper décode mieux
  « Jarvis » — un nom propre sans entrée lexicale française — en forçant la langue anglaise
  qu'en français, où le modèle le rabat sur le mot français le plus proche phonétiquement
  (« j'avise »). Voir `packages/core/src/speech/whisperModels.ts` pour le détail et les
  sources de ces deux choix.
- **Gabarit local par énergie (`local-template`, gratuit, sans compte, mais peu fiable)** —
  reste une option pour qui préférerait éviter tout usage de Whisper, ou sur une machine où
  le coût CPU de la transcription en continu serait rédhibitoire : `WakeWordDetector`
  (`packages/core/src/speech/wakeword.ts`) compare l'enveloppe d'énergie du flux audio à un
  ou plusieurs échantillons enregistrés par l'utilisateur (comparés au **meilleur** gabarit
  ou à leur **moyenne**), avec un réglage de sensibilité et un score en temps réel pour
  calibrer. L'interface des réglages l'indique désormais clairement comme peu fiable.
- **Porcupine (Picovoice), en option, jamais le défaut** — reconnaît le mot-clé « jarvis »
  sans aucune calibration (mot-clé intégré au SDK). Techniquement propre à intégrer : le
  SDK web (`@picovoice/porcupine-web`, WebAssembly) se charge par un `import()` dynamique
  dans `apps/desktop/src/renderer/src/voice/porcupineWakeWordEngine.ts`, donc **n'alourdit
  pas le bundle principal** (vérifié : le build en fait un chunk séparé, chargé seulement si
  ce moteur est choisi). Ce qui a changé, et pourquoi ce n'est pas le défaut : **Picovoice a
  mis fin à son offre gratuite le 30 juin 2026** (annonce officielle confirmée par plusieurs
  utilisateurs sur le forum Home Assistant, et par la réponse du support Picovoice
  lui-même : _« the AccessKey is validated when the engine is initialized, before offline
  data processing […] there is no non-commercial tier planned »_). Concrètement, aujourd'hui,
  pour un usage personnel : il faut un abonnement payant auprès de Picovoice (carte bancaire
  requise), la clé est vérifiée en ligne à chaque initialisation même si le traitement audio
  qui suit est local, et aucune offre non commerciale n'est prévue. Le champ « clé d'accès »
  des réglages l'indique explicitement. Sans clé, l'application repasse automatiquement sur
  le gabarit local. Le fichier de modèle Porcupine (`porcupine_params.pv`, ~1 Mo,
  propriété de Picovoice) n'est ni fourni ni commité — voir
  `apps/desktop/src/renderer/public/porcupine/README.md` pour l'obtenir si tu choisis
  malgré tout cette option.

### Reconnaissance (STT) : Whisper local, gratuit, par défaut

Une fois réveillé, l'application capture la phrase, détecte la fin de parole par silence,
transcrit, puis envoie le texte dans la boucle de conversation **exactement comme un
message tapé** — le reste de l'application (agent, outils, historique) ne sait pas que la
phrase vient de la voix. La transcription passe par `SpeechToTextProvider`
(`packages/core/src/speech/types.ts`) et son registre (`SpeechToTextRegistry`).

**Constat vérifié, pas supposé : la reconnaissance vocale du navigateur
(`webkitSpeechRecognition`) ne fonctionne pas dans Electron — jamais, pas seulement
« parfois ».** Electron ne distribue pas la clé Google API que Chrome utilise pour son
service de reconnaissance cloud, et sa version « on-device » plus récente est
explicitement désactivée dans Electron (elle renvoie `kUnavailable`, voir la PR
[electron/electron#52955](https://github.com/electron/electron/pull/52955)) — résultat
constaté et documenté par de nombreux utilisateurs
([electron/electron#46143](https://github.com/electron/electron/issues/46143),
[#31732](https://github.com/electron/electron/issues/31732)) : une erreur `network`
systématique. **Ce moteur a été retiré** du registre STT de `apps/desktop` (le fichier
`localStt.ts` n'existe plus) : le laisser choisissable n'aurait fait que tendre un piège à
l'utilisateur pour un moteur qui ne peut structurellement pas fonctionner.

#### Whisper local (`local-whisper`), via `@huggingface/transformers` (transformers.js)

C'est désormais le moteur gratuit par défaut, et il fonctionne réellement — vérifié sur des
enregistrements réels, pas seulement sur des tests unitaires (voir « Preuves » ci-dessous).
Pur WebAssembly (avec accélération WebGPU quand le navigateur l'expose, repli WebAssembly
sinon) : aucune compilation native, aucun binaire à installer, contrairement à toutes les
pistes suivantes, évaluées puis rejetées lors d'une passe précédente pour cette raison
précise :

| Piste testée                                                  | Verdict                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vosk` (npm)                                                  | Rejeté — dernier publié en 2022, dépend de `ffi-napi`/`ref-napi`, aucune garantie de fonctionner avec le Node d'Electron 44.                                                                                                                                                                              |
| `nodejs-whisper`, `smart-whisper` (bindings whisper.cpp)      | Rejetés — compilent whisper.cpp _à l'installation_ via `node-gyp`/CMake ; sur Windows, `nodejs-whisper` exige explicitement MinGW-w64/MSYS2.                                                                                                                                                              |
| `@echogarden/whisper.cpp-binding`                             | Rejeté en pratique — binaire précompilé réel (2,5 Mo, MIT) mais binding minimal sans tokenisation ni spectrogramme : l'utiliser proprement suppose de dépendre du paquet complet `echogarden`, avec des dizaines de dépendances sans rapport.                                                             |
| `@huggingface/transformers` + `onnxruntime-web` (cette passe) | **Retenu.** Pur WebAssembly/WebGPU, aucune compilation native. L'obstacle n'était pas technique mais d'empaquetage : le binaire WASM d'`onnxruntime-web` (~27 Mo avec WebGPU) est copié par Vite dès que le paquet est importé localement — voir « Pourquoi charger le moteur depuis un CDN » ci-dessous. |

**Choix de modèle, vérifié sur des enregistrements réels (pas supposé) :**

- `WHISPER_STT_MODELS` (`packages/core/src/speech/whisperModels.ts`) propose trois tailles
  pour la **dictée**, réglables dans les réglages, avec taille et vitesse indiquées :
  `tiny` (≈ 40 Mo, rapide mais médiocre en français), `base` (≈ 75 Mo, **défaut**, bon
  compromis) et `small` (≈ 245 Mo, meilleure qualité mais lent sans GPU).
- Le **mot de réveil**, lui, n'est **pas** configurable sur ce point : `tiny` a été mesuré
  insuffisant pour cette tâche précise — il hallucine systématiquement une phrase sans
  rapport sur les deux enregistrements réels utilisés pour vérifier — donc `base` est
  utilisé quel que soit le modèle choisi pour la dictée. Un modèle plus petit économiserait
  du CPU mais ne détecterait jamais rien : le choisir serait mentir sur la fiabilité pour
  gagner en vitesse.
- Whisper décode mieux « Jarvis » en forçant la langue **anglaise** qu'en français (constat
  vérifié, pas une supposition) : un nom propre sans entrée lexicale française se fait
  sinon rabattre sur le mot français phonétiquement le plus proche (« j'avise »). La
  dictée, elle, reste forcée en français.

**Architecture : transcrire l'énoncé complet, retirer le mot de réveil du texte.** Une
première version découpait l'audio à l'instant précis de la détection du mot de réveil.
Hypothèse testée puis infirmée : ce découpage tombait dans le silence qui suit le mot de
réveil, avant l'attaque du mot suivant — il n'amputait donc pas la commande. Transcrire
l'énoncé complet (mot de réveil compris) reste néanmoins l'architecture retenue : plus de
contexte pour Whisper, meilleure reconnaissance du mot de réveil lui-même (vérifié : «
Jarvis » reconnu correctement en contexte de phrase complète, contre « Javis »/« j'avise »
isolé). `WhisperWakeWordEngine.getLastAnalyzedWindow()` expose l'audio qui a déclenché la
détection ; `useVoice.ts` le transmet en préfixe au moteur de dictée
(`SpeechToTextController.markPrefixEnd()` marque où il s'arrête, pour que la garde
anti-hallucination sur un énoncé silencieux — voir plus bas — ne porte que sur l'audio
réellement capturé après, jamais sur le préfixe qui contient forcément de la parole) ; le
mot de réveil est ensuite retiré du **texte** obtenu (`stripLeadingWakeWord`, dans
`packages/core`), jamais de l'audio.

**Garde anti-hallucination.** Whisper, comme tout modèle de ce type, peut halluciner une
phrase sans rapport en boucle sur du bruit de fond pur — vérifié en pratique sur un énoncé
« mot de réveil, puis silence ». `LocalWhisperSttProvider` vérifie l'amplitude de crête de
l'audio capturé après le préfixe avant de solliciter Whisper ; en dessous d'un seuil,
aucune transcription n'est tentée (`onFinal('')`, traité comme « rien à dire »).

**Limite constatée et non maquillée : la qualité de la dictée locale reste imparfaite sur
certaines prononciations.** Sur l'enregistrement réel utilisé pour vérifier l'architecture
(« Jarvis, ouvre Chrome »), le mot de réveil est détecté et retiré correctement, mais
« ouvre » est systématiquement transcrit « ouf »/« off »/« oof » — testé sur 14
configurations (`base` et `small`, français et anglais, avec ou sans découpage de l'audio,
ré-échantillonnage haute qualité, normalisation de volume), même résultat partout. Ce n'est
pas un bug de découpage — l'hypothèse a été vérifiée puis infirmée par des tests
reproductibles — mais une limite réelle des modèles Whisper `base`/`small` sur cette
prononciation précise (cohérente avec « Jarvis » lui-même entendu comme « j'avise » :
consonnes affaiblies à l'articulation ou à la captation). Documenté ici plutôt que corrigé
en élargissant la tolérance de correspondance texte jusqu'à ce que ce cas précis passe —
ce qui aurait été trompeur.

#### Pourquoi charger le moteur depuis un CDN, pas le paquet npm local

`@huggingface/transformers` (`devDependency`, jamais empaqueté dans l'installateur — voir
plus bas) est importé par une URL complète vers jsDelivr
(`voice/whisper/pipelineLoader.ts`), l'hébergement officiellement documenté par le projet
pour un usage sans bundler, plutôt que par son nom de paquet. Raison précise, vérifiée
plutôt que supposée : le paquet `onnxruntime-web` référence son binaire WASM via
`new URL(..., import.meta.url)`, un motif que Vite/Rollup détecte **statiquement** à la
compilation et copie dans le paquet final — indépendamment de tout `import()` dynamique ou
de toute configuration au runtime. Pour la variante avec accélération WebGPU (celle
retenue ici), ce binaire pèse environ 27 Mo à lui seul.

Expérience refaite pour trancher, avec les chiffres exacts : importer le paquet localement
et forcer la variante WebAssembly la plus légère (sans WebGPU, ~14 Mo) donne un
installateur de 101,49 Mio ; retirer en plus le rendu Vulkan de Chromium (SwiftShader et son
chargeur, ~6,4 Mo) le fait redescendre à 99,95 Mio — sous la limite de 100 Mio, mais avec une
marge de 51 Kio seulement, et au prix du WebGPU **et** du Vulkan. Le chargement par CDN
donne 98,98 Mio avec WebGPU et Vulkan intacts, et une marge d'environ 1 Mio. Le compromis a
été tranché en faveur du CDN pour cette raison précise, pas par facilité.

Le hors-ligne après premier usage n'est pas qu'une intention : jsDelivr renvoie
`Cache-Control: public, max-age=31536000, immutable` sur l'URL versionnée (jamais réécrite
pour une version donnée) — un an de cache, sans revalidation. L'application n'utilise
aucune session Electron personnalisée (pas de partition, pas de session en mémoire) : c'est
la session persistante par défaut, dont le cache disque survit aux redémarrages. Après le
tout premier chargement réussi (qui nécessite une connexion Internet, comme pour les poids
du modèle ci-dessous), la bibliothèque elle-même est donc servie du disque local — même
garantie que pour les poids du modèle, pas une garantie plus faible.

**Modèle non embarqué, téléchargé et mis en cache au premier usage.** Les poids du modèle
Whisper choisi (dépôts `Xenova/whisper-*` sur Hugging Face) ne sont, eux non plus, jamais
inclus dans l'installateur : `pipeline()` les télécharge au premier appel pour un modèle
donné, et transformers.js les met en cache lui-même (Cache API du navigateur) — les
lancements suivants sont hors ligne. Une progression de téléchargement (pourcentage, taille
transférée) est affichée dans les réglages (bouton « Préparer maintenant », avec barre de
progression) et dans la barre vocale pendant l'utilisation, pour ne jamais laisser
l'application sembler bloquée pendant ce premier téléchargement.

Whisper via l'API OpenAI (`openai-whisper`, cloud, payant à l'usage — de l'ordre de
0,006 $/minute) reste disponible comme option plus précise, jamais requise.

### Synthèse (TTS) : gratuite et vérifiée, via les voix Windows

Contrairement à la reconnaissance, la synthèse vocale du navigateur (`speechSynthesis`)
**fonctionne dans Electron** : elle ne dépend pas des serveurs de Google, seulement des voix
installées par le système d'exploitation (SAPI / OneCore sur Windows), exposées à
Chromium par Electron depuis la correction de
[electron/electron#14070](https://github.com/electron/electron/pull/14070) (Chromium ≥ 70,
largement dépassé par la version embarquée dans Electron 44). C'est le moteur `browser-local`
côté synthèse (`LocalBrowserTtsProvider`), et il reste le moteur par défaut de
l'application : gratuit, sans clé, aucune dépendance réseau. Nuance à garder en tête : si
Windows n'a que des voix OneCore récentes et aucune voix SAPI classique installée, la liste
peut apparaître vide selon la configuration — dans ce cas, installer une voix depuis les
paramètres vocaux de Windows résout le problème. L'API de synthèse d'OpenAI
(`openai-tts`, payante) reste disponible comme option, jamais requise.

### Frontière clé API / IPC

La clé API ne quitte jamais le processus principal. Les moteurs OpenAI (STT et TTS) vivent
dans `packages/core` (comme les autres providers OpenAI : uniquement `fetch`, aucune
dépendance DOM) mais sont appelés depuis le renderer via deux canaux IPC dédiés
(`voice:transcribe`, `voice:speak`) qui portent la clé côté processus principal. Tout le
reste — micro, mot de réveil (local et Porcupine), synthèse locale — reste dans le
renderer, sans IPC, puisqu'aucune clé n'y est nécessaire.

### Réglages disponibles

Écoute permanente on/off ; mot de réveil (texte, variantes orthographiques extensibles,
échantillons pour le gabarit par énergie, sensibilité, test en direct) ; moteur de détection
(Whisper local / gabarit par énergie / Porcupine) et sa clé d'accès ; microphone ; moteur de
reconnaissance (STT), avec taille de modèle Whisper et statut de téléchargement quand ce
moteur est choisi ; réponse vocale on/off ; moteur de synthèse (TTS) et voix ; une clé API
OpenAI dédiée à la voix (facultative : elle réutilise celle du fournisseur de modèle si
celui-ci est déjà OpenAI).

### Coût réel de chaque brique, résumé

| Brique                     | Moteur par défaut                                | Coût par défaut | Option payante                                     |
| -------------------------- | ------------------------------------------------ | --------------- | -------------------------------------------------- |
| Détection du mot de réveil | Whisper local, par transcription                 | **0 €**         | Porcupine — abonnement payant depuis le 30/06/2026 |
| Transcription (STT)        | Whisper local (`local-whisper`, transformers.js) | **0 €**         | OpenAI Whisper — ≈ 0,006 $/minute, plus précis     |
| Réponse vocale (TTS)       | Voix du système (Windows)                        | **0 €**         | OpenAI (synthèse) — payant à l'usage               |

### Limites connues

- La reconnaissance vocale du navigateur ne fonctionne pas dans Electron (voir ci-dessus) :
  c'est une limite d'Electron, pas de ce code — le moteur correspondant a été retiré plutôt
  que laissé comme piège.
- Le premier lancement de la commande vocale (mot de réveil ou dictée, quel que soit l'ordre)
  nécessite une connexion Internet, le temps de charger le moteur Whisper (bibliothèque,
  ~1,3 Mo compressés, depuis un CDN) et de télécharger le modèle choisi (40 à 245 Mo selon
  la taille). Les lancements suivants sont hors ligne — voir la section « Pourquoi charger
  le moteur depuis un CDN » ci-dessus pour le détail et les garanties de mise en cache.
- Sur l'enregistrement réel utilisé pour vérifier l'architecture, la commande qui suit le
  mot de réveil (« ouvre Chrome ») reste imparfaitement transcrite (« ouf chrome ») malgré
  un mot de réveil correctement détecté et retiré du texte — limite documentée dans la
  section « Reconnaissance (STT) » ci-dessus, pas maquillée.
- Le gabarit par énergie (option, plus le défaut) doit être calibré (échantillons, bouton
  dans les réglages) avant de pouvoir détecter quoi que ce soit ; sans gabarit enregistré,
  l'écoute reste active mais ne se réveille jamais toute seule.
- Porcupine n'a pas pu être testé de bout en bout : sa formule gratuite ayant disparu,
  aucune clé d'accès valide n'était disponible pour vérifier la détection réelle (seul le
  chemin d'erreur sans clé a pu être vérifié).

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
- **Mot de réveil** : implémente `WakeWordEngine` (`packages/core/src/speech/wakewordEngine.ts`).
  `managesOwnCapture` a le même rôle que pour le STT. Contrairement aux deux autres
  capacités, il n'y a pas de « registre par défaut avec repli sur le cloud » : le repli va
  toujours vers un moteur local (`requiresApiKey: false`), jamais vers un service distant —
  la détection doit rester locale et hors ligne dans tous les cas.
- Enregistre le nouveau moteur dans le registre correspondant :
  - un moteur **sans DOM/micro réel** (un nouveau moteur cloud, par exemple) va dans
    `packages/core/src/speech/default-registries.ts`, comme `OpenAISttProvider` ou
    `LocalTemplateWakeWordEngine` (celui-ci n'a pas besoin du DOM : il ne fait que des
    calculs sur les trames qu'on lui pousse) ;
  - un moteur qui **a besoin du DOM, du micro ou du WebAssembly** (Porcupine, Whisper
    local…) va dans `apps/desktop/src/renderer/src/voice/registries.ts`, comme
    `LocalWhisperSttProvider` ou `PorcupineWakeWordEngine`. Charge-le en `import()`
    dynamique si le SDK est volumineux, pour ne pas alourdir le bundle principal — voir
    `porcupineWakeWordEngine.ts` pour l'exemple ; si le SDK embarque en plus un binaire WASM
    référencé via `new URL(..., import.meta.url)` (le cas d'`onnxruntime-web`, dépendance de
    transformers.js), Vite le détecte et le copie **statiquement**, indépendamment du
    caractère dynamique de l'`import()` — un `import()` d'une URL complète (CDN) reste, lui,
    entièrement opaque pour le bundler : voir `whisper/pipelineLoader.ts` et la section
    « Pourquoi charger le moteur depuis un CDN » plus haut pour le compromis retenu.
- S'il a besoin d'une clé API, expose-la dans `VoiceBridge`
  (`apps/desktop/src/main/voice.ts`) plutôt que dans le renderer : la clé ne doit jamais
  quitter le processus principal. Exception : les clés de moteurs qui tournent entièrement
  dans le renderer en WebAssembly (comme Porcupine) restent forcément côté renderer,
  puisque c'est là que le SDK s'exécute ; ce n'est acceptable que si le SDK ne fait
  transiter la clé vers aucun autre tiers que son propre fournisseur.

Le reste — `useVoice`, la barre d'état, les réglages — ne change pas : le nouveau moteur
apparaît dans les listes déroulantes dès qu'il est enregistré dans le registre.

### Prochaines étapes prévues

Vision de l'écran, mémoire personnelle, automatisation (enchaîner plusieurs outils sans repasser par une confirmation à chaque étape quand la politique le permet), et connexion avec l'application de blocage de sites pour des commandes du type « active mon mode travail ».

La mémoire personnelle se branche comme un outil, à la manière de la recherche Internet. La vision se branche au niveau de la couche provider et du processus principal, sur le même principe que la commande vocale.

### Ce qui reste à valider sur une vraie machine Windows

Ce dépôt est développé et testé en continu sur Linux (typecheck, tests, lint, build, et l'interface elle-même via un serveur d'affichage X). Les outils suivants dépendent d'API Windows (PowerShell, App Paths, UAC, journal d'événements) et n'ont pu être validés que par relecture, pas par exécution réelle : `list_processes` (branche `Get-Process`), `get_active_window` (branche `user32.dll`), `get_system_errors`, `open_application`/`close_application` (résolution par nom sur Windows), la corbeille Windows (`Microsoft.VisualBasic.FileIO.FileSystem`), et surtout l'élévation administrateur de `run_command` (UAC via `Start-Process -Verb RunAs` + `-EncodedCommand`). Une passe de validation sur une machine Windows réelle est nécessaire avant de considérer ces chemins de code fiables en production.

Côté Whisper local, vérifié dans Electron sur Linux (téléchargement du modèle, progression,
transcription réelle sur deux enregistrements réels — voir la section « Reconnaissance
(STT) ») mais pas encore sur Windows : le chemin WebGPU (`navigator.gpu`, non exposé dans ce
conteneur) n'a été exercé qu'en repli WebAssembly ; à vérifier sur une machine Windows avec
une carte graphique compatible. La suppression du rendu logiciel Vulkan de Chromium
(`vk_swiftshader.dll`) — évaluée puis écartée pour cette livraison, voir plus haut — reste
une piste si l'installateur doit encore être allégé à l'avenir, mais nécessite un test réel
sur une machine sans pilote GPU pour être validée sans risque.

Côté voix, deux points précis restent à valider sur Windows, avec un vrai microphone : la qualité pratique du gabarit local (seuils de sensibilité par défaut, nombre d'échantillons nécessaires en conditions réelles) et la liste des voix `speechSynthesis` réellement exposées (SAPI vs OneCore, voir la section « Commande vocale »). Porcupine n'a pas pu être testé du tout, faute de clé d'accès valide (formule gratuite disparue) — voir la section correspondante.

## Développement

```bash
npm run dev         # application en mode développement
npm run build       # compilation complète
npm run typecheck   # vérification des types
npm run test        # tests unitaires du cœur
npm run lint        # analyse statique
```

En mode développement, la fenêtre ne se masque pas à la perte de focus, pour laisser travailler les outils de débogage. Le comportement de lanceur reprend dans l'application packagée.
