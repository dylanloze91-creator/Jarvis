# Revue — jeu d'entraînement tiré des conversations (mission 6 de Cursor)

16 novembre 2026. Patch de Cursor envoyé par l'utilisateur, appliqué sans conflit sur `main` (5.0.78) et poussé par Claude sur `claude/jeu-conversations`. Relu sur le code, pas lancé ici.

## Bon

- **Journal du tour à un seul endroit** : à la fin du tour, dans `session.ts`, juste avant l'enregistrement. Aucun prompt et aucune réponse ne changent. Dans Live, la conversation est rendue telle quelle.
- **Chemins sans modèle notés `aucun`** (horloge, calcul, express, bilan, mission directe) : ils ne peuvent pas passer pour une réponse de modèle.
- **Préparation conforme aux 7 règles du cahier** :
  - liste fermée `qwen|ornith|jarvis-` ;
  - correction écrite par `claude` refusée ;
  - outils personnels écartés, `redactSecrets` partout ;
  - examens du trieur et catalogue d'évaluation exclus ;
  - découpage par conversation entière (mulberry32, graine 5066).
- **Le rapport dit que l'application se construit** (`electron-vite build`), et « Construire manuel » est vert.

## À faire à l'intégration dans Jarvis Test (Claude Code)

1. **Une seule table d'édition.** `turnJournal.ts` détecte Test lui-même (`JARVIS_EDITION`, ou `jarvisEdition` dans le `package.json`). À la fusion avec `cursor/deux-jarvis`, `editionTest()` doit lire la table d'édition de `packages/core/src/edition.ts`, et rien d'autre. Sinon, deux façons de savoir « Test ou Live » finiront par se contredire.
2. **Chat sans orchestre et réponses toutes faites.** Quand l'orchestre est coupé, un tour servi par une règle (bourse, Spotify forcé…) est noté avec le fournisseur et le modèle du chat, alors qu'aucun modèle n'a écrit le texte. Ce n'est pas dangereux : le texte vient du code de Jarvis, pas de Claude. Mais `reponses.jsonl` apprendrait alors au modèle une réponse qu'il n'a pas faite. À corriger quand on touchera à ce chemin : noter `aucun` pour une réponse fixe.
3. Comme le reste du lot B, `notes.json` et `routines.json` passent à l'écriture sûre de la 5.0.78.
