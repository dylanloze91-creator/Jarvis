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
- Accès à Internet : recherche web synthétisée avec ses sources, lecture d'une page pour creuser un résultat, cours de bourse d'une ou plusieurs entreprises nommées en langage naturel

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
  search/           Interface SearchProvider et ses implémentations (Wikipédia, Brave Search)
  market/           Interface MarketDataProvider et ses implémentations (Yahoo Finance, Finnhub)
  web/              Utilitaires purs partagés : extraction de texte lisible, sécurité des URL
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
- Chaque outil déclare un niveau de risque : `safe` s'exécute directement, `confirm` demande l'accord de l'utilisateur, `denied` n'est même pas exposé au modèle
- Les arguments produits par le modèle sont validés par un schéma Zod avant toute exécution
- Les outils de fichiers contraignent les chemins aux dossiers personnels
- La clé API reste sur la machine, dans le dossier de données utilisateur, jamais dans le dépôt

## Outils livrés

| Outil             | Risque    | Rôle                                                                                                                     |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `get_system_info` | `safe`    | Système, processeur, charge, mémoire, disque, temps de fonctionnement                                                    |
| `create_folder`   | `confirm` | Crée un dossier dans Documents, Bureau, Téléchargements ou le dossier personnel                                          |
| `web_search`      | `safe`    | Recherche sur Internet, retourne des résultats synthétisés avec leurs sources                                            |
| `fetch_page`      | `safe`    | Récupère une page web et en extrait le texte lisible, pour creuser un résultat de recherche ou lire une URL donnée       |
| `get_stock_quote` | `safe`    | Cours de bourse d'une ou plusieurs entreprises (nom en langage naturel ou symbole) : prix, variation, devise, horodatage |

`get_system_info` et `create_folder` suffisent à prouver que la boucle fonctionne de bout en bout, confirmation comprise. Les trois outils d'accès à Internet montrent comment brancher un service externe derrière une abstraction interchangeable (voir ci-dessous).

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

### Ajouter un fournisseur de recherche ou de données boursières

Même principe que pour les modèles : implémente `SearchProvider` (dans `packages/core/src/search/providers/`) ou `MarketDataProvider` (dans `packages/core/src/market/providers/`), puis enregistre le résultat dans `createDefaultSearchRegistry()` ou `createDefaultMarketDataRegistry()`. Le nouveau fournisseur apparaît aussitôt dans le sélecteur des réglages ; les outils `web_search`, `fetch_page` et `get_stock_quote` n'ont besoin d'aucune modification.

### Prochaines étapes prévues

Vision de l'écran, commande et réponse vocales, mémoire personnelle, contrôle avancé du PC (processus, fenêtre active, recherche de fichiers), automatisation, et connexion avec l'application de blocage de sites pour des commandes du type « active mon mode travail ».

La mémoire personnelle se branche comme un outil, à la manière de la recherche Internet livrée dans cette version. La voix et la vision se branchent au niveau de la couche provider et du processus principal.

## Développement

```bash
npm run dev         # application en mode développement
npm run build       # compilation complète
npm run typecheck   # vérification des types
npm run test        # tests unitaires du cœur
npm run lint        # analyse statique
```

En mode développement, la fenêtre ne se masque pas à la perte de focus, pour laisser travailler les outils de débogage. Le comportement de lanceur reprend dans l'application packagée.
