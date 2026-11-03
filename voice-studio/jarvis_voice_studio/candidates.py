"""Profils textuels pour six voix inventées (descriptions, pas des noms de personnes)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProfilCandidate:
    id: str
    label: str
    description_parler: str


PROFILS_CANDIDATES: tuple[ProfilCandidate, ...] = (
    ProfilCandidate(
        "candidate-01",
        "Grave posée",
        "Un locuteur masculin francophone, voix grave et posée, débit modéré, ton chaleureux et rassurant. "
        "Enregistrement très propre, très clair, sans bruit de fond.",
    ),
    ProfilCandidate(
        "candidate-02",
        "Grave vive",
        "Un locuteur masculin francophone, voix grave mais légèrement plus vive, articulation nette, "
        "rythme un peu plus soutenu. Très haute qualité audio, très claire.",
    ),
    ProfilCandidate(
        "candidate-03",
        "Médium calme",
        "Un locuteur masculin francophone, timbre médium, calme et bienveillant, débit lent à modéré. "
        "La voix est proche du micro, très claire, sans réverbération.",
    ),
    ProfilCandidate(
        "candidate-04",
        "Médium dynamique",
        "Un locuteur masculin francophone, timbre médium, expressif sans exagération, débit modéré à rapide. "
        "Enregistrement studio, très clair, sans bruit.",
    ),
    ProfilCandidate(
        "candidate-05",
        "Medium-grave neutre",
        "Un locuteur masculin francophone, voix entre médium et grave, neutre et professionnelle, "
        "débit régulier. Audio très clair et sec.",
    ),
    ProfilCandidate(
        "candidate-06",
        "Grave profonde lente",
        "Un locuteur masculin francophone, voix profonde, très posée, débit lent, ton confidentiel. "
        "Qualité audio excellente, voix très proche, sans bruit de fond.",
    ),
)


def profil_par_id(identifiant: str) -> ProfilCandidate:
    for profil in PROFILS_CANDIDATES:
        if profil.id == identifiant:
            return profil
    raise KeyError(identifiant)
