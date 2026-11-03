"""Dix phrases d'écoute — citations courtes du domaine public (France).

Aucune phrase rédigée par Claude/Cursor. Source indiquée pour traçabilité.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PhraseEcoute:
    id: str
    texte: str
    source: str


PHRASES_ECOUTE: tuple[PhraseEcoute, ...] = (
    PhraseEcoute("pd-01", "Le temps est un grand maître, dit-on ; le malheur est qu'il soit un maître inhumain.", "Alphonse de Lamartine, Méditations poétiques (1820)"),
    PhraseEcoute("pd-02", "Patience et longueur de temps font plus que force ni que rage.", "Jean de La Fontaine, Fables (1668)"),
    PhraseEcoute("pd-03", "L'homme est un apprenti, la douleur est son maître.", "Victor Hugo, Les Contemplations (1856)"),
    PhraseEcoute("pd-04", "Rien ne sert de courir ; il faut partir à point.", "Jean de La Fontaine, Le Lièvre et la Tortue"),
    PhraseEcoute("pd-05", "Tout homme est médecin de son mal.", "Proverbe français, recueilli au XIXe siècle (domaine public)"),
    PhraseEcoute("pd-06", "La parfaite valeur est de faire sans témoin ce qu'on serait capable de faire devant tout le monde.", "François de La Rochefoucauld, Maximes (1678)"),
    PhraseEcoute("pd-07", "Le bon sens est la chose du monde la mieux partagée.", "René Descartes, Discours de la méthode (1637)"),
    PhraseEcoute("pd-08", "On ne badine pas avec l'amour.", "Alfred de Musset, Les Caprices de Marianne (1833)"),
    PhraseEcoute("pd-09", "Il vaut mieux avoir affaire à Dieu qu'à ses saints.", "Proverbe français (domaine public)"),
    PhraseEcoute("pd-10", "Un livre est un outil de liberté.", "Victor Hugo, discours sur la misère intellectuelle (1877)"),
)


def textes_ecoute() -> list[str]:
    return [p.texte for p in PHRASES_ECOUTE]
