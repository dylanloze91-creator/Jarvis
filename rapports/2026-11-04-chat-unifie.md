# Rapport — Discussion unifiée et missions (5.0.68)

Branche : `cursor/chat-unifie-5068`. Cahier : `docs/specs/chat-unifie.md`.

## Livré (phase 1)

- Réglage `developer.chatMissions` (point 1, commit précédent).
- Équipe **Code** : outil `proposer_mission`, consigne `CODE_MISSION_TOOL_PROMPT`, `ChatMissionHub.recordProposal`, tests `chat-missions-proposer.test.ts`.
- Carte **Mission proposée** dans la discussion (`ChatMissionProposalCard`, événement `mission_proposal`, persistance `ChatMessage.chatMission`).
- Choix du **projet** (Jarvis, registre, nouveau projet) — jamais deviné.
- **Suivi** (`ChatMissionTrackCard`, sync depuis `DeveloperState.mission`), confirmations développeur dans `UnifiedJarvisChat`, réponses REASONER via `answerMission`.
- **Rapport** (`ChatMissionReportCard`) : Appliquer, Ouvrir dossier (processus principal), Garder, Jeter.
- Une mission active **bloque** une nouvelle proposition (`blockedMessage`).
- **Téléphone** et **enceinte** : affichage / phrase dédiée, jamais lancement depuis l'enceinte.
- **Historique** : `missionId` sur les messages, `reloadConversationMissions` + `openMission`.
- **Voix** : une phrase à la création de la proposition (`voiceHint`).

## Scènes d'aperçu (captures)

À générer sur le PC avec Vite preview (non exécuté dans l'agent cloud) :

| Scène | URL suggérée | Fichier PNG cible |
| --- | --- | --- |
| Carte mission proposée | `?scene=chat-mission-proposal` (à brancher dans `preview/bridge.ts` si besoin) | `rapports/chat-unifie-proposal.png` |
| Suivi mission | discussion avec mission en cours | `rapports/chat-unifie-track.png` |
| Rapport | mission terminée | `rapports/chat-unifie-report.png` |

## RAPPORT DE VÉRIFICATION

**Testé en vrai : PAS FAIT** (environnement Linux cloud : pas de fenêtre Electron ni Ollama complet).

**Automatisé (agent cloud)** :

- `npm run typecheck` : OK
- `npm test` : OK (653 tests passés, 6 ignorés ; +2 `chat-missions-proposer.test.ts`)
- `npm run lint` : OK

## Commits

Voir historique Git `5.0.68 — point N : …` sur `cursor/chat-unifie-5068`.
