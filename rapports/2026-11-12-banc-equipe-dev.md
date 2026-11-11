# Banc pour l'équipe de développeurs — 12 novembre 2026

Branche `claude/banc-equipe-dev` (depuis `origin/main` 71c3ccb). Rien n'est fusionné, publié, remplacé ni choisi : ce rapport mesure et propose. Chiffres seulement (aucun exercice, aucun chemin de fichier temporaire).

Travail fait pendant la nuit, sans question posée ; les choix pris seul sont dans la section « Décisions prises sans toi ».

## 1. Candidats : existence, licence, GGUF

Vérifié à la source (API Hugging Face `/api/models/<id>`, champ `license`, et fiche du modèle) le 11 novembre au soir.

| Modèle | Dépôt source | Licence | Usage et affinage | GGUF Q4_K_M retenu | Taille |
| --- | --- | --- | --- | --- | --- |
| Seed-Coder-8B-Instruct | `ByteDance-Seed/Seed-Coder-8B-Instruct` (base `Seed-Coder-8B-Base`) | MIT | permis, y compris commercial et affinage | `unsloth/Seed-Coder-8B-Instruct-GGUF:Q4_K_M` (ByteDance ne publie pas de GGUF) | 5,07 Go |
| Ornith-1.0-9B | `deepreinforce-ai/Ornith-1.0-9B` (post-entraîné sur Qwen3.5) | MIT | permis, y compris commercial et affinage | `deepreinforce-ai/Ornith-1.0-9B-GGUF:Q4_K_M` (GGUF officiel) | 5,63 Go |

Les deux sont sous la limite de 8 Go et leur licence permet l'usage et l'affinage : **les deux ont été téléchargés** (`ollama pull hf.co/…`). Aucun candidat écarté.

Réserve sur Ornith : sa fiche dit MIT, mais le modèle est dérivé de Qwen3.5 (Apache-2.0 d'après la série Qwen) ; la licence de la base n'a pas été relue cette nuit. Apache-2.0 permet aussi l'affinage, donc la conclusion ne change pas, mais la mention de la base est à garder dans le README d'un éventuel jarvis-coder v2.

## 2. Décisions prises sans toi

1. **Seed-Coder sans outils dans Ollama.** Le GGUF d'unsloth importé par Ollama n'annonce pas la capacité `tools` et son gabarit ne gère ni la liste de messages ni les appels d'outil : le banc l'aurait noté 0/87 pour « appel d'outil illisible ». J'ai créé un dérivé local `seed-coder-lab` (Modelfile : même GGUF, gabarit officiel de Seed-Coder `<[begin▁of▁sentence]>rôle … <[end▁of▁sentence]>` relu dans le `tokenizer_config.json` de ByteDance, bloc `# Tools` + `<tool_call>` que le laboratoire sait relire, `temperature 0.2`). Essai de fumée : un appel `write_file` propre. Le modèle lui-même n'est pas modifié. Ce dérivé n'est pas dans le dépôt : il vit dans Ollama sur ce PC.
2. **Ornith avec `think: false`.** Ornith annonce `tools` et `thinking`. Le banc coupe la réflexion par défaut (comme pour les Qwen3) ; je n'ai pas lancé de seconde série avec réflexion (temps doublé pour une nuit).
3. **Modèles mesurés tels quels** : `qwen2.5-coder:7b`, `jarvis-coder:latest` (ton affinage du 7B), `seed-coder-lab`, `hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q4_K_M`. Contexte 4 096 du banc, appels relus dans le texte activés (`recoverToolCalls`), 3 passages, catalogue d'évaluation (29 missions, jamais vues à l'entraînement).
4. **Jarvis installé fermé** avant le banc (carte graphique libre), relancé à la fin.

## 3. Examen : catalogue d'évaluation, 3 passages, 29 missions

Banc : `lab-bench.mjs --set eval --runs 3`, un seul passage de nuit pour les 4 modèles. Comparaisons `lab-compare.mjs --input` sur ce même banc (rapports `rapports/2026-11-11-examen-<candidat>-contre-qwen2-5-coder-7b.md` et `.json`, datés du 11 par l'horloge UTC du script).

### Scores

| Modèle | Total | Par passage | Missions réussies à la majorité | Niveau 1 | Niveau 2 | Niveau 3 | Durée d'un passage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| qwen2.5-coder:7b (base) | 69/87 (79 %) | 23, 23, 23 | 23/29 | 33/33 | 27/42 | 9/12 | 223 s |
| jarvis-coder:latest | 79/87 (91 %) | 27, 26, 26 | 26/29 | 33/33 | 37/42 | 9/12 | 202 s |
| seed-coder-lab | 75/87 (86 %) | 25, 25, 25 | 25/29 | 33/33 | 33/42 | 9/12 | 396 s |
| Ornith-1.0-9B Q4_K_M | **84/87 (97 %)** | 28, 28, 28 | **28/29** | 33/33 | **39/42** | **12/12** | 373 s |

### Verdicts de `lab:compare` (base qwen2.5-coder:7b)

| Candidat | Écart | Missions gagnées | Missions perdues | Verdict |
| --- | --- | --- | --- | --- |
| jarvis-coder:latest | +10 | 4 (e2-leaf-count, e2-roman-numerals, e2-sum-number-file, l2-need-name) | 1 (e2-to-bool 3/3 → 1/3) | meilleur, conseillé |
| seed-coder-lab | +6 | 2 (e2-leaf-count, e2-roman-numerals) | 0 | meilleur, conseillé |
| Ornith-1.0-9B | +15 | 5 (e2-leaf-count, e2-roman-numerals, e2-sum-number-file, e3-max-by-comparator, l2-note-file) | 0 | meilleur, conseillé |

Ornith contre jarvis-coder (lu dans le même banc, pas un rapport à part) : +5, gagne e3-max-by-comparator, l2-note-file (1/3 → 3/3), e2-to-bool (1/3 → 3/3) ; perd l2-need-name (2/3 → 0/3).

### Causes d'échec, appels d'outil, régularité

| Modèle | Code faux (tests rouges) | Code faux répété sans changement | Appels illisibles | Appels relus dans le texte | Erreurs du modèle | Temps moyen par mission |
| --- | --- | --- | --- | --- | --- | --- |
| qwen2.5-coder:7b | 11 | 4 | **3** | 173 | 6 | 7,7 s |
| jarvis-coder:latest | 5 | 3 | 0 | 132 | 0 | 7,0 s |
| seed-coder-lab | 9 | 3 | 0 | 0 | 0 | 13,7 s |
| Ornith-1.0-9B | 2 | 1 | 0 | 0 | 0 | 12,9 s |

Lecture :

- Les deux Qwen écrivent presque tous leurs appels d'outil dans le texte (173 et 132 relus sur 87 missions) ; le 7B de base en perd encore 3 d'illisibles. Seed-Coder (par le gabarit du dérivé) et Ornith (nativement) rendent des appels structurés : zéro relecture, zéro illisible.
- Ornith est le seul modèle à réussir tout le niveau 3 (12/12) et les mêmes 28 missions à chaque passage. Sa seule mission ratée est `l2-need-name` (0/3), le piège connu de l'examen (`'  '` non refusé) que qwen3-coder:30b rate aussi (5.0.59).
- jarvis-coder est le plus rapide par mission (7,0 s) mais le seul à perdre une mission que la base réussissait (`e2-to-bool`), et ses passages varient (27, 26, 26).

### Vitesse et mémoire de la carte (RTX 2060 6 Go)

Sonde à part : génération fixe de 200 jetons, `num_ctx` 4 096, réflexion coupée, un modèle à la fois, puis `/api/ps`.

| Modèle | Jetons/s (génération) | Jetons/s (lecture du prompt) | Taille Ollama | Sur la carte | Part sur la carte | Chargement |
| --- | --- | --- | --- | --- | --- | --- |
| qwen2.5-coder:7b | 17,3 | 378 | 5,15 Go | 4,20 Go | 82 % | 23,8 s (premier) / 5,0 s (banc) |
| jarvis-coder:latest | 17,8 | 354 | 5,15 Go | 4,20 Go | 82 % | 4,7 s / 6,0 s |
| seed-coder-lab | 14,2 | 217 | 5,07 Go | 4,19 Go | 72 % | 6,3 s |
| Ornith-1.0-9B Q4_K_M | 13,2 | 130 | 5,97 Go | 4,24 Go | 71 % | 7,6 s / 8,2 s |

Aucun des quatre ne tient entièrement sur la carte avec 4 096 de contexte ; Ornith et Seed déportent près de 30 % en RAM, d'où leurs 13 à 14 jetons/s contre 17 à 18 pour les Qwen 7B. Avec le contexte 8 192 du chat, la part sur la carte sera plus basse encore. (Le champ « part sur la carte » du banc est resté vide pour `seed-coder-lab` : le banc cherche le nom sans `:latest` dans `/api/ps` ; la sonde l'a mesuré.)

## 4. Propositions (rien n'est appliqué)

### Base pour jarvis-coder v2

**Proposition : Ornith-1.0-9B.** Raisons chiffrées : 84/87 contre 79/87 pour l'affinage actuel du 7B et 69/87 pour le 7B nu ; 12/12 au niveau 3 (plusieurs fichiers, asynchrone), là où les trois autres plafonnent à 9/12 ; 0 appel illisible et 0 appel à relire, donc une boucle de tâche plus sûre ; licence MIT, affinage permis ; 5,63 Go en Q4_K_M.

Coût de ce choix, à peser :

- 25 % plus lent que jarvis-coder (13,2 contre 17,8 jetons/s) et 30 % hors de la carte. Une mission prend ~1,8 fois plus de temps par appel (12,9 s contre 7,0 s par mission au banc).
- `training/train_lora.py` est bâti sur le gabarit de chat de Qwen2.5 (`apply_chat_template` avec `tools`) et transformers 4.57.6 épinglé. Ornith est une architecture Qwen3.5 : il faut vérifier que cette version de transformers la charge, et que le gabarit (balises de réflexion) donne le même masque de perte. L'export (`convert_hf_to_gguf.py` de llama.cpp `b12032`) doit aussi connaître Qwen3.5. Ce sont des vérifications, pas des inconnues de fond, mais elles précèdent toute nuit d'entraînement.
- Un 9B en QLoRA demande ~11 Go : carte louée de 24 Go comme prévu pour le 7B, pas la RTX 2060.

Alternative sans risque d'outillage : garder Qwen2.5-Coder-7B comme base et réentraîner avec plus d'exercices. jarvis-coder v1 a déjà gagné +10 ; la marge restante jusqu'à Ornith (+5) viendra peut-être d'un cahier plus grand, mais rien ne garantit le niveau 3.

Seed-Coder n'est pas proposé : +6 seulement, aucun gain au niveau 3, et il faut un gabarit maison pour les outils.

### Modèle par rôle dans Jarvis Développeur

| Rôle | Proposition | Pourquoi |
| --- | --- | --- |
| ARCHITECT, REASONER (chef) | `qwen3-coder:30b` | donnée de la mission ; 84/87 à l'examen de 5.0.59 |
| CODER, DEBUGGER, TESTER, REVIEWER (artisan) | `hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q4_K_M` | meilleur du banc : 84/87, 12/12 au niveau 3, appels d'outil structurés |
| RESEARCHER, DOCUMENTATION | pas mesurés par ce banc ; le chef ou l'artisan, au choix | — |

Deux variantes si la vitesse compte plus que les 5 missions d'écart : artisan = `jarvis-coder:latest` (79/87, 17,8 jetons/s, 82 % sur la carte) ; ou artisan = Ornith pour CODER et DEBUGGER seulement, jarvis-coder pour TESTER et REVIEWER.

Un seul modèle est chargé à la fois dans une mission (`keep_alive: 0` au changement de rôle) : chef 30B et artisan 9B ne se partagent pas la carte, chaque bascule coûte le chargement (8 s pour Ornith, plus pour le 30B).

Pour appliquer, toi seul : panneau Développeur → « Modèle de code » → « Modèle par rôle (ton choix) ». Rien n'a été écrit dans `settings.json`.

## 5. État en fin de nuit

- Modèles Ollama déchargés (`keep_alive: 0`), `/api/ps` vide.
- Carte graphique libérée dans `AGENTS-COORDINATION.md`, tâche passée à « terminé ».
- Jarvis installé relancé.
- Restent sur le PC : les deux GGUF dans Ollama (`hf.co/unsloth/Seed-Coder-8B-Instruct-GGUF:Q4_K_M`, `seed-coder-lab`, `hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q4_K_M`), 10,7 Go sur le disque (le dérivé `seed-coder-lab` partage le fichier GGUF d'unsloth) ; à supprimer avec `ollama rm` si tu ne gardes que le retenu.

## RAPPORT DE VÉRIFICATION

- **Lancement (`npm run build`)** : non lancé, aucun fichier de code modifié (rapports et coordination seulement). Le `dist/` du cœur avait été reconstruit avant le banc et le banc a tourné dessus de bout en bout (code de sortie 0).
- **Types** : non concerné (aucun `.ts` modifié).
- **Style** : non concerné.
- **Tests** : non concerné ; aucun test modifié ni ajouté.
- **Secrets** : rapports relus, aucun jeton, aucune clé, aucun chemin temporaire (`grep` sur les six fichiers d'examen : vide).
- **Fichiers modifiés** : `rapports/2026-11-12-banc-equipe-dev.md` (nouveau), `rapports/2026-11-11-examen-*-contre-qwen2-5-coder-7b.md|.json` (six fichiers écrits par `lab-compare.mjs`), `AGENTS-COORDINATION.md` (tâche terminée, carte libre).
- **Prêt à fusionner** : NON par consigne (pas de fusion, pas de publication). La branche est poussée pour relecture.
- **À corriger** : le banc n'inscrit pas la part sur la carte d'un modèle local sans suffixe `:latest` (`seed-coder-lab`) ; détail cosmétique, la sonde a la mesure.
- **Testé en vrai (à la voix, sur le PC)** : PAS FAIT (rien à essayer : mesures seulement, aucun réglage changé).
