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
| Claude Code | `claude/generateur-5059` | Intégrer la 5.0.59 (appels relus, générateur exigeant, nettoyage du cahier) et remesurer le 7B, fusionné dans main | — | 2026-10-29 | terminé |
| Cursor | `cursor/jarvis-rover` | Fusion du module Robot dans main | — | 2026-10-29 | terminé |
| Cursor | `cursor/integration-5060` | Intégration 5.0.60 chef d'orchestre | — | 2026-10-30 | terminé |
| Cursor | `cursor/lint-propre` | Lint à zéro | — | 2026-10-30 | terminé |
| Claude Code | `claude/generateur-5061` | Intégration terminée, 5.0.61 publiée | — | 2026-10-30 | terminé |
| Cursor | `cursor/jarvis-rover` | Publier le module Robot dans main | — | 2026-10-31 | terminé |
| Claude | `claude/voix-5062` | 5.0.62 écoute et avis franc (incluse dans `claude/mobile-5063`) | — | 2026-10-31 | terminé |
| Claude | `claude/mobile-5063` | 5.0.63 Jarvis sur le téléphone (Tailscale), fusionnée dans main et publiée (5.0.63) | — | 2026-11-01 | terminé |
| Cursor | `cursor/publication-5063` | Publication 5.0.63 terminée (fusion de `claude/mobile-5063`, `release.sh` via `gh`, release `v5.0.63`) | — | 2026-11-01 | terminé |
| Claude | `claude/audit-ux-5064` | Audit de l'appli : 35 bogues corrigés + ergonomie (interface, processus principal, cœur), rapport `rapports/2026-11-01-audit-ux-5064.md`, à fusionner après rejeu des tests sur le PC | — | 2026-11-01 | terminé |
| Cursor | `cursor/audit-corrections` | Corrections de l'audit UX 5064 : points 1, 2, 3, 6, 7 de la revue `docs/revues/2026-11-02-audit-ux-5064.md` faits et testés (rapport `rapports/2026-11-02-audit-corrections.md`) ; points 4 et 5 faits sur `main` à l'intégration 5.0.64 (à vérifier sur Windows par Claude Code) ; fusionnée dans main (intégration 5.0.64, non publiée) | — | 2026-11-02 | terminé |
| Cursor | `cursor/enceinte-5064` | 5.0.64 Enceinte Jarvis (pont `main/speaker/`, programme ESP32-S3 `firmware/jarvis-speaker/`, guide), cahier `docs/specs/enceinte-jarvis.md`, rapport `rapports/2026-11-02-enceinte-5064.md`, revue `docs/revues/2026-11-02-enceinte-5064.md` ; fusionnée dans main (intégration 5.0.64, non publiée) | — | 2026-11-02 | terminé |
| Cursor | `cursor/entrainement-5065` | Outils d'entraînement du modèle (5.0.65) : `lab:prepare`, `training/` (QLoRA, export Ollama, carte louée), `lab:compare` ; rien entraîné ; fusionnée dans main (intégration 5.0.64, non publiée) | — | 2026-11-02 | terminé |
| Cursor | `cursor/robot-voix-5066` | Corrections après revue de la voix (5.0.66) ; fusionnée dans main (intégration 5.0.64, non publiée) | — | 2026-11-02 | terminé |
| Cursor | `cursor/verification` | Routine de vérification (ECC 01) : règle `.cursor/rules/verification.mdc` ; fusionnée dans main (intégration 5.0.64, non publiée) | — | 2026-11-01 | terminé |
| Cursor | `main` | Intégration 5.0.64 : branches de la nuit (5 fusions `--no-ff`, points 4 et 5 de la revue audit, version 5.0.64, rapport `rapports/2026-11-02-integration-5064.md`) ; **non publiée** : Claude Code doit vérifier les points 4 et 5 sur Windows avant toute release | — | 2026-11-02 | terminé |
| Cursor | `cursor/voix-piper-5067` | Voix locale Piper (chantier 1, 5.0.67) | — | 2026-11-02 | terminé |
| Cursor | `cursor/trieur-5068` | Spécialiste trieur (5.0.68) | — | 2026-11-02 | terminé |
| Claude Code | `claude/nuit-3` | Rapport de la nuit 3 du générateur, vérifications Windows de la 5.0.64 (points 4 et 5), puis publication 5.0.64 | `rapports/2026-11-02-nuit-3.md`, `rapports/2026-11-02-verification-windows-5064.md` | 2026-11-02 | bloqué : rapports et vérifications Windows faits (points 4 et 5 conformes), publication 5.0.64 non faite — 27 échecs de tests sur Windows (voir `rapports/2026-11-02-verification-windows-5064.md`) et `gh` absent de ce PC |
| Cursor | `cursor/correctifs-windows-5064` | Correctifs Windows 5.0.64 | — | 2026-11-02 | terminé |
| Claude Code | `claude/nuit-3` | Rapport de la nuit 3 du générateur, vérifications Windows de la 5.0.64 (points 4 et 5), puis publication 5.0.64 | `rapports/2026-11-02-nuit-3.md`, `rapports/2026-11-02-nuit-4.md`, `rapports/2026-11-02-verification-windows-5064.md`, `rapports/2026-11-02-fusion-correctifs-windows-5064.md` | 2026-11-02 | bloqué : fusion de claude/revue-correctifs-windows faite en local sur main (non poussée), publication 5.0.64 non faite — typecheck rouge (knowledge.eperm.test.ts), 1 test non portable restant (platformerMissionPath.test.ts), gh non connecté (voir `rapports/2026-11-02-fusion-correctifs-windows-5064.md`) ; nuit 4 du générateur faite (73 exercices acceptés sur 242 essais, arrêt EBUSY, cahier à 370) |
| Cursor | `main` | Publication 5.0.64 | — | 2026-11-03 | terminé |
| Cursor | `cursor/trieur-export-claude` | Export claude.ai pour le trieur | — | 2026-11-03 | terminé |
| Cursor | `main` | Publication 5.0.65 (fusions `claude/integration-5065` + `cursor/trieur-export-claude`, `release.sh`, release `v5.0.65`, rapport `rapports/2026-11-03-publication-5065.md`) | — | 2026-11-03 | terminé |
| Cursor | `cursor/piper-windows-5066` | Piper Windows : binaire et lecture | — | 2026-11-03 | terminé |
| Cursor | `cursor/meteo-sources-5066` | Sources courtes et lieu Chez moi | — | 2026-11-03 | terminé |
| Cursor | `cursor/validation-equipe` | Validation en direct des équipes | — | 2026-11-04 | terminé |
| Claude | `claude/caractere-jarvis` | Caractère de Jarvis : fiche de personnage dans les consignes des équipes du chef d'orchestre (réglage `persona`, coupé par défaut), accueil selon l'heure et le prénom ; rapport `rapports/2026-11-03-caractere-jarvis.md` ; à fusionner après rejeu des tests sur le PC | — | 2026-11-03 | terminé |
| Cursor | `cursor/chat-unifie-5068` | Chat unifié, phase 1 (5.0.68) | — | 2026-11-04 | terminé |
| Claude Code | `claude/entrainement-1` | Entraînement de l'élève, étapes 1 à 4 du README (préparation, mise en place, dry-run, essai 20 pas sur la carte) ; puis entraînement complet du 3B sur la carte (demandé le 2026-11-04 au soir) ; export `jarvis-coder-3b` et examen `lab:compare` ; rapports `rapports/2026-11-04-entrainement-essai-1.md`, `rapports/2026-11-05-entrainement-complet-3b.md`, `rapports/2026-11-05-examen-jarvis-coder-3b-contre-qwen2-5-coder-3b.md` | — | 2026-11-04 | terminé |
| Cursor | `cursor/mission-directe-5069` | Mission directe | — | 2026-11-04 | terminé |
| Cursor | `cursor/spotify-enceinte-cible` | Spotify sur enceinte Connect choisie (Devialet) | — | 2026-11-04 | terminé |
| Cursor | `cursor/interface-simple-5070` | 5.0.70 interface simple + questionnaire | — | 2026-11-05 | terminé |

## Ressource GPU / Ollama

Une seule carte (RTX 2060 6 Go) : un seul agent à la fois lance le banc (`npm run lab --workspace @jarvis/core`) ou le générateur (`npm run lab:generate --workspace @jarvis/core`).

| État | Par qui | Pour quoi | Depuis |
| --- | --- | --- | --- |
| libre | — | — | — |

Pour réserver : passer l'état à `occupée`, remplir les colonnes, commiter et pousser **avant** de lancer. Pour libérer : remettre `libre` et `—`, commiter et pousser.
