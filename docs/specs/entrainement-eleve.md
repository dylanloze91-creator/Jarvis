# Cahier des charges — Outils d'entraînement du modèle de Jarvis (5.0.65)

Rédigé par Claude pour Cursor, le 2 novembre 2026. À faire **après** l'enceinte (`enceinte-jarvis.md`). Lire `CLAUDE.md` en entier avant de commencer, en particulier 5.0.55 à 5.0.61 (catalogue, générateur, cahier d'exercices).

## Où on en est

- **L'élève** : `qwen2.5-coder:7b` (Apache 2.0), 23 sur 29 à l'examen (`npm run lab --workspace @jarvis/core -- --set eval --model qwen2.5-coder:7b --runs 3`, environ 66 à 69 sur 87 en trois passages).
- **Le cahier** : `C:\dev\jarvis-data\entrainement.jsonl` sur le PC de l'utilisateur (183 exercices, la génération de nuit en ajoute). Format : un exemple par ligne, conversation système + demande + réponse `write_file` (format `tool_calls`), avec `tools` et `meta` (voir `trainingExampleFromFiles` dans `packages/core/src/developer/labGenerator.ts`).
- **Le but** : quand le cahier atteindra 400 à 500 exercices, entraîner l'élève (affinage LoRA), l'installer dans Ollama sous le nom `jarvis-coder`, le repasser à l'examen et le garder seulement s'il dépasse 23 sur 29.
- Il existe déjà un petit entraîneur pour l'apprentissage local (`apps/desktop/scripts/jarvis-qlora-train.py`, `main/learning/`). **Ne pas le modifier** : il sert à autre chose (préférences de l'utilisateur) et ne gère pas les appels d'outils. L'outillage ci-dessous est séparé.

## Règles qui ne se discutent pas

1. **Aucun texte écrit par Claude ni par Cursor dans les données d'entraînement.** Cursor écrit l'outillage, jamais un exercice, un énoncé, une solution ni un exemple. Les fichiers de test utilisent des exemples synthétiques minuscules marqués comme tels, jamais copiés dans le cahier.
2. **L'examen ne fuit jamais dans l'entraînement** : avant chaque entraînement, chaque exemple est comparé aux 29 missions de `evalCatalog()` (`labContamination`, noms exportés, objectifs proches). Un exemple suspect est écarté et listé.
3. **Rien de personnel ni de secret dans le dépôt** : pas de données, pas de chemins de l'utilisateur, pas de jeton (dépôt public).
4. **La carte graphique** : tout ce qui la sert se réserve dans `AGENTS-COORDINATION.md` (règle existante). Rien de tout cela ne se lance cette nuit : la génération tourne sur le PC.
5. **Le modèle entraîné ne remplace rien automatiquement.** Le choix final reste à l'utilisateur, après l'examen.

## À livrer

### 1. Préparation des données (Node, `packages/core`, testée)

Script `npm run lab:prepare --workspace @jarvis/core -- --dir C:\dev\jarvis-data` (code dans `src/developer/labTrainPrep.ts` + `scripts/lab-prepare.mjs`) :

- lit `entrainement.jsonl` (et `exercices.jsonl` pour le niveau et le thème) ;
- écarte : lignes illisibles, exemples sans appel `write_file`, doublons exacts, exemples trop longs (plafond en jetons estimés, réglable, défaut 3 072), suspects de contamination de l'examen (règle 2) ;
- découpe **train / validation** (90 / 10 %, déterministe par une graine, réparti par niveau) ;
- écrit `preparation/train.jsonl`, `preparation/validation.jsonl`, `preparation/ecartes.jsonl` (avec la raison) et `preparation/resume.json` (nombres, niveaux, longueurs, raisons d'écart) ;
- refuse de préparer avec moins de 100 exemples gardés (message clair : « il faut encore des nuits de génération »).

Tests Vitest avec des exemples synthétiques : écarts et raisons, découpe stable, contamination détectée sur un exemple qui reprend une mission d'évaluation, plafond de longueur.

### 2. Entraînement (Python, dossier `training/` à la racine, hors workspaces npm)

- `training/requirements.txt` avec des versions **épinglées** (torch, transformers, peft, trl, bitsandbytes, datasets, accelerate) ; `training/setup-windows.ps1` qui crée un environnement Python à part (`training/.venv`, dans `.gitignore`) et installe tout, avec des messages en français ; vérifie la présence de la carte NVIDIA et de CUDA.
- `training/train_lora.py` :
  - base Hugging Face `Qwen/Qwen2.5-Coder-7B-Instruct` (celle d'`qwen2.5-coder:7b`) ; base réglable ;
  - **format des appels d'outils correct** : utiliser `tokenizer.apply_chat_template(messages, tools=tools)` pour reproduire exactement ce que voit le modèle dans Ollama (la conversation avec `tool_calls`), pas un format maison ;
  - perte calculée **seulement sur la réponse de l'assistant** (pas sur la consigne ni la demande) ;
  - QLoRA 4 bits, adapté à une **RTX 2060 6 Go** (pas de bf16 sur cette carte : fp16 ; lot de 1, accumulation, gradient checkpointing, longueur maximale réglable) ; rang, alpha, taux d'apprentissage, époques réglables, avec des valeurs par défaut raisonnables et expliquées ;
  - perte de validation à chaque époque, arrêt sur la meilleure, reprise après coupure, journal lisible (`training/runs/<date>/journal.txt`) ;
  - mode `--dry-run` sur un **tout petit modèle** (par exemple un Qwen2 aléatoire minuscule de Hugging Face) qui tourne sur processeur : sert aux tests et à vérifier le circuit sans carte graphique.
- `training/export_ollama.py` : fusionne l'adaptateur dans la base, convertit en GGUF avec llama.cpp (`convert_hf_to_gguf.py`, version épinglée, récupérée par le script de mise en place), quantifie en Q4_K_M, écrit un `Modelfile` qui reprend **le gabarit de chat et les paramètres de `qwen2.5-coder:7b`** (relus avec `ollama show --modelfile qwen2.5-coder:7b`, pas recopiés de mémoire) et lance `ollama create jarvis-coder`. Raison : Ollama n'accepte pas forcément un adaptateur LoRA séparé pour Qwen ; un GGUF complet est le chemin sûr. Vérifier cette affirmation dans la documentation d'Ollama et l'écrire dans le guide.
- **Option carte louée** (si la RTX 2060 ne suffit pas) : `training/cloud/README.md` + script pour RunPod ou Vast.ai : envoyer `preparation/`, entraîner, récupérer le GGUF, éteindre la machine. Estimation du coût et de la durée (à vérifier sur leurs pages de prix, pas de mémoire). Aucune clé dans le dépôt.

### 3. Examen et décision

- `npm run lab:compare --workspace @jarvis/core -- --base qwen2.5-coder:7b --candidate jarvis-coder --runs 3` : examen des 29 missions pour les deux modèles (réutilise `lab-bench.mjs`), tableau mission par mission, total, et verdict simple en français : « meilleur », « pareil » ou « moins bon », avec la règle : le candidat n'est conseillé que s'il dépasse la base sur le total **et** ne perd pas plus de 2 missions qu'elle réussissait.
- Rapport JSON + résumé lisible dans `rapports/` (sans exercice ni chemin personnel).

### 4. Guide pour l'utilisateur (`training/README.md`, français simple)

Non-développeur, Windows : quand lancer (cahier ≥ 400), préparation, mise en place (une fois), entraînement local (durée estimée), ou carte louée (coût estimé), export vers Ollama, examen, décision, retour en arrière (`ollama rm jarvis-coder`, rien d'autre ne change). Chaque commande à copier, avec ce qu'on doit voir s'afficher.

## Tests

- Node : Vitest pour la préparation et la comparaison (faux résultats de banc), dans `npm test`.
- Python : `training/tests/` (pytest) sur le mode `--dry-run` (format du gabarit avec appels d'outils, masque de la perte, découpe, reprise) ; à lancer dans l'environnement de Cursor si l'installation passe sur processeur, sinon le dire dans le rapport.
- `chat-unchanged.test.ts`, `ollama-unchanged.test.ts`, `labCatalog.test.ts` verts **sans régénération**.

## Règles de livraison

- Branche `cursor/entrainement-5065`, inscrite dans `AGENTS-COORDINATION.md`. Pas de fusion dans `main`, pas de publication : l'utilisateur relira.
- Avant de pousser : `npm run typecheck`, `npm test`, `npm run lint` (5 échecs dotnet attendus seulement).
- `CLAUDE.md` : section « 5.0.65 — outils d'entraînement de l'élève » au même format que les autres, et une ligne dans « Ce qu'il ne faut pas casser » (règles 1, 2 et 5 ci-dessus).
- Rapport `rapports/2026-11-02-entrainement-5065.md` : fait, testé, non testé (rien n'a tourné sur une vraie carte), choix, questions pour l'utilisateur.
