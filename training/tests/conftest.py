"""Fixtures des tests d'entraînement.

Les exemples ci-dessous sont SYNTHÉTIQUES, écrits pour les tests (meta.model = « synthetique-test »).
Ils ne proviennent pas du cahier `entrainement.jsonl` et ne doivent jamais y être copiés : le
cahier ne contient que ce que l'élève a produit et que les vérifications ont validé.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE))

# Qwen2 minuscule au gabarit de chat identique à Qwen2.5-Coder-7B-Instruct (outils compris).
MODELE_MINUSCULE = "yujiepan/qwen2.5-tiny-random"

OUTILS = [
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Écrit un fichier dans le projet.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                "required": ["path", "content"],
            },
        },
    }
]


def exemple_synthetique(numero: int, *, niveau: int = 1) -> dict:
    nom = f"double{numero}"
    return {
        "id": f"synthetique-test-{numero}",
        "messages": [
            {"role": "system", "content": "EXEMPLE SYNTHÉTIQUE DE TEST. Tu écris du TypeScript avec l'outil write_file."},
            {"role": "user", "content": f"Écris une fonction {nom} qui renvoie le double d'un nombre."},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "type": "function",
                        "function": {
                            "name": "write_file",
                            "arguments": {"path": f"src/{nom}.ts", "content": f"export function {nom}(n: number): number {{\n  return n * 2;\n}}\n"},
                        },
                    }
                ],
            },
        ],
        "tools": OUTILS,
        "meta": {"mission": f"synthetique-{numero}", "level": niveau, "model": "synthetique-test", "source": "test"},
    }


def ecrire_jsonl(chemin: Path, exemples: list[dict]) -> None:
    chemin.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in exemples), encoding="utf-8")


@pytest.fixture(scope="session")
def tokenizer():
    from transformers import AutoTokenizer

    try:
        return AutoTokenizer.from_pretrained(MODELE_MINUSCULE)
    except Exception as erreur:  # pragma: no cover - réseau absent
        pytest.skip(f"modèle minuscule {MODELE_MINUSCULE} indisponible ({erreur})")


@pytest.fixture
def dossier_preparation(tmp_path: Path) -> Path:
    """Un `preparation/` synthétique : 8 exemples d'entraînement, 2 de validation."""
    dossier = tmp_path / "preparation"
    dossier.mkdir()
    ecrire_jsonl(dossier / "train.jsonl", [exemple_synthetique(i) for i in range(8)])
    ecrire_jsonl(dossier / "validation.jsonl", [exemple_synthetique(i) for i in range(8, 10)])
    return dossier
