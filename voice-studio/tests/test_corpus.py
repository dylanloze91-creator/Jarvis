import json
import subprocess
import sys
from pathlib import Path


def test_corpus_dry_run(tmp_path: Path):
    root = Path(__file__).resolve().parents[1]
    cand = tmp_path / "candidate-03"
    cand.mkdir()
    (cand / "manifest.json").write_text(
        json.dumps({"id": "candidate-03", "label": "test", "description": "x", "phrases": []}),
        encoding="utf-8",
    )
    out = tmp_path / "corpus"
    r = subprocess.run(
        [
            sys.executable,
            str(root / "corpus.py"),
            "--dry-run",
            "--candidate",
            str(cand),
            "--out",
            str(out),
            "--hours",
            "0.01",
        ],
        cwd=str(root),
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert (out / "metadata.csv").exists()
    assert (out / "resume.json").exists()
