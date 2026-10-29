# Coordination des agents

Deux agents travaillent sur ce dépôt : **Claude Code** (sur le PC Windows) et **Cursor** (souvent en agent cloud). Ce fichier dit qui travaille sur quoi. Les règles sont dans `CLAUDE.md` (section « Travail à deux agents ») et dans `.cursor/rules/coordination.mdc`.

Mode d'emploi :

1. `git fetch`, puis lire ce fichier sur `origin/main` **et** sur les branches `claude/...` et `cursor/...` en cours.
2. Ajouter une ligne pour sa tâche (statut `en cours`), commiter et pousser ce fichier tout de suite.
3. Ne pas toucher aux fichiers listés par l'autre agent tant que sa ligne n'est pas `terminé`.
4. En fin de tâche : statut `terminé`, colonne « Fichiers » vidée (ou `—`), commit, push.

Statuts possibles : `en cours`, `en pause`, `bloqué`, `terminé`.

## Qui travaille sur quoi

| Agent | Branche | Tâche | Fichiers concernés | Début | Statut |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude/coordination-agents-v2` | Règles de travail à deux agents | — | 2026-10-28 | terminé |
| Claude Code | `claude/donnees-code` | Générateur d'exercices (5.0.54 à 5.0.58), fusionné dans main | — | 2026-10-27 | terminé |
| Cursor | `cursor/maj-developpeur-def9` | Ancienne branche de travail : 3 corrections du labo après la 5.0.53 | — | 2026-10-23 | en pause |

## Ressource GPU / Ollama

Une seule carte (RTX 2060 6 Go) : un seul agent à la fois lance le banc (`npm run lab --workspace @jarvis/core`) ou le générateur (`npm run lab:generate --workspace @jarvis/core`).

| État | Par qui | Pour quoi | Depuis |
| --- | --- | --- | --- |
| occupée | Claude Code | Remesure du 7B sur l'évaluation (`lab --set eval`, qwen2.5-coder:7b, 3 passages, 5.0.59) | 2026-10-29 |

Pour réserver : passer l'état à `occupée`, remplir les colonnes, commiter et pousser **avant** de lancer. Pour libérer : remettre `libre` et `—`, commiter et pousser.
