#!/usr/bin/env python3
"""Affinage d'une voix Piper française sur le corpus, export ONNX + config."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_CKPT_NAME = "fr_FR-siwis-medium.ckpt"
VOICE_NAME = "fr_FR-jarvis-medium"


def ecrire_config_piper(export_dir: Path, sample_rate: int = 22050) -> None:
    cfg = {
        "audio": {"sample_rate": sample_rate, "quality": "medium"},
        "espeak": {"voice": "fr"},
        "inference": {"noise_scale": 0.667, "length_scale": 1.0, "noise_wpe": 0.8},
        "language": {"code": "fr_FR", "family": "fr", "region": "FR", "name_native": "Français"},
        "num_symbols": 256,
        "num_speakers": 1,
        "speaker_id_map": {"jarvis": 0},
        "piper_version": "1.3.0",
    }
    (export_dir / f"{VOICE_NAME}.onnx.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def dry_run_export(corpus_csv: Path, export_dir: Path) -> None:
    export_dir.mkdir(parents=True, exist_ok=True)
    lignes = corpus_csv.read_text(encoding="utf-8").strip().splitlines()
    ecrire_config_piper(export_dir)
    (export_dir / "DRY_RUN.txt").write_text(
        f"Corpus : {len(lignes)} lignes lues depuis {corpus_csv.name}\n"
        "Entraînement Piper réel : voir cloud/README.md (piper.train fit).\n",
        encoding="utf-8",
    )
    # Placeholder ONNX vide (non utilisable) — jamais commité (gitignore)
    (export_dir / f"{VOICE_NAME}.onnx").write_bytes(b"")


def entrainer_reel(corpus_dir: Path, export_dir: Path, ckpt: Path, epochs: int) -> None:
    audio_dir = corpus_dir / "wav"
    csv_path = corpus_dir / "metadata.csv"
    cache = corpus_dir / "piper_cache"
    config_path = export_dir / f"{VOICE_NAME}.onnx.json"
    export_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "piper.train",
        "fit",
        f"--data.voice_name={VOICE_NAME}",
        f"--data.csv_path={csv_path}",
        f"--data.audio_dir={audio_dir}",
        "--model.sample_rate=22050",
        "--data.espeak_voice=fr-fr",
        f"--data.cache_dir={cache}",
        f"--data.config_path={config_path}",
        "--data.batch_size=16",
        f"--ckpt_path={ckpt}",
        f"--trainer.max_epochs={epochs}",
    ]
    subprocess.run(cmd, check=True)
    # Export ONNX : suivre la doc piper1-gpl après fit (copie depuis lightning checkpoint)
    print("Entraînement terminé ; exporter le .onnx avec la commande export de piper1-gpl (voir README).")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=ROOT / "corpus", help="Dossier avec metadata.csv et wav/")
    parser.add_argument("--export", type=Path, default=ROOT / "export")
    parser.add_argument("--ckpt", type=Path, default=ROOT / "checkpoints" / DEFAULT_CKPT_NAME)
    parser.add_argument("--epochs", type=int, default=750, help="~1,5 h fine-tune : 650-850 (doc Piper).")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    csv_path = args.corpus / "metadata.csv"
    if not csv_path.exists():
        raise SystemExit(f"metadata absent : {csv_path}")
    if args.dry_run:
        dry_run_export(csv_path, args.export)
        print(f"DRY-RUN export : {args.export}")
        return 0
    if not args.ckpt.exists():
        raise SystemExit(
            f"checkpoint absent : {args.ckpt}\n"
            "Télécharger le .ckpt medium français (Hugging Face rhasspy/piper-voices) avant l'entraînement."
        )
    entrainer_reel(args.corpus, args.export, args.ckpt, args.epochs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
