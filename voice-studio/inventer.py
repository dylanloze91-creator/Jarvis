#!/usr/bin/env python3
"""Fabrique six voix candidates inventées et une page HTML de comparaison."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from jarvis_voice_studio.audio_io import duree_secondes, ecrire_wav, wav_dry_run
from jarvis_voice_studio.constants import SAMPLE_RATE
from jarvis_voice_studio.candidates import PROFILS_CANDIDATES, ProfilCandidate
from jarvis_voice_studio.constants import CANDIDATE_COUNT
from jarvis_voice_studio.phrases_ecoute import PHRASES_ECOUTE


def synthetiser_parler(profil: ProfilCandidate, texte: str, device: str, model_id: str) -> "np.ndarray":
    import numpy as np
    import torch
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(model_id)
    model = ParlerTTSForConditionalGeneration.from_pretrained(model_id).to(device)
    desc_ids = tok(profil.description_parler, return_tensors="pt").input_ids.to(device)
    prompt_ids = tok(texte, return_tensors="pt").input_ids.to(device)
    with torch.no_grad():
        audio = model.generate(input_ids=desc_ids, prompt_input_ids=prompt_ids)
    return audio.cpu().numpy().squeeze().astype(np.float32)


def generer_candidate(
    profil: ProfilCandidate,
    out_dir: Path,
    *,
    dry_run: bool,
    backend: str,
    device: str,
    model_id: str,
) -> None:
    cand_dir = out_dir / profil.id
    cand_dir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, str | float]] = []
    for phrase in PHRASES_ECOUTE:
        wav_path = cand_dir / f"{phrase.id}.wav"
        if dry_run or backend == "dry":
            audio = wav_dry_run(freq=180.0 + len(phrase.id) * 7)
        elif backend == "parler":
            audio = synthetiser_parler(profil, phrase.texte, device, model_id)
        else:
            raise SystemExit(f"backend inconnu : {backend}")
        ecrire_wav(wav_path, audio)
        manifest.append(
            {
                "id": phrase.id,
                "texte": phrase.texte,
                "source": phrase.source,
                "fichier": wav_path.name,
                "duree_s": round(duree_secondes(audio, SAMPLE_RATE), 3),
            }
        )
    meta = {
        "id": profil.id,
        "label": profil.label,
        "description": profil.description_parler,
        "backend": "dry-run" if dry_run else backend,
        "model_id": model_id if backend == "parler" and not dry_run else None,
        "phrases": manifest,
    }
    (cand_dir / "manifest.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def ecrire_comparer_html(out_dir: Path) -> None:
    html = """<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Jarvis — comparer les voix candidates</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; background: #0f1419; color: #e7ecf1; }
    h1 { font-size: 1.25rem; }
    .grid { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    section { border: 1px solid #2a3540; border-radius: 8px; padding: 1rem; }
    audio { width: 100%; margin: 0.35rem 0; }
    .label { font-weight: 600; color: #7dd3fc; }
    p.meta { font-size: 0.85rem; color: #94a3b8; }
  </style>
</head>
<body>
  <h1>Voix inventées — écoute les six candidates</h1>
  <p class="meta">Mêmes dix phrases du domaine public pour chaque timbre. Choisis un dossier <code>candidate-0X</code> pour <code>corpus.py</code>.</p>
  <div class="grid" id="grid"></div>
  <script>
    const candidates = CANDIDATES_JSON;
    const grid = document.getElementById("grid");
    for (const c of candidates) {
      const sec = document.createElement("section");
      sec.innerHTML = `<div class="label">${c.label} (${c.id})</div><p class="meta">${c.description.slice(0, 120)}…</p>`;
      for (const p of c.phrases) {
        const cap = document.createElement("p");
        cap.className = "meta";
        cap.textContent = p.texte;
        sec.appendChild(cap);
        const au = document.createElement("audio");
        au.controls = true;
        au.src = `${c.id}/${p.fichier}`;
        sec.appendChild(au);
      }
      grid.appendChild(sec);
    }
  </script>
</body>
</html>
"""
    manifests = []
    for profil in PROFILS_CANDIDATES:
        mf = out_dir / profil.id / "manifest.json"
        if mf.exists():
            manifests.append(json.loads(mf.read_text(encoding="utf-8")))
    html = html.replace("CANDIDATES_JSON", json.dumps(manifests, ensure_ascii=False))
    (out_dir / "comparer.html").write_text(html, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventer six voix candidates pour Jarvis.")
    parser.add_argument("--out", type=Path, default=ROOT / "candidates")
    parser.add_argument("--dry-run", action="store_true", help="Sinusoïde de test, sans modèle.")
    parser.add_argument("--backend", choices=("parler", "dry"), default="parler")
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--model-id", default="parler-tts/parler-tts-mini-v1")
    args = parser.parse_args()
    if len(PROFILS_CANDIDATES) != CANDIDATE_COUNT:
        raise SystemExit("nombre de profils inattendu")
    dry = args.dry_run or args.backend == "dry"
    for profil in PROFILS_CANDIDATES:
        generer_candidate(
            profil,
            args.out,
            dry_run=dry,
            backend="dry" if dry else args.backend,
            device=args.device,
            model_id=args.model_id,
        )
        print(f"OK {profil.id}")
    ecrire_comparer_html(args.out)
    print(f"Page : {args.out / 'comparer.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
