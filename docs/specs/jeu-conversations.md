# Cahier — le jeu d'entraînement tiré des conversations

16 novembre 2026. Décision de l'utilisateur : « récupérer chaque conversation afin de réentraîner nos modèles » sur carte louée. Mission Cursor n° 6, **pour Jarvis Test** (Live ne reçoit que des corrections).

## Pourquoi

On n'entraîne que sur l'usage réel. Jarvis garde déjà chaque discussion (`userData/conversations/*.json`), mais il manque deux choses :

1. **Le journal du tour.** Aujourd'hui, une conversation ne dit pas qui a répondu : ni l'équipe, ni le modèle, ni le fournisseur, ni la durée. `routeLog` est lu par le trieur (`trieur/extract.ts`), mais **aucun code ne l'écrit**. Sans le nom du modèle, on ne sait pas si une réponse a le droit d'entrer dans un jeu d'entraînement.
2. **La préparation.** Il faut transformer ces conversations en exemples propres : bons tours gardés, ratés mis de côté pour correction, rien d'interdit.

## Partie A — le journal du tour (dans l'appli, Jarvis Test)

À la fin de chaque tour, `session.ts` ajoute à la conversation enregistrée une entrée `turnLog` (facultative, **sans défaut Zod**, absente des anciennes conversations) :

```ts
interface TurnLogEntry {
  userMessageId: string;
  assistantMessageIds: string[];   // réponse(s) et messages d'outil de ce tour
  team: string | null;             // équipe du chef d'orchestre, null = chat d'avant
  how: string | null;              // calcul exact | horloge | express | trieur | cerveau | null
  provider: string;                // ollama | openai | anthropic | mock | aucun (sans modèle)
  model: string | null;            // ex. qwen2.5:7b ; null si aucun modèle
  place: 'carte' | 'processeur' | null;
  source: 'texte' | 'voix' | 'telephone' | 'enceinte';
  tools: { name: string; status: string }[];
  durationMs: number;
  at: number;
}
```

- `routeLog` est rempli en même temps (même équipe, même `how`) : le trieur s'en sert déjà.
- Rien d'autre ne change : mêmes prompts, mêmes réponses, aucun appel de plus. `chat-unchanged`, `orchestra-session` et les autres tests figés restent verts **sans régénération**.
- Actif dans **Jarvis Test** seulement (comme le carnet). Dans Live, rien n'est écrit. On l'activera dans Live quand il aura fait ses preuves.
- Aucune phrase ni réponse n'est recopiée ailleurs : le journal vit dans le fichier de la conversation.

## Partie B — la préparation (script du cœur, sans modèle, sans réseau)

```
npm run conversations:preparer --workspace @jarvis/core -- \
  --conversations <dossier> [--conversations <autre>] [--carnet <rates.jsonl>] \
  [--dir C:\dev\jarvis-data] [--validation 0.1] [--seed 5066]
```

Plus `scripts/conversations-preparer.ps1` (UTF-8 **avec BOM**), qui trouve seul les dossiers de Live et de Test, comme `carte-utilisation.ps1`.

Les sources sont lues en **lecture seule**, avec la même garde que la carte (`refuserEcritureDansSource`). Sorties dans `<dir>\conversations\`, **jamais dans le dépôt** :

| Fichier | Contenu |
| --- | --- |
| `trieur.jsonl` | phrase de l'utilisateur → équipe, quand le tour n'a pas raté. Même format que le cahier du trieur (`trieur:preparer` doit pouvoir le lire). |
| `reponses.jsonl` | exemples de conversation au format d'entraînement de `training/` : `messages` (système court de l'équipe, au plus 4 échanges d'avant, la demande, la réponse, et les `tool_calls` et résultats d'outils s'il y en a) et `tools` (catalogue de l'équipe). |
| `a-corriger.jsonl` | les tours ratés, avec leur contexte, la cause notée par le carnet et une case `correction` vide. |
| `ecartes.jsonl` | ce qui a été écarté, avec sa raison (sans le texte). |
| `resume.json` | les chiffres : par source, par équipe, par modèle, par raison d'écart, gardés et validation. |

### Règles qui décident

1. **Aucune sortie de Claude ni d'un modèle fermé comme réponse.** Une réponse n'entre dans `reponses.jsonl` que si son `turnLog` dit `provider: ollama` et que le modèle est dans une liste fermée de licences ouvertes : `qwen*`, `ornith*`, `jarvis-*`. Fournisseur `anthropic` ou `openai`, ou **tour sans `turnLog`** (anciennes conversations) : la réponse est écartée (« modèle inconnu »). La phrase de l'utilisateur peut quand même aller dans `trieur.jsonl`, si l'équipe est connue.
2. **Les ratés ne s'apprennent pas tels quels.** Un tour noté dans le carnet (correction, répétition, interruption, outil en échec, signalé) ou suivi d'une correction (`classifyUtterance`) va dans `a-corriger.jsonl`, jamais dans `reponses.jsonl`. Un raté de type « chemin » (mauvaise équipe) ne va pas non plus dans `trieur.jsonl`.
3. **La correction ne sera jamais écrite par Claude.** Seuls l'utilisateur ou un modèle ouvert (le professeur) peuvent remplir `correction`. Le script garde la trace de qui l'a remplie (`correctedBy`), et refuse une ligne qui dit `claude`.
4. **Contenu personnel.** Un tour qui a utilisé `google_*`, `read_file`, `search_jarvis_memory` ou la personnalisation est écarté de `reponses.jsonl` (« contenu personnel »). Tous les textes passent par `redactSecrets`.
5. **Les examens restent à part.** Aucune phrase présente dans un `examen*.jsonl` du trieur (`listExamFiles`) ni dans le catalogue d'évaluation du code (`evalCatalog`) n'entre dans un fichier d'entraînement.
6. **Validation honnête.** Découpage 90/10 **par conversation entière** (jamais un morceau de la même conversation des deux côtés), déterministe (`--seed`).
7. Doublons exacts retirés. Une ligne illisible ou une conversation abîmée (fichier de zéros) est sautée et comptée, jamais bloquante.

## Partie C — l'entraînement (pas dans cette mission)

Il viendra plus tard, avec Claude Code, sur carte louée (RunPod) et les outils de `training/` : le trieur d'abord (`--task trieur` existe), puis les réponses d'une équipe, quand il y aura assez d'exemples (seuil fixé alors d'après `resume.json`). **Avant tout envoi sur une carte louée**, l'utilisateur voit `resume.json` et dit oui. Les fichiers sont effacés de la machine louée à la fin.

## Règles de la mission

- Partir de `main`, branche `cursor/jeu-conversations`. La partie A touche `session.ts` : elle sera fusionnée dans Jarvis Test après le lot B, donc **ne pas réécrire** les zones du lot B ni du carnet ; ajouter le journal à un seul endroit, à la fin du tour.
- Tests : le journal (orchestre, chat d'avant, calcul, express, outil, enceinte, téléphone ; absent dans Live) ; chaque règle de la partie B avec des conversations `synthetique-test` ; la garde « aucune phrase d'entrée dans le dépôt » ; un test qui vérifie qu'une réponse `anthropic` n'entre jamais dans `reponses.jsonl`.
- **Lancer vraiment la construction de l'application** (`electron-vite build`), pas seulement les tests.
- `__golden__` jamais régénérés ; `parseSettings({})` inchangé ; aucune dépendance nouvelle ; aucun modèle, aucun réseau.
- Rapport `rapports/<date>-jeu-conversations.md` avec le RAPPORT DE VÉRIFICATION. Pas de fusion, pas de publication.
