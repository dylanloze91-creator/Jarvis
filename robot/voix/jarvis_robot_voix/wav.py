"""WAV PCM 16 bits, mono, 16 kHz. Rien n'est lu sur le disque."""

from __future__ import annotations

import array
import io
import math
import sys
import wave

TAUX = 16_000
OCTETS_PAR_ECHANTILLON = 2


def rms(pcm: bytes) -> float:
    """Énergie 0…1, comme les trames flottantes de Jarvis."""
    nombre = len(pcm) // 2
    if nombre == 0:
        return 0.0
    echantillons = array.array("h")
    echantillons.frombytes(pcm[: nombre * 2])
    if sys.byteorder != "little":
        echantillons.byteswap()
    total = 0.0
    for valeur in echantillons:
        x = valeur / 32768.0
        total += x * x
    return math.sqrt(total / nombre)


def duree_ms(pcm: bytes, taux: int = TAUX) -> float:
    return (len(pcm) // 2) / taux * 1000.0


def generer(duree_ms: float, amplitude: int = 0, frequence: float = 440.0, taux: int = TAUX) -> bytes:
    """Silence si amplitude vaut 0, sinon un sinus. Sert aux tests, pas au dépôt."""
    nombre = max(0, int(taux * duree_ms / 1000.0))
    valeurs = array.array("h", [0] * nombre)
    if amplitude:
        for i in range(nombre):
            valeurs[i] = int(amplitude * math.sin(2.0 * math.pi * frequence * i / taux))
    if sys.byteorder != "little":
        valeurs.byteswap()
    return valeurs.tobytes()


def silence(duree_ms: float, taux: int = TAUX) -> bytes:
    return generer(duree_ms, 0, taux=taux)


def bip_erreur(taux: int = TAUX) -> bytes:
    """Court son généré : le PC ne répond pas. Aucun fichier audio versionné."""
    return pcm_vers_wav(generer(180, amplitude=6000, frequence=880, taux=taux), taux)


def bip_alerte(taux: int = TAUX) -> bytes:
    """Le stop local n'a pas été pris par le pilotage."""
    return pcm_vers_wav(generer(180, amplitude=6000, frequence=440, taux=taux), taux)


def pcm_vers_wav(pcm: bytes, taux: int = TAUX) -> bytes:
    tampon = io.BytesIO()
    with wave.open(tampon, "wb") as fichier:
        fichier.setnchannels(1)
        fichier.setsampwidth(2)
        fichier.setframerate(taux)
        fichier.writeframes(pcm)
    return tampon.getvalue()


def wav_vers_pcm(donnees: bytes) -> tuple[bytes, int]:
    with wave.open(io.BytesIO(donnees), "rb") as fichier:
        if fichier.getnchannels() != 1 or fichier.getsampwidth() != 2:
            raise ValueError("WAV attendu : mono, 16 bits")
        return fichier.readframes(fichier.getnframes()), fichier.getframerate()
