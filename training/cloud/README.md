# Entraîner sur une carte louée (RunPod ou Vast.ai)

C'est ici que **le 7B s'entraîne** : la RTX 2060 (6 Go) ne peut pas le faire (il faut ~9 Go en QLoRA, voir
`training/README.md`, étape 3 ; le PC sert à l'essai local sur le 3B). On loue une carte de **24 Go** à l'heure,
on y lance **le même** `train_lora.py`, on rapatrie un seul fichier (le GGUF) et on éteint. Le PC ne fait
ensuite que l'étape Ollama (`export_ollama.py --gguf …`).

Aucune clé, aucun identifiant n'est dans le dépôt ni dans les scripts : la connexion passe par le site
du loueur (console web dans le navigateur, ou ssh avec la commande que le site affiche).

## Ce qu'il faut

- Un compte chez [RunPod](https://www.runpod.io/) ou [Vast.ai](https://vast.ai/), avec quelques euros de crédit (prépayé : pas de mauvaise surprise).
- Le dossier `preparation/` produit par `npm run lab:prepare` (train.jsonl, validation.jsonl **et resume.json** :
  `train_lora.py` y lit l'empreinte de l'examen et le plafond de longueur, et refuse de partir sans ; quelques Mo).
- Le dossier `training/` de ce dépôt (les scripts ; sans `.venv`, `runs`, `export`, `llama.cpp`).

## Quelle carte, quel prix

Prix relevés le **2 novembre 2026**, sur les pages des loueurs eux-mêmes, à revérifier le jour même (ils bougent) :

**RunPod** — [runpod.io/pricing](https://www.runpod.io/pricing), onglet « Pods », grille affichée par défaut
(la page a deux colonnes d'offres, « Community Cloud » et « Secure Cloud » ; les chiffres ci-dessous sont ceux
de la vue par défaut, le site les montre côte à côte au moment de choisir) :

| Carte | Mémoire | Prix / heure | Remarque |
|---|---|---|---|
| RTX A5000 | 24 Go | 0,27 $ | le meilleur rapport pour ce travail |
| RTX 3090 | 24 Go | 0,50 $ | très courante |
| A40 | 48 Go | 0,59 $ | permet `QUANT=0` (LoRA fp16, plus rapide) |
| RTX A6000 | 48 Go | 0,59 $ | idem |
| RTX 4090 | 24 Go | 0,89 $ | plus rapide, plus cher |
| L40S | 48 Go | 1,09 $ | inutilement grand ici |

Disque RunPod (même page) : disque du conteneur 0,10 $/Go/mois ; volume 0,10 $/Go/mois machine allumée, 0,20 $/Go/mois
machine arrêtée ; stockage réseau 0,07 $/Go/mois. Pour 60 Go pendant 3 h : moins de 0,03 $.

**Vast.ai** — [vast.ai/pricing](https://vast.ai/pricing), lue dans un navigateur le 2 novembre 2026 à 9 h UTC (la page
se remplit par script, c'est une place de marché : chaque carte y est donnée « à partir de » et « médian ») :

| Carte | Mémoire | À partir de | Prix médian / heure |
|---|---|---|---|
| RTX 3090 | 24 Go | 0,11 $ | 0,20 $ |
| RTX A5000 | 24 Go | 0,20 $ | 0,23 $ |
| RTX A6000 | 48 Go | 0,40 $ | 0,46 $ |
| RTX 4090 | 24 Go | 0,13 $ | 0,47 $ |
| A40 | 48 Go | 0,47 $ | 0,57 $ |
| L40S | 48 Go | 0,33 $ | 0,73 $ |

Réserves sur Vast.ai : la page ne dit pas si ces médianes valent pour les offres « on-demand » ou « interruptible »
(les secondes, moins chères, peuvent être coupées en pleine nuit : **prendre une offre on-demand**, souvent un peu
au-dessus du médian) ; le disque est facturé par l'hôte, au tarif affiché sur chaque offre. Choisir une offre 24 Go
avec une fiabilité (« reliability ») élevée.

**Estimation (pas une mesure : rien n'a encore tourné)** pour 400 à 500 exemples, 3 époques au plus, longueur 3 072 :
- entraînement QLoRA du 7B sur une carte 24 Go : de l'ordre de **1 à 2 h** ;
- téléchargement du modèle de base (15 Go), fusion, conversion, quantification : **30 à 60 min** de plus ;
- soit **2 à 3 h** de machine :

| Carte (24 Go) | RunPod | Vast.ai (médian) |
|---|---|---|
| RTX A5000 | 0,54 – 0,81 $ | 0,46 – 0,69 $ |
| RTX 3090 | 1,00 – 1,50 $ | 0,40 – 0,60 $ |
| RTX 4090 | 1,78 – 2,67 $ | 0,94 – 1,41 $ |

Plus le disque pendant la session (quelques centimes). **Moins de 1 $ sur une A5000 ou une 3090** si la machine est
éteinte en sortant ; si elle reste allumée une nuit par oubli : 12 h × le prix horaire.

## Pas à pas (RunPod ; Vast.ai est équivalent)

1. **Créer la machine** : « Deploy » → choisir la carte (RTX A5000 24 Go) → image **« RunPod PyTorch »** la plus
   récente (elle contient Python, torch et CUDA) → disque (« Container / Volume disk ») **60 Go au moins**
   (le modèle de base fait 15 Go, la fusion 15 Go, le GGUF f16 15 Go, le Q4_K_M 4,7 Go) → Deploy.
2. **Ouvrir un terminal** sur la machine : bouton « Connect » → « Start Web Terminal » (ou la commande ssh affichée).
3. **Mettre les fichiers sur la machine** (dans le terminal de la machine) :
   - les scripts viennent directement de GitHub (le dépôt est public, rien à envoyer) :

     ```bash
     cd /workspace && git clone --depth 1 https://github.com/dylanloze91-creator/Jarvis.git jarvis
     ```

   - le dossier `preparation/` (quelques Mo, **jamais sur GitHub**) : sur le PC, clic droit sur
     `C:\dev\jarvis-data\preparation` → « Compresser » ; puis « Connect » → « Jupyter Lab », bouton « Upload »
     (flèche vers le haut), choisir `preparation.zip`, et dans le terminal :

     ```bash
     cd /workspace && python -c "import zipfile; zipfile.ZipFile('preparation.zip').extractall('.')" && ls preparation
     ```

     On doit voir `resume.json  train.jsonl  validation.jsonl` (si le zip a créé `preparation/preparation/`,
     utiliser ce chemin-là à l'étape 4).
4. **Garde-fou, puis lancer**, dans le terminal de la machine :

   ```bash
   cd /workspace/jarvis/training
   bash cloud/run_remote.sh /workspace/preparation
   ```

   **Garde-fou** : avant tout, le script vérifie qu'il peut arrêter la machine lui-même (`runpodctl`, présent sur
   chaque machine RunPod). Il l'arrête **au plus tard au bout de 4 h** (`MAX_HOURS=4`), quoi qu'il arrive, et
   **60 min après la fin** de la session, réussie ou non (`AFTER_END_MIN=60`) : c'est le temps laissé pour
   rapatrier les fichiers. « Arrêter » coupe la facturation du calcul et garde `/workspace` : rien n'est perdu.
   S'il ne peut pas arrêter la machine, il refuse de partir et explique quoi faire (une clé API créée sur le site,
   donnée à `runpodctl config --apiKey …` dans ce terminal seulement). Journal : `training/garde-fou.log`.

   Ce qu'on doit voir : `==> Garde-fou` puis `Arrêt automatique dans 4 h au plus`, `==> Carte graphique` avec le nom
   de la carte, `==> Bibliothèques Python`, `==> llama.cpp b12032`, puis `==> Entraînement` avec une ligne
   `époque … perte …` régulièrement, `perte de validation` à chaque époque, `Adaptateur écrit dans …`, puis
   `==> Fusion, conversion GGUF, quantification` et enfin `Terminé. Fichier à rapatrier sur le PC : … jarvis-coder-Q4_K_M.gguf`.

   Réglages possibles avant la commande : `EPOCHS=3 RANK=16 QUANT=1 MAX_HOURS=4` (voir l'en-tête du script).
   La longueur maximale n'a pas à être donnée : `train_lora.py` prend celle de la préparation (`resume.json`).
5. **Rapatrier** deux fichiers sur le PC, dans l'heure qui suit la fin :
   - le GGUF (≈ 4,7 Go) : trop gros pour le navigateur, on utilise le transfert de RunPod. Sur la machine :

     ```bash
     runpodctl send /workspace/jarvis/training/export/jarvis-coder/jarvis-coder-Q4_K_M.gguf
     ```

     Il affiche un code (par exemple `8338-galileo-collect-fidel`). Sur le PC, dans PowerShell, une seule fois :
     `Invoke-WebRequest https://github.com/runpod/runpodctl/releases/latest/download/runpodctl-windows-amd64.exe -OutFile runpodctl.exe`,
     puis `.\runpodctl.exe receive <le code>` : le fichier arrive dans le dossier courant.
   - `training/runs/cloud-<date>/journal.txt` (le compte rendu) : bouton « Download » de Jupyter Lab.
6. **Éteindre et supprimer la machine** (« Stop » puis « Terminate ») : un pod arrêté mais non supprimé continue de
   facturer son disque (quelques centimes par jour). Le garde-fou ne fait que « Stop ».
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
