"""Lecture ALSA. Importé seulement au lancement réel, pas par les tests."""

from __future__ import annotations

import array
import sys
import threading
import time

from .wav import TAUX, wav_vers_pcm


class SortieAlsa:
    def __init__(self, peripherique: str) -> None:
        self.peripherique = None if peripherique in ("", "default") else peripherique
        self._couper = threading.Event()

    def interrompre(self) -> None:
        self._couper.set()
        try:
            import sounddevice as sd

            sd.stop()
        except Exception:
            return

    def jouer(self, wav: bytes) -> None:
        import sounddevice as sd

        self._couper.clear()
        pcm, taux = wav_vers_pcm(wav)
        echantillons = array.array("h")
        echantillons.frombytes(pcm)
        if sys.byteorder != "little":
            echantillons.byteswap()
        sd.play(echantillons, taux or TAUX, device=self.peripherique)
        while not self._couper.is_set():
            try:
                if not sd.get_stream().active:
                    return
            except Exception:
                return
            time.sleep(0.02)
        sd.stop()
