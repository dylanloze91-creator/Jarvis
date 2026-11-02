"""Point 2 de la revue : pas de conversion fp32 des poids gelés, avertissement mémoire, base locale."""

from __future__ import annotations

from pathlib import Path

import train_lora
from jarvis_training import runs


class FauxModele:
    def __init__(self) -> None:
        self.appels: list[tuple] = []

    def gradient_checkpointing_enable(self, **kwargs):
        self.appels.append(("checkpointing", kwargs))

    def enable_input_require_grads(self):
        self.appels.append(("input_grads", {}))


def test_checkpointing_sans_prepare_model_for_kbit_training():
    modele = FauxModele()
    train_lora.activer_checkpointing(modele)
    assert [nom for nom, _ in modele.appels] == ["checkpointing", "input_grads"]
    assert modele.appels[0][1] == {"gradient_checkpointing_kwargs": {"use_reentrant": False}}
    # La fonction de peft qui repasse embed_tokens et lm_head en fp32 (≈ 4,4 Go sur un 7B) n'est plus utilisée.
    source = Path(train_lora.__file__).read_text(encoding="utf-8")
    assert "prepare_model_for_kbit_training(" not in source


def test_estimation_memoire_par_base():
    assert train_lora.memoire_estimee_go("Qwen/Qwen2.5-Coder-7B-Instruct") == 9.0
    assert train_lora.memoire_estimee_go("Qwen/Qwen2.5-Coder-3B-Instruct") == 5.0
    assert train_lora.memoire_estimee_go("yujiepan/qwen2.5-tiny-random") is None


def test_conseil_memoire_sur_6_go():
    six_go = 6 * 2**30
    conseil = train_lora.conseil_memoire(train_lora.BASE_PAR_DEFAUT, six_go)
    assert conseil is not None
    assert "carte louée" in conseil and train_lora.BASE_LOCALE in conseil and "--max-steps 20" in conseil
    assert train_lora.conseil_memoire(train_lora.BASE_LOCALE, six_go) is None
    assert train_lora.conseil_memoire(train_lora.BASE_PAR_DEFAUT, 24 * 2**30) is None
    assert train_lora.conseil_memoire("modele/inconnu", six_go) is None


def test_dry_run_passe_par_le_checkpointing(dossier_preparation: Path, tmp_path: Path, tokenizer):
    """Le chemin « checkpointing » est le même en dry-run qu'en vrai : il est exercé ici sur processeur."""
    sortie = tmp_path / "run"
    assert train_lora.main(["--data", str(dossier_preparation), "--dry-run", "--out", str(sortie), "--grad-accum", "2", "--max-steps", "2"]) == 0
    journal = (sortie / "journal.txt").read_text(encoding="utf-8")
    assert "pas 2 ·" in journal and "pas 3 ·" not in journal
    import json

    bilan = json.loads((sortie / "bilan.json").read_text(encoding="utf-8"))
    assert bilan["pas"] == 2 and bilan["pic_memoire_carte_go"] is None


def test_les_guides_disent_ou_le_7b_s_entraine_et_le_prix_releve():
    """Point 2 de la revue : 7B sur carte louée, essai local sur le 3B, coût estimé avec date et pages des prix."""
    racine = runs.racine_training()
    guide = (racine / "README.md").read_text(encoding="utf-8")
    cloud = (racine / "cloud" / "README.md").read_text(encoding="utf-8")
    assert "se fait\nsur une carte louée de 24 Go" in guide.replace("**", "")
    assert f"--base {train_lora.BASE_LOCALE}" in guide and "--max-steps 20" in guide
    for texte in (guide, cloud):
        assert "2 novembre 2026" in texte
        assert "https://www.runpod.io/pricing" in texte and "https://vast.ai/pricing" in texte
        assert "400 à 500" in texte and "2 à 3 h" in texte
    assert "RTX A5000 | 24 Go | 0,27 $" in cloud and "| RTX 3090 | 24 Go | 0,11 $ | 0,20 $ |" in cloud
