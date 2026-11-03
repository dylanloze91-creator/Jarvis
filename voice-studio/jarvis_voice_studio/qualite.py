"""Contrôle qualité : normalisation, silence, similarité texte (Whisper réel ou simulé)."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from jarvis_voice_studio.constants import WHISPER_SIMILARITY_MIN


def normaliser_texte(texte: str) -> str:
    texte = unicodedata.normalize("NFC", texte.lower())
    texte = re.sub(r"[^\w\s']", " ", texte, flags=re.UNICODE)
    texte = re.sub(r"\s+", " ", texte).strip()
    return texte


def similarite_mots(attendu: str, obtenu: str) -> float:
    a = set(normaliser_texte(attendu).split())
    b = set(normaliser_texte(obtenu).split())
    if not a:
        return 0.0
    return len(a & b) / len(a)


class WhisperBackend(Protocol):
    def transcrire(self, chemin_wav: str) -> str: ...


@dataclass
class ResultatQualite:
    accepte: bool
    transcription: str
    similarite: float
    raison: str | None = None


def controle_transcription(texte_attendu: str, transcription: str, seuil: float = WHISPER_SIMILARITY_MIN) -> ResultatQualite:
    sim = similarite_mots(texte_attendu, transcription)
    if sim >= seuil:
        return ResultatQualite(True, transcription, sim, None)
    return ResultatQualite(False, transcription, sim, f"similarité {sim:.2f} < {seuil}")


def harmoniser_volume(echantillons: np.ndarray, cible_rms: float = 0.08) -> np.ndarray:
    rms = float(np.sqrt(np.mean(np.square(echantillons))) or 1e-9)
    gain = cible_rms / rms
    return np.clip(echantillons * gain, -1.0, 1.0)


def couper_silences(echantillons: np.ndarray, sample_rate: int, seuil: float = 0.01, marge_ms: int = 30) -> np.ndarray:
    if len(echantillons) == 0:
        return echantillons
    abs_e = np.abs(echantillons)
    above = np.where(abs_e > seuil)[0]
    if len(above) == 0:
        return echantillons[: int(0.05 * sample_rate)]
    marge = int(marge_ms / 1000.0 * sample_rate)
    debut = max(0, int(above[0]) - marge)
    fin = min(len(echantillons), int(above[-1]) + marge)
    return echantillons[debut:fin]


class WhisperSimule:
    """Whisper factice pour pytest : renvoie le texte attendu injecté."""

    def __init__(self, par_fichier: dict[str, str] | None = None) -> None:
        self.par_fichier = par_fichier or {}

    def transcrire(self, chemin_wav: str) -> str:
        return self.par_fichier.get(chemin_wav, "")
