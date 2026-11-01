# Entraîner sur une carte louée (RunPod ou Vast.ai)

Si la RTX 2060 (6 Go) ne suffit pas — erreur « CUDA out of memory » même avec `--max-length 1024`, ou nuit
trop courte — on loue une carte à l'heure, on y lance **le même** `train_lora.py`, on rapatrie un seul
fichier (le GGUF) et on éteint. Le PC ne fait ensuite que l'étape Ollama (`export_ollama.py --gguf …`).

Aucune clé, aucun identifiant n'est dans le dépôt ni dans les scripts : la connexion passe par le site
du loueur (console web dans le navigateur, ou ssh avec la commande que le site affiche).

## Ce qu'il faut

- Un compte chez [RunPod](https://www.runpod.io/) ou [Vast.ai](https://vast.ai/), avec quelques euros de crédit (prépayé : pas de mauvaise surprise).
- Le dossier `preparation/` produit par `npm run lab:prepare` (train.jsonl, validation.jsonl ; quelques Mo).
- Le dossier `training/` de ce dépôt (les scripts ; sans `.venv`, `runs`, `export`, `llama.cpp`).

## Quelle carte, quel prix

Prix relevés le **2 novembre 2026** sur [runpod.io/pricing](https://www.runpod.io/pricing) (offre « Secure Cloud », à l'heure, à revérifier le jour même : ils bougent) :

| Carte | Mémoire | Prix / heure | Remarque |
|---|---|---|---|
| RTX A5000 | 24 Go | 0,27 $ | le meilleur rapport pour ce travail |
| RTX 3090 | 24 Go | 0,50 $ | très courante |
| A40 | 48 Go | 0,59 $ | permet `QUANT=0` (LoRA fp16, plus rapide) |
| RTX 4090 | 24 Go | 0,89 $ | plus rapide, plus cher |
| L40S | 48 Go | 1,09 $ | inutilement grand ici |

Vast.ai : la page [vast.ai/pricing](https://vast.ai/pricing) est une place de marché dont les prix changent à chaque
minute et ne se lisent qu'en ligne (pas de grille fixe, donc aucun chiffre recopié ici). Choisir une offre « 24 Go »
avec une fiabilité (« reliability ») élevée, et comparer son prix horaire à la grille RunPod ci-dessus.

**Estimation (pas une mesure : rien n'a encore tourné)** pour 400 à 500 exemples, 3 époques au plus, longueur 3 072 :
- entraînement QLoRA sur une carte 24 Go : de l'ordre de **1 à 2 h** ;
- téléchargement du modèle de base (15 Go), fusion, conversion, quantification : **30 à 60 min** de plus ;
- soit **2 à 3 h** de machine, **moins de 2 $ sur une A5000, moins de 3 $ sur une 3090**, plus le stockage du
  volume pendant la session (quelques centimes). Si la machine reste allumée une nuit par oubli : 12 h × le prix horaire.

## Pas à pas (RunPod ; Vast.ai est équivalent)

1. **Créer la machine** : « Deploy » → choisir la carte (RTX A5000 24 Go) → image **« RunPod PyTorch »** la plus
   récente (elle contient Python, torch et CUDA) → disque (« Container / Volume disk ») **60 Go au moins**
   (le modèle de base fait 15 Go, la fusion 15 Go, le GGUF f16 15 Go, le Q4_K_M 4,7 Go) → Deploy.
2. **Ouvrir un terminal** sur la machine : bouton « Connect » → « Start Web Terminal » (ou la commande ssh affichée).
3. **Envoyer les fichiers** : depuis le PC, avec l'outil de transfert du site (« Upload » dans l'explorateur de
   fichiers Jupyter de l'image) ou `scp` avec la commande que le site affiche :
   - le dossier `training/` du dépôt → `/workspace/training`
   - le dossier `preparation/` → `/workspace/preparation`
4. **Lancer**, dans le terminal de la machine :

   ```bash
   cd /workspace/training
   bash cloud/run_remote.sh /workspace/preparation
   ```

   Ce qu'on doit voir : `==> Carte graphique` avec le nom de la carte, `==> Bibliothèques Python`, `==> llama.cpp b12032`,
   puis `==> Entraînement` avec une ligne `époque … perte …` régulièrement, `perte de validation` à chaque époque,
   `Adaptateur écrit dans …`, puis `==> Fusion, conversion GGUF, quantification` et enfin
   `Terminé. Fichier à rapatrier sur le PC : … jarvis-coder-Q4_K_M.gguf`.

   Réglages possibles avant la commande : `EPOCHS=3 MAX_LENGTH=3072 RANK=16 QUANT=1` (voir l'en-tête du script).
5. **Rapatrier** deux fichiers sur le PC (téléchargement depuis l'explorateur Jupyter, ou `scp`) :
   - `/workspace/training/export/jarvis-coder/jarvis-coder-Q4_K_M.gguf` (≈ 4,7 Go)
   - `/workspace/training/runs/cloud-<date>/journal.txt` (le compte rendu de l'entraînement)
6. **Éteindre et supprimer la machine** (« Stop » puis « Terminate ») : un pod arrêté mais non supprimé continue de
   facturer son disque.
7. **Sur le PC**, depuis `training\` :

   ```powershell
   .venv\Scripts\python export_ollama.py --gguf C:\chemin\vers\jarvis-coder-Q4_K_M.gguf
   ```

   puis l'examen (`npm run lab:compare …`), comme dans `training/README.md`.

## Si ça se passe mal

- `torch ne voit pas la carte` : mauvaise image (prendre une image « PyTorch » avec CUDA), ou machine sans GPU.
- `CUDA out of memory` sur 24 Go : improbable en QLoRA ; réduire `MAX_LENGTH=2048`.
- Coupure en cours d'entraînement : relancer la même commande ; `train_lora.py` reprend au dernier point
  de reprise du dossier `runs/cloud-<date>` si on lui redonne le même `--out` (modifier `RUN_DIR` en tête de script
  ou lancer `python train_lora.py --data … --out runs/cloud-<date>` à la main).
- Rien n'est envoyé ailleurs que sur la machine louée, et rien n'y reste après « Terminate ».
