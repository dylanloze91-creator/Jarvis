#!/usr/bin/env python3
"""Fabrique ~1 h 30 de paroles avec la voix candidate choisie."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tqdm import tqdm

from jarvis_voice_studio.audio_io import duree_secondes, ecrire_wav, wav_dry_run
from jarvis_voice_studio.constants import SAMPLE_RATE
from jarvis_voice_studio.candidates import profil_par_id
from jarvis_voice_studio.constants import MAX_CHARS_PER_UTTERANCE, TARGET_HOURS_DEFAULT
from jarvis_voice_studio.corpus_texte import decouper_pour_tts, lire_phrases_common_voice, phrases_exemple_dry_run
from jarvis_voice_studio.qualite import WhisperSimule, controle_transcription, couper_silences, harmoniser_volume


def lire_manifest_candidate(candidate_dir: Path) -> dict:
    mf = candidate_dir / "manifest.json"
    if not mf.exists():
        raise SystemExit(f"manifest absent : {mf}")
    return json.loads(mf.read_text(encoding="utf-8"))


def synthetiser(profil_desc: str, texte: str, dry_run: bool, device: str, model_id: str):
    import numpy as np

    if dry_run:
        return wav_dry_run(duree_s=min(0.25 + len(texte) * 0.004, 8.0))
    import torch
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(model_id)
    model = ParlerTTSForConditionalGeneration.from_pretrained(model_id).to(device)
    desc_ids = tok(profil_desc, return_tensors="pt").input_ids.to(device)
    prompt_ids = tok(texte, return_tensors="pt").input_ids.to(device)
    with torch.no_grad():
        audio = model.generate(input_ids=desc_ids, prompt_input_ids=prompt_ids)
    return audio.cpu().numpy().squeeze().astype(np.float32)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=Path, required=True, help="Dossier candidate-0X choisi.")
    parser.add_argument("--out", type=Path, default=ROOT / "corpus")
    parser.add_argument("--hours", type=float, default=TARGET_HOURS_DEFAULT)
    parser.add_argument("--sentences-file", type=Path, help="TSV/txt Common Voice ou phrases CC0.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--model-id", default="parler-tts/parler-tts-mini-v1")
    args = parser.parse_args()

    manifest = lire_manifest_candidate(args.candidate)
    profil = profil_par_id(manifest["id"])
    if args.dry_run:
        phrases = phrases_exemple_dry_run()
    else:
        if not args.sentences_file:
            raise SystemExit("corpus réel : passer --sentences-file (export Common Voice CC0).")
        phrases = lire_phrases_common_voice(args.sentences_file)

    args.out.mkdir(parents=True, exist_ok=True)
    wav_dir = args.out / "wav"
    wav_dir.mkdir(exist_ok=True)
    ecartes_path = args.out / "ecartes.jsonl"
    meta_rows: list[tuple[str, str]] = []
    secondes = 0.0
    cible = args.hours * 3600.0
    whisper = WhisperSimule()

    with ecartes_path.open("w", encoding="utf-8") as ecartes:
        idx = 0
        pbar = tqdm(total=int(cible), unit="s", desc="corpus")
        for phrase in phrases:
            for morceau in decouper_pour_tts(phrase, MAX_CHARS_PER_UTTERANCE):
                if secondes >= cible:
                    break
                idx += 1
                nom = f"utt_{idx:06d}.wav"
                chemin = wav_dir / nom
                audio = synthetiser(profil.description_parler, morceau, args.dry_run, args.device, args.model_id)
                audio = harmoniser_volume(couper_silences(audio, SAMPLE_RATE))
                if args.dry_run:
                    transcription = morceau
                else:
                    ecrire_wav(chemin, audio)
                    transcription = whisper.transcrire(str(chemin))
                controle = controle_transcription(morceau, transcription)
                if not controle.accepte:
                    ecartes.write(
                        json.dumps({"texte": morceau, "raison": controle.raison, "transcription": transcription}, ensure_ascii=False)
                        + "\n"
                    )
                    if chemin.exists():
                        chemin.unlink()
                    continue
                if args.dry_run:
                    ecrire_wav(chemin, audio)
                d = duree_secondes(audio, SAMPLE_RATE)
                secondes += d
                pbar.update(int(d))
                meta_rows.append((nom, morceau))
            if secondes >= cible:
                break
        pbar.close()

    meta_csv = args.out / "metadata.csv"
    with meta_csv.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="|")
        for nom, texte in meta_rows:
            w.writerow([nom, texte])
    resume = {
        "candidate": manifest["id"],
        "heures_visees": args.hours,
        "secondes_total": round(secondes, 2),
        "utterances": len(meta_rows),
        "sample_rate": SAMPLE_RATE,
    }
    (args.out / "resume.json").write_text(json.dumps(resume, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(resume, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
