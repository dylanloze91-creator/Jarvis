import subprocess
import sys
from pathlib import Path

from jarvis_voice_studio.corpus_texte import lire_phrases_common_voice


def test_lire_tsv(tmp_path: Path):
    tsv = tmp_path / "s.tsv"
    tsv.write_text("client_id\tpath\tsentence\nabc\twav/x.mp3\tBonjour le monde.\n", encoding="utf-8")
    assert lire_phrases_common_voice(tsv) == ["Bonjour le monde."]
