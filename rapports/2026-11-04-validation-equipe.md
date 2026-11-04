# Validation en direct des équipes — 2026-11-04

Branche : `cursor/validation-equipe` (depuis `origin/main`).

## Résumé

Pastilles **✓** / **Changer** sous chaque route d’orchestre (express, cerveau, trieur — pas calcul) dans la fenêtre et sur le téléphone. Si l’utilisateur ne touche rien, rien n’est enregistré. Les choix vont dans `{trieurDataDir}/valide.jsonl`. `trieur:preparer` et `trieur:banc` consomment ce fichier (découpe examen / entraînement, scores « trié à froid » vs « validé en direct »).

## Réglages

Réglages → Modèle IA → Chef d’orchestre :

- **Dossier des données du trieur** (`orchestra.trieurDataDir`, facultatif, sans défaut Zod)
- **Proposer la validation des équipes** (`orchestra.teamValidation`, nécessite un dossier)

Sans dossier ou interrupteur coupé : pas de boutons.

## Fichier `valide.jsonl`

Une ligne JSON par action utilisateur :

| Champ | Description |
| --- | --- |
| `phrase` | Texte utilisateur tel quel |
| `context` | Contexte type `routerUserPrompt` (4 derniers échanges) |
| `equipe` | Équipe retenue |
| `equipeProposee` | Équipe proposée par Jarvis |
| `chemin` | `express` \| `cerveau` \| `trieur` |
| `statut` | `confirme` \| `corrige` |
| `date` | ISO 8601 |

Pas de réponse du modèle.

## Trieur

- **preparer** : fusionne les lignes validées dans `preparation/train.jsonl` et, côté examen, `preparation/examen-valide.jsonl` ; corrections vers l’examen tant qu’une équipe a &lt; 20 phrases d’examen (manuel + validé) ; sinon partage déterministe (hash + part validation 10 %).
- **banc** : rapport séparé **trié à froid** (`examen.jsonl`) et **validé en direct** (lignes validées affectées à l’examen).

## Tests ajoutés

| Zone | Fichier |
| --- | --- |
| Parse / split `valide.jsonl` | `packages/core/src/trieur/validation.test.ts` |
| Réglages interrupteur | `packages/core/src/trieur/orchestraValidationSettings.test.ts` |
| Réglages orchestra | `packages/core/src/agent/orchestra.test.ts` |
| Banc dual scores | `packages/core/src/trieur/bench.test.ts` |
| Écriture disque | `apps/desktop/src/main/orchestra/teamValidation.test.ts` |
| Session + pastille | `apps/desktop/src/main/orchestra-session.test.ts` |
| API téléphone | `packages/core/src/phone/phone.test.ts`, `apps/desktop/src/main/phone/server.test.ts` |

`chat-unchanged.test.ts` et `orchestra-session.test.ts` (hors nouveaux cas) : verts, aucun `__golden__` régénéré.

## RAPPORT DE VÉRIFICATION

**Testé en vrai : PAS FAIT** (agent cloud Linux, pas de Jarvis Electron ni iPhone sous la main).

**À essayer sur votre PC (thedexios) :**

1. Créer un dossier trieur (ex. `C:\dev\jarvis-data\trieur`), activer le chef d’orchestre, renseigner le dossier et **Proposer la validation des équipes**, enregistrer.
2. Envoyer une demande express ou cerveau : vérifier **✓** / **Changer** sous la pastille ; confirmer → une ligne `confirme` dans `valide.jsonl` ; corriger une équipe → `corrige`.
3. Ne rien toucher sur un tour : aucune nouvelle ligne dans `valide.jsonl`.
4. Même scénario depuis le téléphone (Tailscale + appli web).
5. `npm run trieur:preparer` puis `npm run trieur:banc` sur ce dossier : vérifier le résumé **trié à froid** / **validé en direct**.
