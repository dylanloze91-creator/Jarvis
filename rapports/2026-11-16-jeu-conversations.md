# Jeu d'entraînement tiré des conversations

16 novembre 2026. Branche `cursor/jeu-conversations`, partie de `main`. Pas de fusion, pas de publication. Partie C (entraînement, carte louée) non faite.

## Ce qui change pour toi

Jarvis Test note, à la fin de chaque tour, qui a répondu. Jarvis Live ne note rien. Aucune phrase ni aucune réponse ne change.

Le script de préparation lit les conversations et le carnet, sans modèle et sans réseau, et pose cinq fichiers sur le PC, jamais dans le dépôt :

`C:\dev\jarvis-data\conversations\`

| Fichier | Rôle |
| --- | --- |
| `trieur.jsonl` | la phrase → l'équipe, au format que `trieur:preparer` sait lire |
| `reponses.jsonl` | les bons exemples (système court de l'équipe, au plus 4 échanges d'avant, la demande, la réponse, les outils) |
| `a-corriger.jsonl` | les tours ratés, cause notée, case `correction` vide |
| `ecartes.jsonl` | ce qui a été mis de côté, avec la raison, sans le texte |
| `resume.json` | les chiffres : source, équipe, modèle, raison, gardés, validation |

Pour le lancer : `scripts\conversations-preparer.ps1` (UTF-8 avec BOM), ou :

```
npm run conversations:preparer --workspace @jarvis/core -- --conversations <dossier> [--carnet <rates.jsonl>] [--dir C:\dev\jarvis-data]
```

## Le journal

Écrit seulement dans Jarvis Test (même interrupteur que l'édition : `JARVIS_EDITION=test`, ou `jarvisEdition: "test"` dans l'installateur). Dans Live, le fichier de conversation ne gagne aucun champ.

Une entrée `turnLog` par tour :

- équipe (`team`, `null` pour le chat d'avant) ;
- comment (`how` : calcul, horloge, express, trieur, cerveau, ou `null`) ;
- fournisseur (`ollama`, `openai`, `anthropic`, `mock`, ou `aucun`) ;
- modèle (`qwen2.5:7b`, ou `null` s'il n'y a pas de modèle) ;
- emplacement (`carte`, `processeur`, ou `null`) ;
- source (`texte`, `voix`, `telephone`, `enceinte`) ;
- outils (nom et statut) ;
- durée et instant.

`routeLog` est rempli en même temps (même équipe, même `how`). L'ajout est à un seul endroit, à la fin du tour, dans `session.ts`. Les prompts et les réponses ne sont pas réécrits. `__golden__` n'a pas été régénéré. `parseSettings({})` n'a pas changé.

## Les règles de la préparation

1. Une réponse n'entre dans `reponses.jsonl` que si le journal dit `ollama` et un modèle ouvert (`qwen*`, `ornith*`, `jarvis-*`). `anthropic`, `openai`, un autre modèle, ou pas de journal : écartée (« modèle inconnu »). La phrase peut quand même aller au trieur si l'équipe est connue.
2. Un tour du carnet (correction, répétition, interruption, outil en échec, signalé, chemin) ou suivi d'une correction va dans `a-corriger.jsonl`, jamais dans `reponses.jsonl`. Un raté de type chemin n'entre pas non plus dans `trieur.jsonl`.
3. Une correction écrite par Claude est refusée : le texte n'est copié nulle part, la case `correction` reste vide.
4. `google_*`, `read_file`, `search_jarvis_memory` et la personnalisation écartent le tour des réponses (« contenu personnel »). Tous les textes passent par `redactSecrets`.
5. Aucune phrase d'un `examen*.jsonl` du trieur, ni d'un objectif du catalogue d'évaluation du code, n'entre dans un fichier d'entraînement.
6. Découpage 90/10 par conversation entière, déterministe (`--seed`, défaut 5066).
7. Doublons exacts retirés. Une ligne illisible ou un fichier de zéros est sauté et compté.

Les sources sont lues seulement. Écrire dans une source ou dans le dépôt est refusé. Les essais portent la marque `synthetique-test`.

## À essayer sur le PC

1. Ouvre **Jarvis Test**, demande « quelle heure est-il », « combien font 2 + 2 », puis « joue du jazz ». Dans le fichier de la conversation (dossier de Test, `conversations\`), le dernier tour a un `turnLog` : horloge et calcul sans modèle, musique avec `ollama`.
2. La même question dans **Jarvis Live** : le fichier n'a pas de `turnLog`.
3. Lance `scripts\conversations-preparer.ps1`. La fenêtre ne montre aucune phrase. `C:\dev\jarvis-data\conversations\resume.json` donne les chiffres.

```
RAPPORT DE VÉRIFICATION
Lancement : OK (electron-vite build)
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : OK (3314/3320 réussis, 6 ignorés ; cœur 2498/2498, bureau 816/822)
Secrets   : OK (0 vraie valeur ; noms, libellés et valeurs factices de tests seulement)
Fichiers modifiés : AGENTS-COORDINATION.md, apps/desktop/src/main/session.ts, apps/desktop/src/main/turnJournal.ts, apps/desktop/src/main/turn-journal.test.ts, apps/desktop/src/shared/ipc.ts, apps/desktop/src/main/speaker/server.ts, apps/desktop/src/main/speaker/server.test.ts, apps/desktop/src/main/phone/server.ts, apps/desktop/src/main/phone/server.test.ts, packages/core/package.json, packages/core/src/types.ts, packages/core/src/trieur/extract.ts, packages/core/src/conversations/preparer.ts, packages/core/src/conversations/preparer.test.ts, packages/core/scripts/conversations-preparer.mjs, scripts/conversations-preparer.ps1, rapports/2026-11-16-jeu-conversations.md
Prêt à fusionner : OUI
À corriger : pousser la branche (gh n'est pas connecté sur cette machine ; rien n'a été forcé)
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```

`npm run build --workspace @jarvis/core` puis `npx electron-vite build` dans `apps/desktop` : les deux se terminent sans erreur. Le `npm run build` complet (voix, icônes) n'a pas été lancé. « Construire manuel » est vert (696 ms), le test n'a pas été modifié. Aucune dépendance nouvelle. Le banc et le générateur n'ont pas été lancés.
