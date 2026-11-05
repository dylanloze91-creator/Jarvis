# Entraînement de l'élève — essai 1 (4 novembre 2026)

Étapes 1 à 4 de `training/README.md` sur le PC (Windows 10, RTX 2060 6 Go, Python 3.13), branche `claude/entrainement-1`. **Rien d'autre** : pas d'entraînement complet, aucune carte louée, aucun export vers Ollama (`ollama list` ne contient pas `jarvis-coder`). L'adaptateur de l'essai reste dans `training/runs/` (hors git).

## 1. Préparation (`lab:prepare`)

Cahier après la nuit 5 : 453 exercices, tous produits par qwen3-coder:30b.

| | |
| --- | --- |
| Exemples lus | 453 |
| Gardés | **453** |
| Écartés | **0** (aucune ligne illisible, aucun doublon, aucun exemple trop long, **aucune contamination de l'examen** : aucun exemple proche des 29 missions d'`evalCatalog()`) |
| Entraînement | 406 (niv. 1 : 94 · niv. 2 : 193 · niv. 3 : 119) |
| Validation | 47 (niv. 1 : 10 · niv. 2 : 24 · niv. 3 : 13) |
| Thèmes | 79, un thème entier du même côté de la découpe |
| Longueur (jetons estimés) | min 667 · médiane 1 044 · max 1 987 · plafond 3 072 |

Fichiers écrits dans `preparation/` du dossier de données : `train.jsonl`, `validation.jsonl`, `ecartes.jsonl` (vide), `resume.json`.

## 2. Mise en place (`setup-windows.ps1`)

Deux obstacles, tous deux corrigés ou contournés :

- **Python** : seul Python 3.14 était installé ; le script (comme le README) exige 3.10 à 3.13 et s'arrête. Python 3.13.17 installé pour l'utilisateur avec `winget install Python.Python.3.13 --scope user`, à côté du 3.14. Le script le trouve par `py -3.13`.
- **Encodage du script** (bogue, corrigé dans ce commit) : `setup-windows.ps1` était en UTF-8 **sans BOM**. Windows PowerShell 5.1 (`powershell`, celui de la commande du README ; `pwsh` n'est pas installé) lit alors le fichier en ANSI : les guillemets « » et les accents cassent l'analyse (« Jeton inattendu », « Le terminateur " est manquant ») et rien ne s'exécute. Un BOM UTF-8 ajouté en tête suffit.

Résultat ensuite, en une passe (environ 25 min, 2,8 Go pour torch) :

| Contrôle | Résultat |
| --- | --- |
| Carte NVIDIA | **reconnue** : GeForce RTX 2060, 6,0 Go, capacité 7.5 (`sm_75`), pilote 572.16 |
| CUDA | **reconnu** : torch 2.11.0+cu128, CUDA 12.8 ; architectures compilées `sm_75 sm_80 sm_86 sm_90 sm_100 sm_120` |
| bitsandbytes | **reconnu** : 0.50.2, couche `Linear4bit` nf4 créée et traversée sur la carte (`BNB_OK`) |
| Bibliothèques | `pip check` sans conflit |
| llama.cpp b12032 | sources et `llama-quantize.exe` installés |

Avertissement sans conséquence : `triton not found` (comptage de FLOPs seulement).

## 3. Vérification sans la carte (`--dry-run`)

Modèle minuscule aléatoire sur processeur, 406 + 47 exemples, 3 époques, 78 pas, 10 min 14 s. Perte calculée sur 106 890 jetons de réponse sur 402 437 (27 %) : consigne et demande masquées. `DRY-RUN terminé : le circuit fonctionne.`

## 4. Essai court sur la carte (3B, 20 pas)

`train_lora.py --base Qwen/Qwen2.5-Coder-3B-Instruct --max-steps 20`, QLoRA 4 bits nf4, fp16, LoRA rang 16 / alpha 32 (29,9 M de paramètres entraînables), lot 1 × accumulation 16, longueur 3 072 (plafond de la préparation, 0 exemple laissé de côté). Ollama avait `qwen2.5:7b` chargé (4,3 Go de la carte) : déchargé avant (`ollama stop`), il se recharge seul à la prochaine demande du chat.

**Premier lancement : échec au premier pas de l'optimiseur** (bogue, corrigé dans ce commit). `paged_adamw_8bit` garde ses états en mémoire unifiée CUDA (`cudaMallocManaged`) ; sous Windows (pilote WDDM), l'initialisation des états lève `CUDA error: unknown error` dans `bitsandbytes/optim/optimizer.py` (`get_state_buffer` → `fill` → `torch.cuda.synchronize`). Le chargement 4 bits, l'aller et le retour sur 16 exemples avaient réussi. Correctif : option `--optim` (`auto` par défaut) ; `auto` = `adamw_torch` sans 4 bits, `paged_adamw_8bit` avec 4 bits hors Windows (carte louée inchangée), **`adamw_bnb_8bit` sous Windows** (mêmes états 8 bits, alloués sur la carte). L'optimiseur retenu est écrit sur la ligne « Réglages » du journal.

**Second lancement (mesures demandées)** :

| Mesure | Valeur |
| --- | --- |
| Pic de mémoire de carte | **5,44 Go** sur 6,0 (`torch.cuda.max_memory_allocated`) |
| Temps par pas (16 exemples) | **49 s** (20 pas en 16 min 12 s ; 50 s par pas entre le pas 5 et le pas 20) ; carte à 99 % |
| Perte au début | **0,4056** (pas 5, première ligne journalisée) |
| Perte à la fin | **0,2192** (pas 20) ; moyenne sur les 20 pas 0,2840 |
| Perte de validation | **0,2417** (47 exemples, époque 0,79) |
| Durée totale | 17 min 05 s (chargement 10 s, modèle déjà en cache ; premier téléchargement du 3B : 10 min) |

Lecture : la perte baisse franchement dès les 20 premiers pas (0,41 → 0,22) sans divergence ; la mémoire tient, mais avec 0,5 Go de marge seulement. Une nuit complète sur le 3B serait en fait courte : 406 exemples / 16 = 26 pas par époque, soit **environ 21 min par époque et 1 h 05 pour 3 époques** (plus la validation), bien moins que « une nuit » estimée dans le README (mis à jour).

## Ce qui a changé dans le dépôt

- `training/setup-windows.ps1` : BOM UTF-8.
- `training/train_lora.py` : option `--optim` (auto / `paged_adamw_8bit` / `adamw_bnb_8bit` / `adamw_torch`), choix automatique `adamw_bnb_8bit` sous Windows, optimiseur dans la ligne « Réglages » du journal.
- `training/README.md` : mesures du 4 novembre et note sur l'optimiseur.
- `AGENTS-COORDINATION.md` : ressource GPU réservée pendant l'essai, libérée après.

Hors dépôt : `training/.venv`, `training/llama.cpp`, `training/runs/<deux essais>` (ignorés par git) ; cache Hugging Face du 3B (6 Go).

## Suite possible (décision de l'utilisateur)

1. Entraînement complet du 3B sur le PC (environ 1 h 05, carte réservée), puis `export_ollama.py` et `lab:compare` contre `qwen2.5-coder:7b`, en gardant à l'esprit que c'est un 3B.
2. Ou le 7B sur une carte louée de 24 Go (`training/cloud/README.md`) : `run_remote.sh` tourne sous Linux et garde `paged_adamw_8bit`.
