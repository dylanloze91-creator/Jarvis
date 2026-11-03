from jarvis_voice_studio.corpus_texte import decouper_pour_tts
from jarvis_voice_studio.qualite import (
    controle_transcription,
    couper_silences,
    harmoniser_volume,
    normaliser_texte,
    similarite_mots,
)
import numpy as np


def test_decoupage_tts():
    long = "mot " * 80
    parts = decouper_pour_tts(long.strip(), 50)
    assert len(parts) > 1
    assert all(len(p) <= 50 for p in parts)


def test_similarite_et_whisper_simule():
    attendu = "Bonjour, Jarvis est prêt."
    assert similarite_mots(attendu, attendu) == 1.0
    ok = controle_transcription(attendu, "bonjour jarvis est pret")
    assert ok.accepte
    ko = controle_transcription(attendu, "autre phrase")
    assert not ko.accepte


def test_normaliser_texte():
    assert normaliser_texte("Café !") == "café"


def test_audio_post():
    x = np.array([0.0, 0.5, -0.5, 0.0], dtype=np.float32)
    y = harmoniser_volume(x)
    assert float(np.max(np.abs(y))) <= 1.0
    z = couper_silences(x, 22050)
    assert len(z) >= 2
