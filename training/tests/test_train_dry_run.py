"""Circuit complet `train_lora.py --dry-run` sur processeur : journal, adaptateur, reprise."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import train_lora
from jarvis_training import runs

pytestmark = pytest.mark.filterwarnings("ignore::UserWarning", "ignore::FutureWarning")


def lancer(dossier_preparation: Path, sortie: Path, *args: str) -> int:
    return train_lora.main(["--data", str(dossier_preparation), "--dry-run", "--out", str(sortie), "--grad-accum", "2", *args])


def test_dry_run_entraine_une_epoque_et_ecrit_tout(dossier_preparation: Path, tmp_path: Path, tokenizer):
    sortie = tmp_path / "run"
    assert lancer(dossier_preparation, sortie, "--epochs", "1") == 0

    journal = (sortie / runs.JOURNAL).read_text(encoding="utf-8")
    assert "DRY-RUN" in journal
    assert "8 en entraînement" in journal and "2 en validation" in journal
    assert "consigne et demande masquées" in journal
    assert "perte de validation" in journal
    assert "DRY-RUN terminé" in journal

    bilan = json.loads((sortie / runs.BILAN).read_text(encoding="utf-8"))
    assert bilan["dry_run"] is True
    assert bilan["pas"] == 4  # 8 exemples, lot 1 × accumulation 2
    assert bilan["exemples"] == {"train": 8, "validation": 2, "trop_longs": 0}
    assert bilan["meilleure_perte_validation"] > 0

    adaptateur = sortie / runs.ADAPTATEUR
    assert (adaptateur / "adapter_config.json").exists() and (adaptateur / "adapter_model.safetensors").exists()
    config = json.loads((adaptateur / "adapter_config.json").read_text(encoding="utf-8"))
    assert config["r"] == 16 and config["lora_alpha"] == 32
    assert set(config["target_modules"]) == set(train_lora.MODULES_LORA)

    parametres = json.loads((sortie / runs.PARAMETRES).read_text(encoding="utf-8"))
    assert parametres["base"] == train_lora.BASE_DRY_RUN


def test_reprise_depuis_le_dernier_point(dossier_preparation: Path, tmp_path: Path, tokenizer):
    sortie = tmp_path / "run"
    assert lancer(dossier_preparation, sortie, "--epochs", "1") == 0
    point = runs.dernier_point(sortie)
    assert point is not None and point.name == "checkpoint-4"

    assert lancer(dossier_preparation, sortie, "--epochs", "2") == 0
    journal = (sortie / runs.JOURNAL).read_text(encoding="utf-8")
    assert "Reprise depuis" in journal and "checkpoint-4" in journal
    assert "pas 5 ·" in journal and "pas 1 ·" in journal.split("Reprise depuis")[0]
    assert "pas 1 ·" not in journal.split("Reprise depuis")[1]
    bilan = json.loads((sortie / runs.BILAN).read_text(encoding="utf-8"))
    assert bilan["pas"] == 8
    assert runs.dernier_point(sortie).name == "checkpoint-8"


def test_fresh_ignore_le_point_present(dossier_preparation: Path, tmp_path: Path, tokenizer):
    sortie = tmp_path / "run"
    assert lancer(dossier_preparation, sortie, "--epochs", "1") == 0
    assert lancer(dossier_preparation, sortie, "--epochs", "1", "--fresh") == 0
    journal = (sortie / runs.JOURNAL).read_text(encoding="utf-8")
    assert "Reprise depuis" not in journal
    assert journal.count("DRY-RUN terminé") == 2


def test_ligne_non_conforme_sautee_et_journalisee(dossier_preparation: Path, tmp_path: Path, tokenizer):
    with (dossier_preparation / "train.jsonl").open("a", encoding="utf-8") as f:
        f.write('{"id": "synthetique-faux", "messages": [], "meta": {}}\n')
    sortie = tmp_path / "run"
    assert lancer(dossier_preparation, sortie, "--epochs", "1") == 0
    journal = (sortie / runs.JOURNAL).read_text(encoding="utf-8")
    assert "train.jsonl : 1 ligne(s) sautée(s)" in journal
    assert "ligne 9 · synthetique-faux · ligne illisible" in journal
    assert "8 en entraînement" in journal


def test_preparation_faite_avec_un_autre_catalogue_d_examen_est_refusee(dossier_preparation: Path, tmp_path: Path):
    from .conftest import ecrire_resume

    ecrire_resume(dossier_preparation, {"missions": 30, "sha256": "0" * 64})
    sortie = tmp_path / "run"
    assert lancer(dossier_preparation, sortie, "--epochs", "1") == 5
    journal = (sortie / runs.JOURNAL).read_text(encoding="utf-8")
    assert "autre catalogue d'évaluation" in journal and "lab:prepare" in journal
    assert not (sortie / runs.ADAPTATEUR).exists()

    (dossier_preparation / "resume.json").unlink()
    assert lancer(dossier_preparation, tmp_path / "run2", "--epochs", "1") == 5
    assert "resume.json absent" in (tmp_path / "run2" / runs.JOURNAL).read_text(encoding="utf-8")

    assert runs.verifier_empreinte_examen(dossier_preparation) is not None
    ecrire_resume(dossier_preparation)
    assert runs.verifier_empreinte_examen(dossier_preparation) is None


def test_fichiers_absents(tmp_path: Path):
    with pytest.raises(SystemExit, match="Fichier absent"):
        train_lora.main(["--data", str(tmp_path), "--dry-run", "--out", str(tmp_path / "run")])
