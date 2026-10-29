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
| Cursor | `cursor/jarvis-rover` | Intégration du module Robot (patch de Claude) | — | 2026-10-29 | terminé |
| Cursor | `cursor/jarvis-rover` | Fusion du module Robot dans main | `CLAUDE.md`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/rover/*`, `apps/desktop/src/main/tools/index.ts`, `apps/desktop/src/main/tools/rover.ts`, `apps/desktop/src/main/tools/rover.test.ts`, `apps/desktop/src/main/tools/catalog-rover.test.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/src/components/RoverSettings.tsx`, `SettingsPanel.tsx`, `SettingsTabs.tsx`, `apps/desktop/src/renderer/src/preview/bridge.ts`, `apps/desktop/src/shared/ipc.ts`, `packages/core/src/agent/agent.ts`, `packages/core/src/agent/roverTurn.test.ts`, `packages/core/src/index.ts`, `packages/core/src/rover/*`, `packages/core/src/security/redact.ts`, `packages/core/src/security/redact.test.ts`, `packages/core/src/settings.ts` | 2026-10-29 | en cours |

## Ressource GPU / Ollama

Une seule carte (RTX 2060 6 Go) : un seul agent à la fois lance le banc (`npm run lab --workspace @jarvis/core`) ou le générateur (`npm run lab:generate --workspace @jarvis/core`).

| État | Par qui | Pour quoi | Depuis |
| --- | --- | --- | --- |
| libre | — | — | — |

Pour réserver : passer l'état à `occupée`, remplir les colonnes, commiter et pousser **avant** de lancer. Pour libérer : remettre `libre` et `—`, commiter et pousser.
