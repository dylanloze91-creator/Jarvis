"""Lecture ALSA. Importé seulement au lancement réel, pas par les tests."""

from __future__ import annotations

import array
import sys

from .wav import TAUX, wav_vers_pcm


class SortieAlsa:
    def __init__(self, peripherique: str) -> None:
        self.peripherique = None if peripherique in ("", "default") else peripherique

    def jouer(self, wav: bytes) -> None:
        import sounddevice as sd

        pcm, taux = wav_vers_pcm(wav)
        echantillons = array.array("h")
        echantillons.frombytes(pcm)
        if sys.byteorder != "little":
            echantillons.byteswap()
        sd.play(echantillons, taux or TAUX, device=self.peripherique)
        sd.wait()
