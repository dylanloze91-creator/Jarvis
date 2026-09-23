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
- 14 outils de contrôle du PC : lecture système (processus, fenêtre active, fichiers, journal d'événements) et actions (applications, fichiers, capture d'écran, commande shell)
- Modèle de permissions configurable par catégorie d'outils, avec un socle incompressible (suppression, élévation, commande arbitraire)
- Journal d'audit persistant de chaque exécution d'outil, consultable dans l'interface

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
packages/core/      Logique pure, sans aucune dépendance à Electron
  providers/        Interface LLMProvider et ses implémentations
  tools/            Tool Manager, validation et politique de risque
  agent/            Boucle appel du modèle → outils → relance
  history/          Contrat de persistance des conversations
  settings.ts       Schéma de configuration

apps/desktop/       Application Electron
  src/main/         Processus principal : fenêtre, tray, raccourci, IPC, outils
  src/preload/      Pont typé à surface minimale entre les deux processus
  src/renderer/     Interface React (Tailwind, composants shadcn/ui)
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

Quatorze outils au total. Ils suffisent à couvrir les demandes usuelles de pilotage du PC tout en prouvant que la boucle de confirmation, la politique de permissions et le journal d'audit fonctionnent de bout en bout.

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

### Prochaines étapes prévues

Vision de l'écran, commande et réponse vocales, mémoire personnelle, recherche Internet, automatisation (enchaîner plusieurs outils sans repasser par une confirmation à chaque étape quand la politique le permet), et connexion avec l'application de blocage de sites pour des commandes du type « active mon mode travail ».

La mémoire personnelle et la recherche Internet se branchent comme des outils. La voix et la vision se branchent au niveau de la couche provider et du processus principal.

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
