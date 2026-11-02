"""Format du gabarit (appels d'outils), masque de perte, lecture des fichiers préparés."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from jarvis_training import data as donnees

from .conftest import ecrire_jsonl, exemple_synthetique


def test_lecture_des_fichiers_train_et_validation(dossier_preparation: Path):
    train = donnees.lire_jsonl(dossier_preparation / "train.jsonl")
    validation = donnees.lire_jsonl(dossier_preparation / "validation.jsonl")
    assert len(train.exemples) == 8 and len(validation.exemples) == 2
    assert train.ignorees == [] and validation.ignorees == []
    assert {e.identifiant for e in train.exemples}.isdisjoint({e.identifiant for e in validation.exemples})
    assert train.exemples[0].messages[2]["tool_calls"][0]["function"]["name"] == "write_file"
    assert train.exemples[0].tools[0]["function"]["name"] == "write_file"


def test_ligne_invalide_est_sautee_et_comptee_sans_arreter(tmp_path: Path):
    """Même règle et mêmes raisons que `parseExampleLine` (labTrainPrep.ts) ; ici on saute, on compte, on continue."""
    sans_appel = exemple_synthetique(1)
    sans_appel["messages"][2] = {"role": "assistant", "content": "Les tests cachés sont au vert."}
    autre_outil = exemple_synthetique(2)
    autre_outil["messages"][2]["tool_calls"].append({"type": "function", "function": {"name": "run_command", "arguments": {"path": "x", "content": "npm test"}}})
    mauvais_arguments = exemple_synthetique(3)
    mauvais_arguments["messages"][2]["tool_calls"][0]["function"]["arguments"] = {"path": "x"}
    contenu_vide = exemple_synthetique(4)
    contenu_vide["messages"][2]["tool_calls"][0]["function"]["arguments"]["content"] = "  \n"
    sans_outils = exemple_synthetique(5)
    del sans_outils["tools"]
    sans_id = exemple_synthetique(6)
    del sans_id["id"]
    sans_demande = exemple_synthetique(7)
    sans_demande["messages"][1]["content"] = "   "
    bon = exemple_synthetique(8)
    ecrire_jsonl(tmp_path / "x.jsonl", [sans_appel, autre_outil, mauvais_arguments, contenu_vide, sans_outils, sans_id, sans_demande, bon])
    with (tmp_path / "x.jsonl").open("a", encoding="utf-8") as f:
        f.write("{pas du json\n\n")

    lecture = donnees.lire_jsonl(tmp_path / "x.jsonl")
    assert [e.identifiant for e in lecture.exemples] == ["synthetique-test-8"]
    assert [(i.numero, i.identifiant, i.raison) for i in lecture.ignorees] == [
        (1, "synthetique-test-1", "sans appel write_file"),
        (2, "synthetique-test-2", "appel d’outil non conforme : run_command au lieu de write_file"),
        (3, "synthetique-test-3", "appel d’outil non conforme : write_file attend path et content en chaînes"),
        (4, "synthetique-test-4", "appel d’outil non conforme : write_file au contenu vide"),
        (5, "synthetique-test-5", "sans catalogue tools"),
        (6, None, "ligne illisible"),
        (7, "synthetique-test-7", "ligne illisible"),
        (9, None, "ligne illisible"),
    ]
    with pytest.raises(donnees.ExempleInvalide, match="sans catalogue tools"):
        donnees.exemple_depuis(sans_outils)


def test_gabarit_rend_un_appel_d_outil_au_format_qwen(tokenizer):
    exemple = donnees.exemple_depuis(exemple_synthetique(3))
    rendu = donnees.rendre(tokenizer, exemple)
    assert rendu.texte.startswith("<|im_start|>system\n")
    # Le catalogue d'outils est écrit dans la consigne par le gabarit lui-même.
    assert "<tools>" in rendu.prefixe and '"name": "write_file"' in rendu.prefixe
    assert rendu.prefixe.endswith("<|im_start|>assistant\n")
    reponse = rendu.texte[len(rendu.prefixe) :]
    assert reponse.startswith("<tool_call>\n") and reponse.endswith("</tool_call><|im_end|>\n")
    appel = json.loads(reponse[len("<tool_call>\n") : -len("\n</tool_call><|im_end|>\n")])
    assert appel == {"name": "write_file", "arguments": {"path": "src/double3.ts", "content": "export function double3(n: number): number {\n  return n * 2;\n}\n"}}


def test_masque_de_perte_couvre_exactement_la_reponse(tokenizer):
    exemple = donnees.exemple_depuis(exemple_synthetique(4))
    encodage = donnees.encoder(tokenizer, exemple, longueur_max=4096)
    assert encodage is not None
    rendu = donnees.rendre(tokenizer, exemple)
    jetons_prefixe = tokenizer(rendu.prefixe, add_special_tokens=False)["input_ids"]
    masques = sum(1 for e in encodage.labels if e == donnees.IGNORE_INDEX)
    assert masques == len(jetons_prefixe)
    assert encodage.labels[masques:] == encodage.input_ids[masques:]
    assert encodage.jetons_appris == len(encodage.input_ids) - masques > 0
    appris = tokenizer.decode(encodage.input_ids[masques:])
    assert appris.startswith("<tool_call>") and "n * 2" in appris and "<|im_end|>" in appris
    assert "Tu écris du TypeScript" not in appris


def test_trop_long_est_laisse_de_cote(tokenizer):
    exemple = donnees.exemple_depuis(exemple_synthetique(5))
    assert donnees.encoder(tokenizer, exemple, longueur_max=16) is None
    jeu = donnees.encoder_jeu(tokenizer, [exemple, donnees.exemple_depuis(exemple_synthetique(6))], longueur_max=16)
    assert len(jeu) == 0 and jeu.trop_longs == 2


def test_assembleur_remplit_a_droite_et_masque_le_remplissage(tokenizer):
    jeu = donnees.encoder_jeu(tokenizer, [donnees.exemple_depuis(exemple_synthetique(7)), donnees.exemple_depuis(exemple_synthetique(70))], 4096)
    lot = donnees.Assembleur(tokenizer.pad_token_id or 0)([jeu[0], jeu[1]])
    assert lot["input_ids"].shape == lot["labels"].shape == lot["attention_mask"].shape
    longueurs = [len(jeu[0]["input_ids"]), len(jeu[1]["input_ids"])]
    assert lot["input_ids"].shape[1] == max(longueurs)
    court = longueurs.index(min(longueurs))
    if longueurs[0] != longueurs[1]:
        assert int(lot["attention_mask"][court].sum()) == min(longueurs)
        assert int(lot["labels"][court, min(longueurs) :].eq(donnees.IGNORE_INDEX).all())
