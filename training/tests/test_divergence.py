"""Point 9 de la revue : arrêt propre si la perte devient nan ; contrôle bitsandbytes sur la carte à la mise en place."""

from __future__ import annotations

import json
import logging
import types
from pathlib import Path

import pytest

import controle_carte
import train_lora
from jarvis_training import runs

pytestmark = pytest.mark.filterwarnings("ignore::UserWarning", "ignore::FutureWarning")


class JournalMemoire:
    def __init__(self):
        self.lignes: list[tuple[str, str]] = []

    def info(self, message, *args):
        self.lignes.append(("info", message % args))

    def warning(self, message, *args):
        self.lignes.append(("warning", message % args))

    def error(self, message, *args):
        self.lignes.append(("error", message % args))


def test_perte_divergente():
    assert train_lora.perte_divergente(float("nan"))
    assert train_lora.perte_divergente(float("inf")) and train_lora.perte_divergente(float("-inf"))
    assert not train_lora.perte_divergente(1.2345) and not train_lora.perte_divergente(0.0)
    assert not train_lora.perte_divergente(None)


def test_le_suivi_arrete_le_trainer_sur_une_perte_nan():
    journal = JournalMemoire()
    suivi = train_lora.construire_suivi(journal)(early_stopping_patience=1)
    etat = types.SimpleNamespace(global_step=7, epoch=0.5)
    controle = types.SimpleNamespace(should_training_stop=False, should_save=True, should_evaluate=True)

    suivi.on_log(None, etat, controle, logs={"loss": 1.5})
    assert controle.should_training_stop is False and suivi.divergence is None
    assert journal.lignes[-1] == ("info", "époque 0.50 · pas 7 · perte 1.5000")

    suivi.on_log(None, etat, controle, logs={"loss": float("nan")})
    assert controle.should_training_stop is True and controle.should_save is False and controle.should_evaluate is False
    assert suivi.divergence == "perte nan au pas 7 (époque 0.50)"
    assert journal.lignes[-1][0] == "error" and "ARRÊT : perte nan au pas 7" in journal.lignes[-1][1] and "--lr" in journal.lignes[-1][1]

    # La fin d'époque qui suit ne doit ni évaluer ni enregistrer un point de reprise cassé.
    controle.should_save = controle.should_evaluate = True
    suivi.on_epoch_end(None, etat, controle)
    assert controle.should_save is False and controle.should_evaluate is False


def test_dry_run_s_arrete_proprement_quand_la_perte_devient_nan(dossier_preparation: Path, tmp_path: Path, tokenizer, monkeypatch):
    from transformers import Trainer

    originel = Trainer.compute_loss

    def perte_nan(self, model, inputs, return_outputs=False, num_items_in_batch=None):
        resultat = originel(self, model, inputs, return_outputs=return_outputs, num_items_in_batch=num_items_in_batch)
        if return_outputs:
            perte, sorties = resultat
            return perte * float("nan"), sorties
        return resultat * float("nan")

    monkeypatch.setattr(Trainer, "compute_loss", perte_nan)
    sortie = tmp_path / "run"
    code = train_lora.main(["--data", str(dossier_preparation), "--dry-run", "--out", str(sortie), "--grad-accum", "2", "--epochs", "1"])
    assert code == 6
    journal = (sortie / runs.JOURNAL).read_text(encoding="utf-8")
    assert "ARRÊT : perte nan au pas 1" in journal
    assert "Arrêt propre après divergence : aucun adaptateur écrit" in journal
    assert "perte de validation" not in journal
    assert not (sortie / runs.ADAPTATEUR).exists()
    assert runs.dernier_point(sortie) is None
    bilan = json.loads((sortie / runs.BILAN).read_text(encoding="utf-8"))
    assert bilan["arret"].startswith("divergence : perte nan au pas 1") and bilan["pas"] == 1
    assert "adaptateur" not in bilan


def test_controle_carte_sans_cuda_rend_2():
    lignes: list[str] = []
    import torch

    if torch.cuda.is_available():  # pragma: no cover - les tests tournent sans carte
        pytest.skip("une carte est visible : ce test vérifie le chemin sans carte")
    assert controle_carte.controler(lignes.append) == 2
    assert lignes[-1] == controle_carte.PAS_DE_CUDA


def test_controle_bitsandbytes_rend_un_verdict_lisible():
    class FauxTorch:
        float16 = "fp16"

        @staticmethod
        def randn(*forme, dtype=None, device=None):
            raise RuntimeError("CUDA error: no kernel image is available for execution on the device")

    class FauxBnb:
        __version__ = "0.50.2"

        class nn:
            class Linear4bit:
                def __init__(self, *args, **kwargs):
                    pass

                def to(self, _device):
                    return self

    verdict = controle_carte.controler_bitsandbytes(FauxTorch, FauxBnb)
    assert verdict.startswith(controle_carte.BNB_ECHEC) and "no kernel image" in verdict


def test_setup_windows_appelle_le_controle_de_la_carte():
    script = (runs.racine_training() / "setup-windows.ps1").read_text(encoding="utf-8")
    assert "controle_carte.py" in script
    for marque in (controle_carte.PAS_DE_CUDA, controle_carte.ARCH_ABSENTE, controle_carte.BNB_ECHEC, controle_carte.BNB_OK):
        assert marque in script, marque
    assert "bitsandbytes" in script


def test_journal_reel_accepte_les_messages_du_suivi(tmp_path: Path):
    """Le suivi écrit avec le vrai journal (logging) : aucun format cassé."""
    journal = runs.ouvrir_journal(tmp_path)
    try:
        suivi = train_lora.construire_suivi(journal)(early_stopping_patience=1)
        etat = types.SimpleNamespace(global_step=3, epoch=None)
        controle = types.SimpleNamespace(should_training_stop=False, should_save=True, should_evaluate=True)
        suivi.on_log(None, etat, controle, logs={"loss": float("inf")})
    finally:
        runs.fermer_journal(journal)
    assert isinstance(journal, logging.Logger)
    assert "ARRÊT : perte inf au pas 3 (époque 0.00)" in (tmp_path / runs.JOURNAL).read_text(encoding="utf-8")
