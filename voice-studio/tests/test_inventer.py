import json
import subprocess
import sys
from pathlib import Path


def test_inventer_dry_run(tmp_path: Path):
    root = Path(__file__).resolve().parents[1]
    out = tmp_path / "candidates"
    r = subprocess.run(
        [sys.executable, str(root / "inventer.py"), "--dry-run", "--out", str(out)],
        cwd=str(root),
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert (out / "comparer.html").exists()
    assert (out / "candidate-01" / "manifest.json").exists()
    data = json.loads((out / "candidate-01" / "manifest.json").read_text(encoding="utf-8"))
    assert len(data["phrases"]) == 10
