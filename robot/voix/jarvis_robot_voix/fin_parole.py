"""Fin de phrase, mesurée en audio, comme `endOfSpeech.ts` de Jarvis.

Avant la parole : 1,5 s de silence ferment la prise (on n'envoie rien).
Après au moins 150 ms de parole : 650 ms de silence suffisent.
Une phrase dure 15 s au plus (contrat de l'enceinte).
"""

from __future__ import annotations

from .wav import TAUX, duree_ms, rms

SEUIL = 0.012
SILENCE_APRES_MS = 650
SILENCE_AVANT_MS = 1_500
PAROLE_MIN_MS = 150
FENETRE_S = 0.016
PHRASE_MAX_MS = 15_000
# La fin du mot de réveil n'est pas la commande.
QUEUE_REVEIL_MS = 150


class FinDeParole:
    def __init__(self) -> None:
        self.parole_ms = 0.0
        self.silence_ms = 0.0

    @property
    def commande_commencee(self) -> bool:
        return self.parole_ms >= PAROLE_MIN_MS

    def amorcer(self, pcm: bytes, taux: int = TAUX) -> bool:
        saut = int(taux * QUEUE_REVEIL_MS / 1000.0) * 2
        return self.pousser(pcm[saut:], taux)

    def pousser(self, pcm: bytes, taux: int = TAUX) -> bool:
        fenetre = max(2, int(taux * FENETRE_S) * 2)
        for debut in range(0, len(pcm), fenetre):
            morceau = pcm[debut : debut + fenetre]
            if self._compter(rms(morceau), duree_ms(morceau, taux)):
                return True
        return False

    def _compter(self, niveau: float, duree: float) -> bool:
        if niveau >= SEUIL:
            self.parole_ms += duree
            self.silence_ms = 0.0
        else:
            self.silence_ms += duree
        limite = SILENCE_APRES_MS if self.commande_commencee else SILENCE_AVANT_MS
        return self.silence_ms >= limite
