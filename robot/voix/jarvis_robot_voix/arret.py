"""« stop » reconnu sur le Pi, sans passer par le PC.

Grammaire fermée Vosk (français), le même principe que le réveil Vosk de
Jarvis : quelques mots, et `[unk]` pour tout le reste. Sans le modèle,
aucune phrase n'est prise pour un arrêt (on ne coupe pas le robot au hasard).
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

MOTS_AUTORISES = frozenset({"stop", "arrete", "toi", "robot"})
MOTS_QUI_COUPENT = frozenset({"stop", "arrete"})
MOTS_GRAMMAIRE = ["stop", "arrête", "arrête-toi", "arrête toi", "stop robot", "[unk]"]


def grammaire_json() -> str:
    return json.dumps(MOTS_GRAMMAIRE, ensure_ascii=False)


def normaliser(texte: str) -> str:
    texte = texte.lower().replace("’", "'").replace("`", "'")
    texte = unicodedata.normalize("NFD", texte)
    texte = "".join(c for c in texte if unicodedata.category(c) != "Mn")
    texte = texte.replace("-", " ")
    texte = re.sub(r"[^a-z\s]", " ", texte)
    return " ".join(texte.split())


def est_arret(texte: str) -> bool:
    """Ignore `[unk]`, accepte « stop stop ». Dès que les mots suffisent."""
    mots = [mot for mot in normaliser(texte).split() if mot and mot != "unk"]
    if not mots or any(mot not in MOTS_AUTORISES for mot in mots):
        return False
    return any(mot in MOTS_QUI_COUPENT for mot in mots)


class DetecteurArret:
    """Au fil des trames : pas d'attente de la fin de parole."""

    def __init__(self, lire) -> None:
        self.lire = lire

    def pousser(self, pcm: bytes) -> bool:
        try:
            texte = self.lire(pcm)
        except Exception:
            return False
        return bool(texte) and est_arret(texte)


class ReconnaissanceVosk:
    """Charge le modèle seulement au premier usage."""

    def __init__(self, dossier: str) -> None:
        self.dossier = dossier
        self._modele = None
        self._reco = None
        self._erreur: str | None = None

    def disponible(self) -> bool:
        return Path(self.dossier).is_dir()

    def pousser(self, pcm: bytes) -> bool:
        """Une petite trame. Déclenche dès que le texte partiel est un arrêt."""
        if not pcm or not self.disponible():
            return False
        if self._modele is None:
            from vosk import Model

            self._modele = Model(self.dossier)
        if self._reco is None:
            from vosk import KaldiRecognizer

            self._reco = KaldiRecognizer(self._modele, 16000, grammaire_json())
        termine = self._reco.AcceptWaveform(pcm)
        brut = self._reco.Result() if termine else self._reco.PartialResult()
        if not est_arret(_texte_vosk(brut)):
            return False
        self._reco = None
        return True

    def texte(self, pcm: bytes) -> str:
        if not self.disponible():
            self._erreur = self._erreur or f"modèle Vosk absent : {self.dossier}"
            return ""
        if self._modele is None:
            from vosk import Model

            self._modele = Model(self.dossier)
        from vosk import KaldiRecognizer

        reconnaissance = KaldiRecognizer(self._modele, 16000, grammaire_json())
        reconnaissance.SetWords(True)
        if pcm:
            reconnaissance.AcceptWaveform(pcm)
        brut = reconnaissance.FinalResult()
        return _texte_vosk(brut)


def _texte_vosk(brut: str) -> str:
    try:
        donnees = json.loads(brut)
    except json.JSONDecodeError:
        return ""
    return str(donnees.get("text") or donnees.get("partial") or "")
