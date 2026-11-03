# Rapport — export claude.ai pour le trieur (2026-11-03)

Branche : `cursor/trieur-export-claude` (base `origin/main` + fusion `cursor/trieur-5068` pour disposer de `trieur:extraire`).

## Fait

- Option **`--export-claude <dossier ou .zip>`** sur `npm run trieur:extraire --workspace @jarvis/core` (`packages/core/scripts/trieur-extraire.mjs`).
- Lecture de **`conversations.json`** (dossier décompressé, sous-dossier `data-…`, ou zip via `unzip -p` / repli `tar -xf`).
- Module **`packages/core/src/trieur/claudeExport.ts`** : branche active des messages, texte utilisateur verbatim (`content[]` type `text` ou champ `text`), contexte = message utilisateur précédent dans la conversation, filtres (vide, doublons, > 400 caractères, blocs de code / ```), champ **`"source":"claude.ai"`** dans `a-trier.jsonl`.
- Fusion possible avec **`--conversations`** (`mergeToSortLines`).
- **`training/TRIEUR.md`** : procédure d’export claude.ai et commande.
- **`CLAUDE.md`** (5.0.68) : mention de `--export-claude`.
- Tests Vitest synthétiques **`synthetique-test`** : `packages/core/src/trieur/claudeExport.test.ts` (5 tests). Aucun export réel dans le dépôt.

## Testé automatiquement (VM Linux, sans SDK .NET)

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm test --workspace @jarvis/core` | **2157** tests OK (+5 nouveaux) |
| `npm test` (racine, desktop inclus) | **622** tests OK desktop ; core idem |
| `chat-unchanged.test.ts` / `ollama-unchanged.test.ts` | OK, sans régénération |
| `pytest training/tests/` | Non exécutable ici (pas de venv / torch) — attendu sur PC Windows avec `training/.venv` |

## Non testé sur le PC de l’utilisateur

- Aucun vrai zip claude.ai n’a été lu sur Windows.
- Ollama, page de tri, banc : inchangés par cette branche.

## Commits (après push)

- `42c3342` — Trieur : option `--export-claude` (conversations.json claude.ai)
- `7d5b5d0` — Docs : export claude.ai dans TRIEUR.md, rapport et coordination terminée
- (Prérequis sur la branche : fusion `d0a55af` de `cursor/trieur-5068` pour le trieur 5.0.68)

Voir aussi `git log origin/main..cursor/trieur-export-claude --oneline`.

## RAPPORT DE VÉRIFICATION

**Testé en vrai : PAS FAIT** (pas de zip claude.ai personnel sur la VM cloud).

**À essayer sur votre PC (Windows), sans commiter le zip :**

1. `npm install` puis `npm run build --workspace @jarvis/core`
2. Télécharger votre export claude.ai (Paramètres → Confidentialité → Exporter les données).
3. `npm run trieur:extraire --workspace @jarvis/core -- --export-claude C:\chemin\vers\votre-export.zip --dir C:\dev\jarvis-data\trieur`
4. Ouvrir `C:\dev\jarvis-data\trieur\a-trier.jsonl` : lignes avec `"source":"claude.ai"`, phrases **utilisateur** seulement, pas de messages assistant.
5. Optionnel : relancer avec `--conversations %APPDATA%\Jarvis\conversations` en plus pour fusionner Jarvis + claude.ai.
6. `npm run trieur:trier …` sur quelques phrases pour valider l’affichage du contexte.

**Ne jamais** ajouter le zip ou `conversations.json` réel au dépôt Git.
