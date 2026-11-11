# Entraînement du trieur, export `jarvis-trieur` et banc (11 novembre 2026)

Branche : `claude/trieur-entrainement-1` (depuis `origin/main` `39a9d14`). Mission de nuit : étapes 6 à 8 de `training/TRIEUR.md`. **Pas de fusion dans `main`, pas de publication, aucun réglage de Jarvis changé.** Données : `C:\dev\jarvis-data\trieur\` (hors dépôt, rien supprimé). Jarvis fermé et Ollama arrêté au départ ; Ollama lancé par l'agent pour l'export et le banc, puis arrêté.

## En clair

Le petit modèle de tri a été entraîné sur le PC en une heure, installé dans Ollama sous le nom `jarvis-trieur` à côté des autres, puis passé à l'examen face au cerveau actuel (`qwen2.5:7b`). **Il est cinq fois plus rapide, mais il se trompe plus souvent que le cerveau** : il ne remplit pas la règle du guide (« au moins autant de bonnes réponses, pas plus de réponses illisibles »). Rien n'a été activé : le cerveau trie toujours. Le modèle `jarvis-trieur` reste installé pour un prochain essai ; `ollama rm jarvis-trieur` le retire.

## 1. Modèle de base et licence

| | |
| --- | --- |
| Base | `Qwen/Qwen2.5-1.5B-Instruct` (Hugging Face) |
| Licence | Apache-2.0 (vérifiée le 2026-11-02 dans `rapports/2026-11-02-trieur-5068.md`, lien officiel : `https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/raw/main/LICENSE`) ; candidat recommandé par `training/TRIEUR.md` ; le 3B est écarté (Qwen RESEARCH, non commercial) |
| Modelfile repris de | `qwen2.5:1.5b` (Ollama, téléchargé pour l'occasion : il manquait) |
| Données | `preparation/` du 2026-11-09 : 1 807 exemples d'entraînement, 197 de validation, plafond 512 jetons, 0 trop long |
| Jetons appris | 6 223 jetons de réponse sur 600 363 (1 %) : consigne et demande masquées, seul le nom d'équipe compte |

## 2. Essai de 20 pas

| Mesure | Valeur |
| --- | --- |
| Commande | `train_lora.py --task trieur --base Qwen/Qwen2.5-1.5B-Instruct --max-steps 20 --optim adamw_bnb_8bit` |
| Durée | 11 min 22 s (téléchargement du modèle de base compris, environ 3 Go) |
| Perte pas 5 / pas 20 | 0,7853 / 0,2320 |
| Perte de validation | 0,1638 |
| Pic de mémoire de carte | 1,95 Go sur 6,0 |

Pic et perte bons : entraînement complet lancé sans changer la longueur.

## 3. Entraînement complet

| Mesure | Valeur |
| --- | --- |
| Réglages | QLoRA nf4 fp16, rang 16, alpha 32, abandon 0,05, taux 2e-4, lot 1 × accumulation 16, cosinus, montée 3 %, optimiseur `adamw_bnb_8bit`, 18 464 768 paramètres entraînables |
| Durée | 59 min 46 s (339 pas, 3 époques, 113 pas par époque) |
| Temps par pas (16 exemples) | environ 10,6 s |
| Perte au pas 5 (première journalisée) | 0,9462 |
| Perte au pas 335 (dernière journalisée) | 0,0197 |
| Perte d'entraînement moyenne | 0,0988 |
| Perte de validation, époque 1 / 2 / 3 | 0,1077 / 0,0709 / **0,0645** |
| Époque retenue | 3 (la validation baisse encore ; pas d'arrêt anticipé) |
| Pic de mémoire de carte | 1,98 Go sur 6,0 |
| Sortie | `training/runs/2026-11-11-trieur/` (adaptateur, `bilan.json`, `journal.txt`, hors Git) |

## 4. Export vers Ollama

`export_ollama.py --run runs/2026-11-11-trieur --name jarvis-trieur --source-model qwen2.5:1.5b` : fusion de l'adaptateur (fp16, processeur), GGUF f16 (3,09 Go), quantification Q4_K_M (986 Mo), Modelfile de `qwen2.5:1.5b` avec seule la ligne `FROM` changée, `ollama create jarvis-trieur`. Durée totale environ 4 min. `qwen2.5:1.5b` et tous les autres modèles restent installés ; rien n'a été remplacé.

## 5. Banc : cerveau contre trieur

Commande : `npm run trieur:banc --workspace @jarvis/core -- --dir C:\dev\jarvis-data\trieur --model qwen2.5:7b,jarvis-trieur`. Rapport chiffré : `rapports/2026-11-11-trieur-banc.json` et `.txt` (aucune phrase dedans). Examen : 151 phrases classées à la main (toutes venues de l'export claude.ai, toutes avec contexte), dont 140 dans une équipe connue du chef d'orchestre (11 classées `taches`, équipe inconnue, écartées par le banc) ; plus 10 phrases validées en direct.

### Total

| | qwen2.5:7b (cerveau) | jarvis-trieur |
| --- | --- | --- |
| Bonnes réponses (140 phrases à froid) | **53 / 140 (38 %)** | 36 / 140 (26 %) |
| Réponses illisibles | 0 | 1 |
| Temps par phrase | 333 ms | **63 ms** |
| Chargement | 18,5 s | **3,2 s** |
| Part du modèle sur la carte | 79 % | 100 % |
| Validées en direct (10 phrases) | **10 / 10** | 7 / 10 |

### Par équipe (bonnes réponses / phrases de l'examen)

| Équipe attendue | Phrases | qwen2.5:7b | jarvis-trieur | Où va le trieur quand il se trompe |
| --- | --- | --- | --- | --- |
| conversation | 62 | 41 | 25 | code 19, pc 16, memoire 2 |
| web | 44 | 5 | 0 | pc 17, code 14, conversation 10, google 3 |
| code | 16 | 5 | **10** | conversation 4, pc 1, illisible 1 |
| memoire | 11 | 0 | 0 | conversation 5, code 4, pc 2 |
| fichiers | 5 | 0 | 0 | code 2, conversation 1, memoire 1, pc 1 |
| pc | 2 | 2 | 1 | code 1 |

Validées en direct : code 7/7 pour les deux ; google, pc et web (1 phrase chacune) justes pour le cerveau, fausses pour le trieur.

### Verdict selon la règle de `training/TRIEUR.md`

| Condition | Résultat |
| --- | --- |
| Au moins autant de bonnes réponses | **Non** (36 contre 53) |
| Pas plus de réponses illisibles | **Non** (1 contre 0) |
| Plus rapide | Oui (63 ms contre 333 ms par phrase) |

**Le trieur n'est pas meilleur que le cerveau : il ne doit pas être activé.** Aucun réglage de Jarvis n'a été changé (`orchestra.router` absent, le cerveau trie).

## 6. Lecture des chiffres (pour un prochain essai)

- La perte de validation (0,0645) est excellente, mais sur **le cahier du professeur** (`qwen2.5:7b`, 9 équipes à peu près équilibrées : 148 à 271 exemples chacune). L'examen est différent : 151 phrases humaines de claude.ai, dominées par conversation (62) et web (44), sans aucune phrase musique, concentration ni google. Le trieur a appris le style du professeur, pas celui des phrases réelles : il envoie les 44 phrases « web » de l'examen vers pc ou code, et jamais vers web.
- Le cerveau lui-même ne dépasse pas 38 % sur cet examen (0/11 en mémoire, 0/5 en fichiers, 5/44 en web) : les phrases de claude.ai sont loin des formulations qu'attend la consigne du chef d'orchestre. Une mesure sur des phrases dites à Jarvis (source `jarvis`, `trieur:extraire --conversations`) serait plus proche de l'usage réel.
- Pistes, sans rien lancer ici : enrichir l'examen avec des phrases Jarvis ; ajouter au cahier des exemples proches des phrases réelles (le générateur ne connaît que le professeur) ; mesurer `qwen2.5:3b` et `qwen2.5:1.5b` non entraînés sur le même banc pour situer le gain de l'entraînement.

## 7. Ce qui change dans le dépôt

- `rapports/2026-11-11-trieur-entrainement-1.md` (ce rapport), `rapports/2026-11-11-trieur-banc.json` et `.txt` (chiffres seulement).
- `AGENTS-COORDINATION.md` : tâche inscrite puis terminée, ressource GPU réservée puis libérée.
- Aucun fichier de code, aucun réglage. Hors Git : `training/runs/2026-11-11-trieur-essai/`, `training/runs/2026-11-11-trieur/`, `training/export/jarvis-trieur/` (ignorés), modèle `jarvis-trieur` et `qwen2.5:1.5b` dans Ollama, cache Hugging Face du modèle de base.
