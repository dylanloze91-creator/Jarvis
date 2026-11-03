#!/usr/bin/env bash
# Lance l'affinage Piper sur une machine louée (chemins /workspace/voice-studio).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
.venv/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cu128
.venv/bin/pip install -q "git+https://github.com/OHF-Voice/piper1-gpl.git"
exec .venv/bin/python entrainer_piper.py --corpus "${CORPUS_DIR:-$ROOT/corpus}" --export "${EXPORT_DIR:-$ROOT/export}" --epochs "${EPOCHS:-750}" "$@"
