# Entraîner un LoRA SDXL sur une carte louée (RunPod ou Vast.ai)

Un **LoRA** est un petit fichier (`.safetensors`, 50 à 200 Mo) qui apprend à SDXL un style, un personnage ou un objet à partir de 15 à 40 images. On l'entraîne sur une carte graphique louée (24 Go), parce que la RTX 2060 (6 Go) du PC ne peut pas. Ensuite, le fichier se range dans Forge et Jarvis s'en sert avec `generer_image`.

Temps total : environ 1 h 30 la première fois. Coût : **1 à 3 € par entraînement** (voir le tableau à la fin). Le point le plus important est à l'étape 7 : **éteindre et supprimer la machine louée**, sinon elle est facturée toute la nuit.

---

## 1. Préparer les images (sur ton PC)

1. Mets 15 à 40 images dans un dossier, par exemple `C:\Photos\mon-style`. Même sujet ou même style, bonne qualité, cadrages variés.
2. Choisis un **mot-clé déclencheur** : un mot qui n'existe pas (`mnstyl`, `drvink`, `zxpong`…). C'est lui qui activera le LoRA dans un prompt.
3. Dans un terminal (touche Windows, tape `cmd`, Entrée) :

```text
cd C:\dev\Jarvis\training\lora
python -m pip install pillow
python preparer_images.py --source "C:\Photos\mon-style" --nom mon-style --declencheur mnstyl --legende "sticker, white background"
```

Résultat : `C:\dev\Jarvis\training\lora\jeux\mon-style\20_mnstyl\` avec les images redimensionnées (1024 px) et, pour chacune, un fichier texte qui commence par le déclencheur. Ce dossier n'est jamais mis dans Git.

4. Ouvre `config_sdxl_lora_24go.toml` avec le Bloc-notes et change seulement les trois lignes « À ADAPTER » : `train_data_dir` (ici `/workspace/jeux/mon-style`), `output_name` (ici `mon-style`), et laisse `pretrained_model_name_or_path` tel quel si tu suis le guide.

## 2. Louer une carte

### RunPod (runpod.io)

1. Crée un compte, mets **10 €** de crédit (carte bancaire). Pas d'abonnement.
2. Menu **Pods** → **Deploy**. Choisis une **RTX 4090 (24 Go)** « Secure Cloud » ou « Community Cloud » (moins cher). Une RTX 3090 va aussi.
3. Template : **RunPod PyTorch 2.x** (avec CUDA 12). Mets le disque du conteneur à **40 Go** (le modèle SDXL fait 7 Go).
4. Clique **Deploy**. Attends le statut « Running », puis **Connect → Start Web Terminal** (une page noire où taper des commandes).

### Vast.ai (vast.ai)

1. Crée un compte, mets **10 $** de crédit.
2. **Search** : filtre GPU « RTX 4090 », RAM ≥ 24 Go, disque ≥ 40 Go, « Verified » coché. Choisis une machine à 0,30 à 0,50 $/h avec une bonne note de fiabilité.
3. Template : **PyTorch (CUDA 12)**. Clique **Rent**.
4. Dans **Instances**, quand c'est « Running », ouvre le terminal (bouton **>_** ou « Open »).

## 3. Installer les outils d'entraînement (sur la machine louée, 5 minutes)

Copie-colle ces lignes dans le terminal de la machine louée, une par une :

```bash
cd /workspace
git clone https://github.com/kohya-ss/sd-scripts.git
cd sd-scripts
git checkout sd3
python -m venv venv && source venv/bin/activate
pip install --upgrade pip
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
pip install xformers bitsandbytes
accelerate config default
```

Puis télécharge le modèle SDXL officiel (7 Go, 1 à 3 minutes) :

```bash
cd /workspace
wget -O sd_xl_base_1.0.safetensors "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
```

## 4. Envoyer tes images et le fichier de réglages

Le plus simple : un fichier zip envoyé par le navigateur.

1. Sur ton PC, clic droit sur le dossier `C:\dev\Jarvis\training\lora\jeux\mon-style` → **Compresser dans un fichier ZIP** → `mon-style.zip`.
2. RunPod : dans le pod, **Connect → Jupyter Lab** (ou le bouton d'upload du Web Terminal). Vast.ai : bouton **Jupyter** de l'instance. Glisse `mon-style.zip` et `config_sdxl_lora_24go.toml` dans le dossier `/workspace`.
3. Dans le terminal :

```bash
cd /workspace
mkdir -p jeux && unzip -o mon-style.zip -d jeux/
ls jeux/mon-style
```

Tu dois voir le dossier `20_mnstyl`.

## 5. Lancer l'entraînement (30 à 60 minutes)

```bash
cd /workspace/sd-scripts && source venv/bin/activate
accelerate launch --num_cpu_threads_per_process 2 sdxl_train_network.py --config_file /workspace/config_sdxl_lora_24go.toml
```

Des lignes défilent avec un pourcentage et une valeur `loss` (elle doit baisser, grosso modo de 0,15 vers 0,08). Quand c'est fini : `model saved` et le fichier est dans `/workspace/sorties/mon-style.safetensors` (plus des versions intermédiaires `mon-style-000002.safetensors`, etc.).

Si tu vois `CUDA out of memory` : ouvre le `.toml`, mets `train_batch_size = 1`, relance.

## 6. Récupérer le fichier

Dans Jupyter Lab, ouvre `/workspace/sorties/`, clic droit sur `mon-style.safetensors` → **Download**. Sur ton PC, pose-le dans :

```text
C:\dev\Forge\models\Lora\mon-style.safetensors
```

Forge le voit tout de suite (si Forge est allumé, clique « Refresh » dans l'onglet Lora, ou laisse Jarvis le relancer).

## 7. ÉTEINDRE ET SUPPRIMER LA MACHINE LOUÉE (obligatoire)

Tant que la machine existe, elle est facturée, même à l'arrêt (le disque reste payant).

- **RunPod** : page Pods → ton pod → **Stop**, puis **Terminate** (poubelle). Vérifie que la liste est vide.
- **Vast.ai** : page Instances → ton instance → **Destroy** (poubelle). Vérifie que la liste est vide.

Puis regarde ton solde : il ne doit plus baisser. C'est la seule étape où une erreur coûte vraiment de l'argent.

## 8. Utiliser le LoRA dans Jarvis

Dis ou écris à Jarvis :

> Génère un sticker de renard pour Drivers Ink avec le LoRA mon-style

Ou, plus précis :

> Génère une image, projet drivers-ink, prompt « mnstyl fox head, bold outlines », LoRA mon-style poids 0.9

Jarvis ajoute `<lora:mon-style:0.9>` au prompt. Le mot-clé déclencheur (`mnstyl`) doit apparaître dans le prompt pour que le style s'active. Le fichier texte à côté de l'image garde le LoRA et le poids utilisés.

---

## Coût approximatif (prix relevés le 9 novembre 2026, à vérifier au moment de louer)

| Fournisseur | Carte | Prix horaire constaté | Entraînement de 30 images, 10 époques | Total avec installation (≈ 1 h 30) |
| --- | --- | --- | --- | --- |
| RunPod Community Cloud | RTX 4090 24 Go | 0,34 à 0,69 $/h | 30 à 45 min | **1 à 2 $** |
| RunPod Secure Cloud | RTX 4090 24 Go | ≈ 0,69 $/h | 30 à 45 min | **≈ 1,5 $** |
| Vast.ai | RTX 4090 24 Go | 0,25 à 0,50 $/h | 30 à 45 min | **1 à 1,5 $** |
| Vast.ai | RTX 3090 24 Go | 0,15 à 0,30 $/h | 50 à 70 min | **0,5 à 1 $** |

Le stockage du disque coûte quelques centimes par heure en plus tant que la machine existe : d'où l'étape 7.

## Problèmes courants

- **« No data found »** : le dossier des images n'a pas la forme `jeux/mon-style/20_mnstyl/` ou `train_data_dir` pointe ailleurs.
- **Images noires à la génération** : le fichier a été entraîné sans `no_half_vae` ; relance avec le `.toml` fourni.
- **Le style n'apparaît pas** : le déclencheur manque dans le prompt, ou le poids est trop bas (monte à 1.0).
- **Le style écrase tout** : baisse le poids (0.6), ou réduis `max_train_epochs` à 6.
