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

PHRASES = frozenset({"stop", "arrete", "arrete toi", "stop robot"})
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
    propre = normaliser(texte)
    if not propre or propre == "unk" or "unk" in propre.split():
        return False
    return propre in PHRASES


class ReconnaissanceVosk:
    """Charge le modèle seulement au premier usage."""

    def __init__(self, dossier: str) -> None:
        self.dossier = dossier
        self._modele = None
        self._erreur: str | None = None

    def disponible(self) -> bool:
        return Path(self.dossier).is_dir()

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
        try:
            return str(json.loads(brut).get("text", ""))
        except json.JSONDecodeError:
            return ""
