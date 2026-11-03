"""Sources de texte libres pour le corpus (Common Voice CC0, pas de texte IA)."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterator

# Les jeux Common Voice (phrases CC0) se téléchargent via Mozilla Data Collective
# (https://commonvoice.mozilla.org/fr/datasets — lu le 2026-11-03). Aucune URL directe
# stable n'est codée en dur : l'utilisateur fournit un export local (--sentences-file).


def lire_lignes_locales(chemin: Path) -> Iterator[str]:
    with chemin.open("r", encoding="utf-8") as fichier:
        for ligne in fichier:
            texte = ligne.strip()
            if texte and not texte.startswith("#"):
                yield texte


def lire_phrases_common_voice(chemin: Path) -> list[str]:
    """Lit des phrases depuis un TSV Common Voice (colonne `sentence`) ou un .txt (une phrase par ligne)."""
    if chemin.suffix.lower() == ".tsv":
        phrases: list[str] = []
        with chemin.open("r", encoding="utf-8", newline="") as fichier:
            lecteur = csv.DictReader(fichier, delimiter="\t")
            if lecteur.fieldnames and "sentence" in lecteur.fieldnames:
                for row in lecteur:
                    texte = (row.get("sentence") or "").strip()
                    if len(texte) >= 8:
                        phrases.append(texte)
            else:
                fichier.seek(0)
                for ligne in fichier:
                    texte = ligne.strip()
                    if len(texte) >= 8:
                        phrases.append(texte)
        return phrases
    return list(lire_lignes_locales(chemin))


def decouper_pour_tts(texte: str, max_chars: int) -> list[str]:
    texte = texte.strip()
    if len(texte) <= max_chars:
        return [texte] if texte else []
    morceaux: list[str] = []
    reste = texte
    while reste:
        if len(reste) <= max_chars:
            morceaux.append(reste.strip())
            break
        coupure = reste.rfind(" ", 0, max_chars)
        if coupure <= 0:
            coupure = max_chars
        morceaux.append(reste[:coupure].strip())
        reste = reste[coupure:].strip()
    return [m for m in morceaux if m]


def phrases_exemple_dry_run() -> list[str]:
    """Quelques phrases du domaine public (courtes), pour tests sans réseau."""
    return [
        "Patience et longueur de temps font plus que force ni que rage.",
        "Rien ne sert de courir ; il faut partir à point.",
        "Le bon sens est la chose du monde la mieux partagée.",
        "Tout homme est médecin de son mal.",
        "On ne badine pas avec l'amour.",
    ] * 40
