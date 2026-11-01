"""Mot de réveil openWakeWord, modèle hey_jarvis, sur le processeur du Pi.

Le modèle officiel détecte « hey jarvis ». « Jarvis » seul peut passer,
avec plus de ratés : c'est écrit dans la documentation du modèle
(docs/models/hey_jarvis.md du dépôt dscripka/openWakeWord). Licence
Apache 2.0. L'inférence ne contacte pas le réseau ; le téléchargement
du modèle se fait une fois, dans installer.sh.
"""

from __future__ import annotations

import array
import sys

from .wav import TAUX

ECHANTILLONS_PAR_TRAME = 1280  # 80 ms à 16 kHz, taille exigée par openWakeWord


class ReveilOpenWakeWord:
    def __init__(self, seuil: float) -> None:
        self.seuil = seuil
        self._modele = None

    def declenche(self, pcm: bytes) -> bool:
        if len(pcm) < ECHANTILLONS_PAR_TRAME * 2:
            return False
        if self._modele is None:
            import openwakeword
            from openwakeword.model import Model

            openwakeword.utils.download_models(models=["hey_jarvis"])
            self._modele = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
        echantillons = array.array("h")
        echantillons.frombytes(pcm[: ECHANTILLONS_PAR_TRAME * 2])
        if sys.byteorder != "little":
            echantillons.byteswap()
        try:
            import numpy as np
        except ImportError:
            return False
        scores = self._modele.predict(np.asarray(echantillons, dtype=np.int16))
        valeur = float(scores.get("hey_jarvis", 0.0))
        return valeur >= self.seuil


def taille_trame_reveil() -> int:
    return ECHANTILLONS_PAR_TRAME * 2
