#!/usr/bin/env bash
# Entraînement de l'élève de Jarvis sur une carte louée (RunPod, Vast.ai) — 5.0.65.
#
# À lancer SUR la machine louée (Linux, image PyTorch avec CUDA), depuis le dossier training/
# envoyé depuis le PC (voir cloud/README.md). Aucune clé, aucun compte dans ce fichier : la
# connexion à la machine se fait avec l'outil du loueur (console web ou ssh), pas d'ici.
#
#   bash cloud/run_remote.sh /workspace/preparation
#
# Variables facultatives :
#   EPOCHS=3  RANK=16  ALPHA=32  LR=2e-4  (mêmes réglages que train_lora.py)
#   MAX_LENGTH   non fixé par défaut : train_lora.py prend le plafond de la préparation (resume.json)
#   QUANT=1      1 = QLoRA 4 bits (défaut, suffit sur 24 Go) ; 0 = LoRA fp16 entier (plus rapide, ≥ 24 Go)
#   LLAMA_TAG=b12032   version de llama.cpp (la même que setup-windows.ps1)
#
# Résultat : training/export/jarvis-coder/jarvis-coder-Q4_K_M.gguf (≈ 4,7 Go), à rapatrier sur le PC.
# Puis sur le PC : .venv\Scripts\python export_ollama.py --gguf <fichier.gguf>
# Et surtout : ÉTEINDRE la machine louée (la facturation court tant qu'elle existe).

set -euo pipefail

PREPARATION="${1:-}"
if [[ -z "$PREPARATION" || ! -f "$PREPARATION/train.jsonl" || ! -f "$PREPARATION/validation.jsonl" ]]; then
  echo "Usage : bash cloud/run_remote.sh <dossier preparation/ contenant train.jsonl et validation.jsonl>" >&2
  exit 1
fi

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ICI"
LLAMA_TAG="${LLAMA_TAG:-b12032}"
QUANT="${QUANT:-1}"
RUN_DIR="$ICI/runs/cloud-$(date +%Y-%m-%d-%H%M)"
EXPORT_DIR="$ICI/export/jarvis-coder"

echo "==> Carte graphique"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || { echo "nvidia-smi absent : cette machine n'a pas de carte NVIDIA visible." >&2; exit 1; }

echo "==> Bibliothèques Python (torch est déjà dans l'image ; le reste vient de requirements.txt)"
python -m pip install --quiet --upgrade pip
# torch est laissé tel que fourni par l'image du loueur (compilé pour sa CUDA) ; tout le reste est épinglé.
grep -v '^torch==' requirements.txt | grep -v '^#' | grep -v '^$' > /tmp/requirements-sans-torch.txt
python -m pip install --quiet -r /tmp/requirements-sans-torch.txt
python - <<'EOF'
import torch
assert torch.cuda.is_available(), "torch ne voit pas la carte"
print("torch", torch.__version__, "CUDA", torch.version.cuda, "-", torch.cuda.get_device_name(0))
EOF

echo "==> llama.cpp $LLAMA_TAG (convertisseur + llama-quantize)"
mkdir -p llama.cpp/bin
if [[ ! -f "llama.cpp/llama.cpp-$LLAMA_TAG/convert_hf_to_gguf.py" ]]; then
  curl -sSL -o /tmp/llama-src.zip "https://github.com/ggml-org/llama.cpp/archive/refs/tags/$LLAMA_TAG.zip"
  python -c "import zipfile; zipfile.ZipFile('/tmp/llama-src.zip').extractall('llama.cpp')"
fi
if [[ ! -x "llama.cpp/bin/llama-quantize" ]]; then
  curl -sSL -o /tmp/llama-bin.tar.gz "https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG/llama-$LLAMA_TAG-bin-ubuntu-x64.tar.gz"
  mkdir -p /tmp/llama-bin && tar -xzf /tmp/llama-bin.tar.gz -C /tmp/llama-bin
  SRC_DIR="$(dirname "$(find /tmp/llama-bin -name llama-quantize -type f | head -n 1)")"
  cp "$SRC_DIR"/* llama.cpp/bin/
  chmod +x llama.cpp/bin/llama-quantize
fi

echo "==> Entraînement → $RUN_DIR"
ARGS=(--data "$PREPARATION" --out "$RUN_DIR"
      --epochs "${EPOCHS:-3}"
      --rank "${RANK:-16}" --alpha "${ALPHA:-32}" --lr "${LR:-2e-4}")
if [[ -n "${MAX_LENGTH:-}" ]]; then ARGS+=(--max-length "$MAX_LENGTH"); fi
if [[ "$QUANT" == "0" ]]; then ARGS+=(--no-quant); fi
python train_lora.py "${ARGS[@]}"

echo "==> Fusion, conversion GGUF, quantification Q4_K_M → $EXPORT_DIR"
python export_ollama.py --run "$RUN_DIR" --out "$EXPORT_DIR" --llama "$ICI/llama.cpp" --gguf-only --clean

echo
echo "Terminé. Fichier à rapatrier sur le PC :"
ls -lh "$EXPORT_DIR"/*.gguf
echo "Journal de l'entraînement : $RUN_DIR/journal.txt (à rapatrier aussi, c'est le compte rendu)."
echo "N'OUBLIE PAS D'ÉTEINDRE ET DE SUPPRIMER LA MACHINE LOUÉE."
