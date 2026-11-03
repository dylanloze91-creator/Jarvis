# Entraînement Piper sur une carte louée

Même principe que `training/cloud/README.md` : louer une machine **24 Go**, y envoyer le dossier `voice-studio/` (sans `.venv`, sans `candidates/`, sans `corpus/` entier si trop lourd — envoyer `corpus/wav` + `metadata.csv`), lancer l'entraînement, rapatrier `export/*.onnx` + `.onnx.json`, **éteindre** la machine.

Aucune clé dans le dépôt.

## Prix relevés le 2026-11-03

| Fournisseur | Page | Carte 24 Go | Prix / h (lu ce jour) |
| --- | --- | --- | --- |
| RunPod | [runpod.io/pricing](https://www.runpod.io/pricing) | RTX A5000 Secure Cloud | **0,27 $** |
| RunPod | idem | RTX 3090 Secure Cloud | **0,50 $** |
| Vast.ai | [vast.ai/pricing](https://vast.ai/pricing) | marché (médian RTX 3090 affiché dynamiquement) | **~0,20 $** (médian page ; choisir on-demand) |

Disque : prévoir **40 Go** (corpus wav ~1,5 h + cache Piper + checkpoints).

## Durée (estimation, non mesurée)

| Phase | Ordre de grandeur |
| --- | --- |
| Synthèse corpus 1,5 h (Parler, GPU) | 2–4 h |
| Affinage Piper (~750 époques, batch 16) | 2–4 h |
| Export ONNX | 15–30 min |

Total **4–8 h** → coût typique **1–3 $** sur A5000 RunPod si la machine est éteinte en sortant.

## Pas à pas

1. **Créer la machine** : image PyTorch récente (CUDA), disque ≥ 40 Go.
2. **Transférer** : `voice-studio/` (scripts + `corpus/` après `corpus.py`).
3. **Installer** :

```bash
cd /workspace/voice-studio
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cu128
.venv/bin/pip install git+https://github.com/huggingface/parler-tts.git
.venv/bin/pip install git+https://github.com/OHF-Voice/piper1-gpl.git
apt-get update && apt-get install -y espeak-ng build-essential cmake ninja-build
```

4. **Checkpoint de base** : télécharger le `.ckpt` `fr_FR-siwis-medium` (ou `upmc`) depuis Hugging Face `rhasspy/piper-voices` → `checkpoints/`.
5. **Entraîner** :

```bash
.venv/bin/python entrainer_piper.py --corpus corpus --export export --epochs 750
```

6. **Rapatrier** `export/fr_FR-jarvis-medium.onnx` et `.onnx.json`, puis suivre `INSTALLATION.md` sur le PC Windows.

Script d'aide (facultatif) : `run_remote.sh` — installe les dépendances et lance `entrainer_piper.py` avec les chemins `/workspace/voice-studio`.
