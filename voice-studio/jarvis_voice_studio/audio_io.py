"""Lecture / écriture WAV mono 16 bits (22 050 Hz)."""

from __future__ import annotations

import struct
import wave
from pathlib import Path

import numpy as np

from jarvis_voice_studio.constants import SAMPLE_RATE


def ecrire_wav(chemin: Path, echantillons: np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    if echantillons.dtype != np.float32 and echantillons.dtype != np.float64:
        echantillons = echantillons.astype(np.float32)
    echantillons = np.clip(echantillons, -1.0, 1.0)
    pcm = (echantillons * 32767.0).astype(np.int16)
    with wave.open(str(chemin), "wb") as fichier:
        fichier.setnchannels(1)
        fichier.setsampwidth(2)
        fichier.setframerate(sample_rate)
        fichier.writeframes(pcm.tobytes())


def lire_wav(chemin: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(chemin), "rb") as fichier:
        if fichier.getnchannels() != 1:
            raise ValueError("mono attendu")
        if fichier.getsampwidth() != 2:
            raise ValueError("16 bits attendu")
        rate = fichier.getframerate()
        n = fichier.getnframes()
        raw = fichier.readframes(n)
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return pcm, rate


def wav_dry_run(duree_s: float = 0.35, freq: float = 220.0, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Signal sinusoïdal court pour les tests sans modèle."""
    n = int(duree_s * sample_rate)
    t = np.linspace(0, duree_s, n, endpoint=False)
    return (0.2 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def duree_secondes(echantillons: np.ndarray, sample_rate: int) -> float:
    return float(len(echantillons)) / float(sample_rate)
