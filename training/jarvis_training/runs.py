"""Dossier d'un entraînement (`training/runs/<date>/`), journal lisible et reprise."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

JOURNAL = "journal.txt"
PARAMETRES = "parametres.json"
POINTS = "points"
ADAPTATEUR = "adaptateur"
BILAN = "bilan.json"


def racine_training() -> Path:
    return Path(__file__).resolve().parent.parent


def nouveau_dossier(base: Path | None = None, maintenant: datetime | None = None) -> Path:
    """`training/runs/AAAA-MM-JJ-HHMM`, un suffixe si le dossier existe déjà."""
    racine = base or racine_training() / "runs"
    horodatage = (maintenant or datetime.now()).strftime("%Y-%m-%d-%H%M")
    dossier = racine / horodatage
    suffixe = 2
    while dossier.exists():
        dossier = racine / f"{horodatage}-{suffixe}"
        suffixe += 1
    dossier.mkdir(parents=True)
    return dossier


def ouvrir_journal(dossier: Path, nom: str = "jarvis-entrainement") -> logging.Logger:
    """Journal en français, à la fois dans `journal.txt` et à l'écran. Chaque appel ajoute à la suite."""
    journal = logging.getLogger(f"{nom}.{dossier.name}")
    journal.setLevel(logging.INFO)
    journal.propagate = False
    for ancien in list(journal.handlers):
        journal.removeHandler(ancien)
        ancien.close()
    format_ = logging.Formatter("%(asctime)s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    fichier = logging.FileHandler(dossier / JOURNAL, encoding="utf-8")
    fichier.setFormatter(format_)
    ecran = logging.StreamHandler()
    ecran.setFormatter(logging.Formatter("%(message)s"))
    journal.addHandler(fichier)
    journal.addHandler(ecran)
    return journal


def fermer_journal(journal: logging.Logger) -> None:
    for handler in list(journal.handlers):
        journal.removeHandler(handler)
        handler.close()


def ecrire_json(chemin: Path, contenu: dict[str, Any]) -> None:
    chemin.write_text(json.dumps(contenu, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def lire_json(chemin: Path) -> dict[str, Any]:
    return json.loads(chemin.read_text(encoding="utf-8"))


def dernier_point(dossier: Path) -> Path | None:
    """Dernier `checkpoint-N` écrit par le Trainer dans `points/`, ou `None`."""
    racine = dossier / POINTS
    if not racine.is_dir():
        return None
    points = []
    for candidat in racine.iterdir():
        match = re.fullmatch(r"checkpoint-(\d+)", candidat.name)
        if match and candidat.is_dir() and (candidat / "trainer_state.json").exists():
            points.append((int(match.group(1)), candidat))
    if not points:
        return None
    return max(points)[1]


def duree_lisible(secondes: float) -> str:
    secondes = int(secondes)
    heures, reste = divmod(secondes, 3600)
    minutes, sec = divmod(reste, 60)
    if heures:
        return f"{heures} h {minutes:02d} min"
    if minutes:
        return f"{minutes} min {sec:02d} s"
    return f"{sec} s"
