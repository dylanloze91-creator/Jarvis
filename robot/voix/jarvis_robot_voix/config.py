"""Lecture de config.toml. Aucun secret n'a de valeur par défaut utilisable."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    pc_hote: str
    pc_port: int
    jeton_enceinte: str
    robot_hote: str
    robot_port: int
    jeton_robot: str
    peripherique: str
    sensibilite: float
    modele_vosk: str

    @property
    def seuil_reveil(self) -> float:
        """Même correspondance que Jarvis sur le PC : 0,85 − 0,5 × sensibilité."""
        valeur = min(1.0, max(0.0, self.sensibilite))
        return 0.85 - 0.5 * valeur


def charger(chemin: Path | str) -> Config:
    donnees = tomllib.loads(Path(chemin).read_text(encoding="utf-8"))
    return Config(
        pc_hote=str(donnees["pc_hote"]),
        pc_port=int(donnees["pc_port"]),
        jeton_enceinte=str(donnees.get("jeton_enceinte", "")),
        robot_hote=str(donnees.get("robot_hote", "127.0.0.1")),
        robot_port=int(donnees.get("robot_port", 8765)),
        jeton_robot=str(donnees.get("jeton_robot", "")),
        peripherique=str(donnees.get("peripherique", "default")),
        sensibilite=float(donnees.get("sensibilite", 0.5)),
        modele_vosk=str(donnees.get("modele_vosk", "modeles/vosk-model-small-fr-0.22")),
    )
