"""Dry-run du mode classification trieur (5.0.68) sur processeur."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[1]


def test_dry_run_trieur_sur_processeur(tmp_path: Path):
    prep = tmp_path / "preparation"
    prep.mkdir()
    ligne = {
        "id": "synthetique-test-1",
        "messages": [
            {"role": "system", "content": "Tu es le chef d'orchestre."},
            {"role": "user", "content": "Demande : Bonjour\nÉquipe :"},
            {"role": "assistant", "content": "conversation"},
        ],
        "meta": {"team": "conversation", "synthetique-test": True},
    }
    (prep / "train.jsonl").write_text(json.dumps(ligne) + "\n", encoding="utf-8")
    (prep / "validation.jsonl").write_text(json.dumps(ligne) + "\n", encoding="utf-8")
    (prep / "resume.json").write_text(json.dumps({"options": {"maxTokens": 512}}), encoding="utf-8")
    script = RACINE / "train_lora.py"
    result = subprocess.run(
        [sys.executable, str(script), "--data", str(prep), "--task", "trieur", "--dry-run", "--max-steps", "2", "--out", str(tmp_path / "run")],
        cwd=RACINE,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_masque_classification_uniquement_sur_equipe():
    from jarvis_training import data as donnees

    messages = [
        {"role": "system", "content": "consigne"},
        {"role": "user", "content": "demande"},
        {"role": "assistant", "content": "pc"},
    ]
    ex = donnees.ExempleClassification(identifiant="t", messages=messages, meta={})

    class Tok:
        chat_template = "{% for message in messages %}{{ message['role'] }}:{{ message['content'] }}\n{% endfor %}"

        def apply_chat_template(self, msgs, tokenize=False, add_generation_prompt=False, tools=None):
            parts = []
            for m in msgs:
                parts.append(f"{m['role']}:{m['content']}\n")
            if add_generation_prompt:
                parts.append("assistant:")
            return "".join(parts)

        def __call__(self, text, add_special_tokens=False):
            return {"input_ids": list(range(len(text)))}

    tok = Tok()
    enc = donnees.encoder_classification(tok, ex, 512)
    assert enc is not None
    assert enc.labels.count(donnees.IGNORE_INDEX) >= 1
    assert any(label != donnees.IGNORE_INDEX for label in enc.labels)
