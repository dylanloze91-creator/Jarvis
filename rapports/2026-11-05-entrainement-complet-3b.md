# Entraînement complet du 3B sur le PC, export et examen (5 novembre 2026)

Branche `claude/entrainement-1`, à la suite de `rapports/2026-11-04-entrainement-essai-1.md`. Base `Qwen/Qwen2.5-Coder-3B-Instruct`,
QLoRA 4 bits sur la RTX 2060 (6 Go), 406 exemples d'entraînement et 47 de validation (préparation du 4 novembre).
Aucune donnée d'entraînement ni phrase d'exercice ici : des chiffres seulement.

## 1. Entraînement

**Premier lancement (longueur 3 072, plafond de la préparation) : arrêté.** Après 40 minutes, le pas 5 n'était toujours pas
journalisé (il arrive à 4 minutes à l'essai de 20 pas). Le processus occupait 5,35 Go de mémoire dédiée sur la carte et
9,6 Go de mémoire partagée (RAM système vue par le pilote) : la carte débordait et chaque pas prenait plus de 8 minutes,
soit plus de 10 heures pour l'entraînement. Traité comme un échec mémoire (règle du jour : un seul nouvel essai avec
`--max-length 2048`).

**Second lancement (`--max-length 2048`) : réussi.** Aucun exemple écarté par la longueur (0 trop long des deux côtés).

| Mesure | Valeur |
| --- | --- |
| Durée | 1 h 34 min (78 pas, 3 époques) |
| Temps par pas (16 exemples) | 72 s (49 s à l'essai de 20 pas) |
| Perte au pas 5 (première journalisée) | 0,4229 |
| Perte au pas 75 (dernière journalisée) | 0,1526 |
| Perte d'entraînement moyenne | 0,1979 |
| Perte de validation, époque 1 / 2 / 3 | 0,2164 / **0,2032** / 0,2038 |
| Époque retenue | 2 (meilleure validation ; l'époque 3 remonte légèrement) |
| Pic de mémoire de carte | 5,44 Go sur 6,0 |
| Mémoire du processus (pilote) | 5,5 Go dédiés + 9,4 Go partagés |

Optimiseur `adamw_bnb_8bit` (Windows), rang 16, alpha 32, taux 2e-4, lot 1 × accumulation 16. Les modèles Ollama du chat
avaient été déchargés avant (`ollama stop`).

## 2. Export vers Ollama

`export_ollama.py --run <entraînement> --name jarvis-coder-3b --source-model qwen2.5-coder:3b --clean` : fusion de
l'adaptateur sur processeur, GGUF f16 (6,2 Go), quantification Q4_K_M (1,93 Go), Modelfile repris de `qwen2.5-coder:3b`
(téléchargé pour l'occasion, 1,9 Go), `ollama create jarvis-coder-3b`. Environ 5 minutes. Fusion et GGUF f16 supprimés
par `--clean` ; le GGUF Q4_K_M et le Modelfile restent dans `training/export/` (hors git).

Le modèle **s'ajoute** dans Ollama à côté des autres. Aucun réglage de Jarvis n'a été changé : le modèle de code se choisit
dans le panneau Développeur.

## 3. Examen comparatif

`lab:compare --base qwen2.5-coder:3b --candidate jarvis-coder-3b --runs 3` (29 missions d'évaluation, jamais vues à
l'entraînement, 3 passages par modèle, environ 10 minutes). Détail mission par mission :
`rapports/2026-11-05-examen-jarvis-coder-3b-contre-qwen2-5-coder-3b.md` (et `.json`).

| | qwen2.5-coder:3b (base) | jarvis-coder-3b (candidat) |
| --- | --- | --- |
| Total | 55 / 87 | **69 / 87** |
| Par passage | 17, 19, 19 | 23, 23, 23 |
| Missions réussies à la majorité | 19 | 23 |

Missions gagnées (0/3 → 3/3) : `e2-compact-falsy`, `e2-median`, `e2-run-length`, `e3-max-by-comparator`. Missions perdues :
aucune. Restent ratées par les deux (0/3) : `e2-leaf-count`, `e2-sum-number-file`, `e2-to-bool`, `l2-need-name`,
`l2-note-file`, `l3-quote-fee`.

**Verdict de `lab:compare` : meilleur, conseillé** (+14 réussites, moyenne par passage 23 au-dessus du meilleur passage de la
base 19, 0 mission perdue). Le candidat est aussi plus régulier (trois passages identiques).

## 4. Ce qui a changé dans le dépôt

- `training/README.md` : paragraphe sur l'entraînement complet (débordement mémoire à 3 072, `--max-length 2048` à prendre
  sur cette carte, 72 s par pas, 1 h 34).
- `AGENTS-COORDINATION.md` : ressource GPU réservée puis libérée, tâche terminée.
- Rapports de l'examen écrits par `lab:compare` (chiffres seulement).

Aucun code modifié. Rien n'a été supprimé dans les données ; les dossiers d'entraînement et d'export restent hors git.

## 5. Pistes

- Un 3B affiné sur 406 exemples dépasse déjà la base de 14 réussites sur 87 : refaire la même chose sur le 7B (carte louée,
  `paged_adamw_8bit`) quand le cahier aura grossi.
- Les six missions ratées par les deux modèles (dont `l2-need-name`, ratée aussi par le 30B) donnent des thèmes pour les
  prochaines nuits de génération.
