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
#   MAX_HOURS=4        garde-fou : la machine s'arrête seule au bout de ce délai, même si tout est bloqué
#   AFTER_END_MIN=60   après la fin (réussie ou non), délai laissé pour rapatrier les fichiers, puis arrêt
#   SANS_GARDE_FOU=1   lancer quand même si le garde-fou ne peut pas fonctionner (déconseillé)
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

# ---- Garde-fou : la facturation ne doit jamais courir sans limite ----
MAX_HOURS="${MAX_HOURS:-4}"
AFTER_END_MIN="${AFTER_END_MIN:-60}"
JOURNAL_GARDE="${ICI}/garde-fou.log"
echo "==> Garde-fou (arrêt automatique de la machine)"
GARDE_OK=0
if [[ -n "${RUNPOD_POD_ID:-}" ]] && command -v runpodctl >/dev/null 2>&1 && runpodctl get pod "$RUNPOD_POD_ID" >/dev/null 2>&1; then
  GARDE_OK=1
fi
if [[ "$GARDE_OK" != "1" ]]; then
  echo "ATTENTION : la machine ne pourra pas s'arrêter toute seule (runpodctl absent, pas sur RunPod, ou sans autorisation)." >&2
  echo "  Sur RunPod : crée une clé API sur le site (Settings → API Keys), puis dans ce terminal :" >&2
  echo "    runpodctl config --apiKey <ta clé>      (la clé reste sur cette machine louée, jamais dans le dépôt)" >&2
  echo "  et relance. Pour lancer quand même : SANS_GARDE_FOU=1 bash cloud/run_remote.sh ..." >&2
  if [[ "${SANS_GARDE_FOU:-0}" != "1" ]]; then exit 2; fi
  echo "Lancement SANS garde-fou : surveille la machine et éteins-la toi-même." >&2
else
  nohup setsid bash "$ICI/cloud/garde_fou.sh" "$((MAX_HOURS * 3600))" "$MAX_HOURS h écoulées" >>"$JOURNAL_GARDE" 2>&1 &
  GARDE_PID=$!
  echo "Arrêt automatique dans $MAX_HOURS h au plus (journal : $JOURNAL_GARDE)."
  fin_de_session() {
    local code=$?
    kill "$GARDE_PID" 2>/dev/null || true
    nohup setsid bash "$ICI/cloud/garde_fou.sh" "$((AFTER_END_MIN * 60))" "fin de session (code $code)" >>"$JOURNAL_GARDE" 2>&1 &
    echo
    echo "La machine s'arrêtera seule dans $AFTER_END_MIN min : rapatrie les fichiers d'ici là."
  }
  trap fin_de_session EXIT
fi
LLAMA_TAG="${LLAMA_TAG:-b12032}"
QUANT="${QUANT:-1}"
RUN_DIR="$ICI/runs/cloud-$(date +%Y-%m-%d-%H%M)"
# Le modèle de base (15 Go) va sur le volume /workspace, pas sur le petit disque du conteneur.
if [[ -d /workspace && -z "${HF_HOME:-}" ]]; then export HF_HOME=/workspace/.hf; fi
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
echo "Après le rapatriement : « Stop » puis « Terminate » sur le site (sinon le disque reste facturé)."
