import subprocess
import sys
from pathlib import Path


def test_entrainer_dry_run(tmp_path: Path):
    root = Path(__file__).resolve().parents[1]
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    (corpus / "metadata.csv").write_text("utt_000001.wav|Bonjour.\n", encoding="utf-8")
    export = tmp_path / "export"
    r = subprocess.run(
        [sys.executable, str(root / "entrainer_piper.py"), "--dry-run", "--corpus", str(corpus), "--export", str(export)],
        cwd=str(root),
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert (export / "fr_FR-jarvis-medium.onnx.json").exists()
