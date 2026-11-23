"""Lecture de config.toml. Aucun secret n'a de valeur par défaut utilisable.

Règles des caméras (cahier des yeux, § 1) : jamais dans une chambre ; le jeton est obligatoire.
"""

from __future__ import annotations

import ipaddress
import re
import tomllib
import unicodedata
from dataclasses import dataclass
from pathlib import Path

JETON_MIN = 32
CAMERAS = ("picamera2", "fausse")


class ConfigErreur(ValueError):
    """Réglage refusé : le programme ne démarre pas."""


@dataclass(frozen=True)
class Config:
    nom: str
    piece: str
    hote: str
    port: int
    jeton: str
    camera: str
    # Pi 5 : deux connecteurs caméra, 0 ou 1.
    numero_camera: int
    largeur: int
    hauteur: int
    qualite: int
    # Image retournée : 0 ou 180 (caméra montée à l'envers).
    rotation: int
    # Broche GPIO du témoin lumineux (allumé pendant une prise). None : pas de témoin.
    temoin_gpio: int | None
    # Broche GPIO de l'interrupteur de coupure (fermé = caméra coupée). None : pas d'interrupteur.
    coupure_gpio: int | None
    # La caméra s'éteint après ce délai sans photo (voyant éteint, capteur libéré).
    repos_s: float


def _plier(texte: str) -> str:
    sans_accents = "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn")
    return re.sub(r"[\s'’-]+", " ", sans_accents.lower()).strip()


def piece_interdite(texte: str) -> bool:
    """Même règle que Jarvis sur le PC (`pieceInterdite`) : « chambre » sous toutes ses formes."""
    return re.search(r"\bchambres?\b", _plier(texte)) is not None


def _gpio(valeur: object) -> int | None:
    if valeur is None or valeur == "" or valeur is False:
        return None
    broche = int(valeur)  # type: ignore[arg-type]
    if not 2 <= broche <= 27:
        raise ConfigErreur(f"Broche GPIO {broche} hors de 2 à 27.")
    return broche


def valider(config: Config) -> Config:
    if not config.nom.strip() or len(config.nom) > 40:
        raise ConfigErreur("Il faut un nom (40 caractères au plus).")
    if not config.piece.strip() or len(config.piece) > 40:
        raise ConfigErreur("Il faut une pièce (40 caractères au plus).")
    if piece_interdite(config.piece) or piece_interdite(config.nom):
        raise ConfigErreur("Jamais de caméra dans une chambre : refusé.")
    if len(config.jeton.strip()) < JETON_MIN:
        raise ConfigErreur(f"Jeton absent ou trop court ({JETON_MIN} caractères au moins) : lancer installer.sh.")
    if config.camera not in CAMERAS:
        raise ConfigErreur(f"Caméra inconnue : {config.camera} (au choix : {', '.join(CAMERAS)}).")
    if config.numero_camera not in (0, 1):
        raise ConfigErreur("numero_camera : 0 ou 1.")
    if not (320 <= config.largeur <= 4608 and 240 <= config.hauteur <= 2592):
        raise ConfigErreur("Taille d'image hors limites (320×240 à 4608×2592).")
    if not 30 <= config.qualite <= 95:
        raise ConfigErreur("Qualité JPEG : de 30 à 95.")
    if config.rotation not in (0, 180):
        raise ConfigErreur("rotation : 0 ou 180.")
    if not 1 <= config.port <= 65535:
        raise ConfigErreur("Port invalide.")
    try:
        adresse = ipaddress.ip_address(config.hote)
    except ValueError as erreur:
        raise ConfigErreur("hote : une adresse IP (0.0.0.0 pour toutes les interfaces du Pi).") from erreur
    if not (adresse.is_private or adresse.is_unspecified or adresse.is_loopback):
        raise ConfigErreur("hote : réseau local seulement.")
    return config


def charger(chemin: Path | str) -> Config:
    donnees = tomllib.loads(Path(chemin).read_text(encoding="utf-8"))
    return valider(
        Config(
            nom=str(donnees.get("nom", "")),
            piece=str(donnees.get("piece", "")),
            hote=str(donnees.get("hote", "0.0.0.0")),
            port=int(donnees.get("port", 8770)),
            jeton=str(donnees.get("jeton", "")),
            camera=str(donnees.get("camera", "picamera2")),
            numero_camera=int(donnees.get("numero_camera", 0)),
            largeur=int(donnees.get("largeur", 1920)),
            hauteur=int(donnees.get("hauteur", 1080)),
            qualite=int(donnees.get("qualite", 85)),
            rotation=int(donnees.get("rotation", 0)),
            temoin_gpio=_gpio(donnees.get("temoin_gpio")),
            coupure_gpio=_gpio(donnees.get("coupure_gpio")),
            repos_s=float(donnees.get("repos_s", 5.0)),
        )
    )
