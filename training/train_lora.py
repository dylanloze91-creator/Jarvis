#!/usr/bin/env python
"""Affinage QLoRA de l'élève de Jarvis (5.0.65).

Depuis le dossier `training/`, dans l'environnement créé par `setup-windows.ps1` :

    .venv\\Scripts\\python train_lora.py --data C:\\dev\\jarvis-data\\preparation

Options principales (toutes ont une valeur par défaut raisonnable, expliquée dans `--help`) :
    --base      modèle de base Hugging Face (défaut : Qwen/Qwen2.5-Coder-7B-Instruct, celui de qwen2.5-coder:7b)
    --rank, --alpha, --dropout, --lr, --epochs, --max-length, --grad-accum
    --out       dossier de l'entraînement (défaut : training/runs/<date>) ; relancer avec le même --out reprend
                au dernier point de reprise (`--fresh` pour repartir de zéro)
    --dry-run   circuit complet sur un modèle Qwen2 minuscule et aléatoire, sur processeur, sans quantification :
                sert aux tests et à vérifier l'installation sans carte graphique. Ne produit rien d'utilisable.

Où ça tourne : le 7B en QLoRA demande de l'ordre de 9 Go de mémoire de carte (poids 4 bits,
`embed_tokens` et `lm_head` en fp16, logits sur 152 064 mots) : **carte louée de 24 Go**
(`cloud/README.md`). Sur la RTX 2060 (6 Go) : essai local avec `--base Qwen/Qwen2.5-Coder-3B-Instruct`,
d'abord `--max-steps 20` pour lire le pic de mémoire réel dans le journal.

Ce qui est fait : lecture de `train.jsonl` et `validation.jsonl`, mise au format exact du gabarit
de chat du modèle (appels d'outils compris, `apply_chat_template(..., tools=...)`), perte calculée
seulement sur la réponse de l'assistant, QLoRA 4 bits (nf4, calcul en fp16 : pas de bf16 sur une
carte Turing), lot de 1 avec accumulation, gradient checkpointing, perte de validation à chaque époque,
arrêt dès qu'elle ne baisse plus et retour au meilleur point, journal lisible dans `journal.txt`.
Rien n'est envoyé nulle part ; le modèle de production de Jarvis n'est pas touché : l'adaptateur
est écrit dans `<out>/adaptateur/` et c'est `export_ollama.py` qui, sur demande, crée `jarvis-coder`.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from jarvis_training import data as donnees  # noqa: E402
from jarvis_training import runs  # noqa: E402

BASE_PAR_DEFAUT = "Qwen/Qwen2.5-Coder-7B-Instruct"
# Pour un essai local sur une carte de 6 Go (RTX 2060) : le 7B n'y tient pas en QLoRA (voir memoire_estimee_go).
BASE_LOCALE = "Qwen/Qwen2.5-Coder-3B-Instruct"
# Qwen2 minuscule (2 couches, dimension 8) au gabarit de chat identique à celui de Qwen2.5-Coder-7B-Instruct.
BASE_DRY_RUN = "yujiepan/qwen2.5-tiny-random"
MODULES_LORA = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]


def construire_parseur() -> argparse.ArgumentParser:
    parseur = argparse.ArgumentParser(
        prog="train_lora.py",
        description="Affinage QLoRA de l'élève de Jarvis sur les exemples préparés par « npm run lab:prepare ».",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parseur.add_argument("--data", required=True, type=Path, help="dossier preparation/ (train.jsonl, validation.jsonl)")
    parseur.add_argument("--base", default=None, help=f"modèle de base Hugging Face (défaut : {BASE_PAR_DEFAUT}, à entraîner sur carte louée de 24 Go ; en local sur 6 Go : {BASE_LOCALE} ; en --dry-run : {BASE_DRY_RUN})")
    parseur.add_argument("--out", type=Path, default=None, help="dossier de l'entraînement (défaut : training/runs/<date>)")
    parseur.add_argument("--rank", type=int, default=16, help="rang LoRA : 16 suffit pour un format d'appel d'outil et du code court ; 32 apprend plus, plus lourd")
    parseur.add_argument("--alpha", type=int, default=32, help="échelle LoRA, deux fois le rang par habitude")
    parseur.add_argument("--dropout", type=float, default=0.05, help="abandon LoRA : un peu de régularisation sur quelques centaines d'exemples")
    parseur.add_argument("--lr", type=float, default=2e-4, help="taux d'apprentissage : valeur courante pour QLoRA sur un 7B")
    parseur.add_argument("--epochs", type=float, default=3.0, help="époques au plus ; l'arrêt se fait dès que la perte de validation remonte")
    parseur.add_argument("--max-length", type=int, default=2048, help="longueur maximale en jetons ; un exemple plus long est laissé de côté (compté dans le journal). 2048 tient sur 6 Go ; 3072 demande plus de mémoire")
    parseur.add_argument("--grad-accum", type=int, default=16, help="accumulation : lot effectif de 16 avec un lot réel de 1")
    parseur.add_argument("--warmup", type=float, default=0.03, help="part de l'entraînement en montée progressive du taux")
    parseur.add_argument("--seed", type=int, default=5065, help="graine (mélange des lots, initialisation LoRA)")
    parseur.add_argument("--fresh", action="store_true", help="ne pas reprendre un point de reprise présent dans --out")
    parseur.add_argument("--no-quant", action="store_true", help="pas de 4 bits (carte louée avec assez de mémoire) ; fp16 entier")
    parseur.add_argument("--dry-run", action="store_true", help="modèle minuscule aléatoire sur processeur : vérifie le circuit, ne produit rien d'utile")
    parseur.add_argument("--max-steps", type=int, default=-1, help="arrêt après N pas (tests)")
    return parseur


def lire_jeux(dossier: Path) -> tuple[list[donnees.Exemple], list[donnees.Exemple]]:
    train = dossier / "train.jsonl"
    validation = dossier / "validation.jsonl"
    for chemin in (train, validation):
        if not chemin.exists():
            raise SystemExit(f"Fichier absent : {chemin}. Lance d'abord « npm run lab:prepare --workspace @jarvis/core -- --dir <données> ».")
    return list(donnees.lire_jsonl(train)), list(donnees.lire_jsonl(validation))


def charger_modele(base: str, *, quantifie: bool, sur_carte: bool, journal):
    import torch
    from transformers import AutoModelForCausalLM

    if quantifie:
        from transformers import BitsAndBytesConfig

        config_4bits = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.float16,
        )
        journal.info("Chargement de %s en 4 bits (nf4, calcul fp16)…", base)
        return AutoModelForCausalLM.from_pretrained(base, quantization_config=config_4bits, device_map={"": 0}, dtype=torch.float16)
    dtype = torch.float16 if sur_carte else torch.float32
    journal.info("Chargement de %s en %s (%s)…", base, "fp16" if sur_carte else "fp32", "carte graphique" if sur_carte else "processeur")
    modele = AutoModelForCausalLM.from_pretrained(base, dtype=dtype)
    if sur_carte:
        modele = modele.to("cuda")
    return modele


def activer_checkpointing(modele) -> None:
    """Gradient checkpointing + gradients sur les entrées, **sans** repasser de poids en fp32.

    `prepare_model_for_kbit_training` de peft convertit en fp32 tous les paramètres non quantifiés ;
    sur Qwen 7B ce sont `embed_tokens` et `lm_head` (152 064 × 3 584 chacun), soit ~4,4 Go en fp32
    au lieu de ~2,2 Go en fp16 : le modèle ne tenait plus dans 6 Go (revue du 2026-11-02, point 2).
    Les poids gelés restent donc en 4 bits / fp16 ; seuls les poids LoRA sont en fp32 (peft le fait
    par défaut), ce que l'entraînement fp16 du Trainer exige.
    """
    modele.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    modele.enable_input_require_grads()


def memoire_estimee_go(base: str) -> float | None:
    """Ordre de grandeur de la mémoire de carte nécessaire pour l'entraînement QLoRA d'une base connue.

    Poids 4 bits + `embed_tokens` et `lm_head` en fp16 + logits sur 2 048 jetons + activations et
    optimiseur, avec une marge : chiffres de l'ordre du calcul, pas des mesures (rien n'a tourné sur
    une carte). Un nom inconnu rend `None`.
    """
    nom = base.lower()
    if "7b" in nom:
        return 9.0
    if "3b" in nom:
        return 5.0
    if "1.5b" in nom:
        return 3.0
    if "0.5b" in nom:
        return 2.0
    return None


def conseil_memoire(base: str, vram_octets: int) -> str | None:
    """Avertissement si la carte est trop petite pour la base, `None` sinon."""
    besoin = memoire_estimee_go(base)
    vram_go = vram_octets / 2**30
    if besoin is None or vram_go >= besoin:
        return None
    return (
        f"Carte de {vram_go:.1f} Go pour {base} : il faut environ {besoin:.0f} Go en QLoRA. "
        f"Le 7B se fait sur carte louée (training/cloud/README.md) ; en local, essai sur --base {BASE_LOCALE}, "
        "et --max-steps 20 pour mesurer la mémoire réellement prise avant une nuit complète."
    )


def preparer_lora(modele, args, *, quantifie: bool, checkpointing: bool):
    from peft import LoraConfig, get_peft_model

    if checkpointing:
        activer_checkpointing(modele)
    config = LoraConfig(
        r=args.rank,
        lora_alpha=args.alpha,
        lora_dropout=args.dropout,
        target_modules=MODULES_LORA,
        bias="none",
        task_type="CAUSAL_LM",
    )
    modele = get_peft_model(modele, config)
    modele.config.use_cache = False
    return modele


def main(argv: list[str] | None = None) -> int:
    args = construire_parseur().parse_args(argv)
    import torch

    sur_carte = torch.cuda.is_available() and not args.dry_run
    if not sur_carte and not args.dry_run:
        print("Aucune carte graphique CUDA visible. Sans carte : --dry-run (vérification), ou la carte louée (training/cloud/README.md).")
        return 2
    base = args.base or (BASE_DRY_RUN if args.dry_run else BASE_PAR_DEFAUT)
    quantifie = sur_carte and not args.no_quant

    dossier = args.out.resolve() if args.out else runs.nouveau_dossier()
    dossier.mkdir(parents=True, exist_ok=True)
    journal = runs.ouvrir_journal(dossier)
    debut = time.time()
    try:
        point = None if args.fresh else runs.dernier_point(dossier)
        journal.info("=== Entraînement de l'élève (5.0.65) ===")
        journal.info("Dossier : %s", dossier)
        journal.info("Base : %s · %s", base, "DRY-RUN (modèle minuscule aléatoire, processeur)" if args.dry_run else ("QLoRA 4 bits" if quantifie else "LoRA fp16"))
        if point:
            journal.info("Reprise depuis %s", point)
        if sur_carte:
            vram = torch.cuda.get_device_properties(0).total_memory
            journal.info("Carte : %s, %.1f Go.", torch.cuda.get_device_name(0), vram / 2**30)
            avertissement = conseil_memoire(base, vram)
            if avertissement:
                journal.warning("ATTENTION : %s", avertissement)
        runs.ecrire_json(dossier / runs.PARAMETRES, {**{k: (str(v) if isinstance(v, Path) else v) for k, v in vars(args).items()}, "base": base})

        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(base)
        if tokenizer.pad_token_id is None:
            tokenizer.pad_token = tokenizer.eos_token
        if not tokenizer.chat_template or "tools" not in tokenizer.chat_template:
            journal.error("Le gabarit de chat de %s ne gère pas les outils : impossible de reproduire le format des appels write_file.", base)
            return 3

        exemples_train, exemples_validation = lire_jeux(args.data.resolve())
        jeu_train = donnees.encoder_jeu(tokenizer, exemples_train, args.max_length)
        jeu_validation = donnees.encoder_jeu(tokenizer, exemples_validation, args.max_length)
        if len(jeu_train) == 0 or len(jeu_validation) == 0:
            journal.error("Jeu vide après encodage (train %d, validation %d). Vérifie --data et --max-length.", len(jeu_train), len(jeu_validation))
            return 4
        appris = sum(e.jetons_appris for e in jeu_train.exemples)
        total = sum(len(e.input_ids) for e in jeu_train.exemples)
        journal.info(
            "Exemples : %d en entraînement (%d trop longs laissés de côté), %d en validation (%d trop longs). Longueur max %d jetons.",
            len(jeu_train), jeu_train.trop_longs, len(jeu_validation), jeu_validation.trop_longs, args.max_length,
        )
        journal.info("Perte calculée sur %d jetons de réponse sur %d au total (%.0f %%) : consigne et demande masquées.", appris, total, 100 * appris / max(1, total))

        modele = charger_modele(base, quantifie=quantifie, sur_carte=sur_carte, journal=journal)
        modele = preparer_lora(modele, args, quantifie=quantifie, checkpointing=True)
        entrainables = sum(p.numel() for p in modele.parameters() if p.requires_grad)
        journal.info("LoRA rang %d, alpha %d, abandon %.2f sur %s : %s paramètres entraînables.", args.rank, args.alpha, args.dropout, ", ".join(MODULES_LORA), f"{entrainables:,}".replace(",", " "))

        from transformers import EarlyStoppingCallback, PrinterCallback, Trainer, TrainingArguments

        arguments = TrainingArguments(
            output_dir=str(dossier / runs.POINTS),
            per_device_train_batch_size=1,
            per_device_eval_batch_size=1,
            gradient_accumulation_steps=args.grad_accum,
            num_train_epochs=args.epochs,
            max_steps=args.max_steps,
            learning_rate=args.lr,
            lr_scheduler_type="cosine",
            warmup_ratio=args.warmup,
            weight_decay=0.0,
            fp16=sur_carte,
            bf16=False,
            gradient_checkpointing=False,
            optim="paged_adamw_8bit" if quantifie else "adamw_torch",
            logging_strategy="steps",
            logging_steps=1 if args.dry_run else 5,
            eval_strategy="epoch",
            save_strategy="epoch",
            save_total_limit=2,
            load_best_model_at_end=True,
            metric_for_best_model="eval_loss",
            greater_is_better=False,
            report_to=[],
            remove_unused_columns=False,
            dataloader_pin_memory=sur_carte,
            seed=args.seed,
            use_cpu=not sur_carte,
            disable_tqdm=True,
        )
        journal.info("Réglages : lot 1 × accumulation %d, taux %.1e, %.1f époque(s) au plus, cosinus, montée %.0f %%, %s.", args.grad_accum, args.lr, args.epochs, 100 * args.warmup, "fp16" if sur_carte else "fp32")

        class Suivi(EarlyStoppingCallback):
            """Écrit chaque perte dans le journal, en plus de l'arrêt dès que la validation remonte."""

            def on_log(self, _args, state, control, logs=None, **kwargs):
                if logs and "loss" in logs:
                    journal.info("époque %.2f · pas %d · perte %.4f", state.epoch or 0, state.global_step, logs["loss"])
                return control

            def on_evaluate(self, _args, state, control, metrics=None, **kwargs):
                if metrics and "eval_loss" in metrics:
                    journal.info("époque %.2f · perte de validation %.4f", state.epoch or 0, metrics["eval_loss"])
                return super().on_evaluate(_args, state, control, metrics=metrics, **kwargs)

        entraineur = Trainer(
            model=modele,
            args=arguments,
            train_dataset=jeu_train,
            eval_dataset=jeu_validation,
            data_collator=donnees.Assembleur(tokenizer.pad_token_id),
            callbacks=[Suivi(early_stopping_patience=1)],
        )
        # Le journal tient lieu d'affichage : pas de dictionnaires bruts à l'écran.
        entraineur.remove_callback(PrinterCallback)
        resultat = entraineur.train(resume_from_checkpoint=str(point) if point else None)
        meilleur = entraineur.state.best_metric
        journal.info("Fin : %d pas, perte d'entraînement %.4f, meilleure perte de validation %s.", entraineur.state.global_step, resultat.training_loss, f"{meilleur:.4f}" if meilleur is not None else "—")
        pic_go = round(torch.cuda.max_memory_allocated(0) / 2**30, 2) if sur_carte else None
        if pic_go is not None:
            journal.info("Pic de mémoire de carte : %.2f Go (à comparer à la mémoire totale avant une nuit complète).", pic_go)

        sortie = dossier / runs.ADAPTATEUR
        entraineur.model.save_pretrained(str(sortie))
        tokenizer.save_pretrained(str(sortie))
        bilan = {
            "base": base,
            "dry_run": args.dry_run,
            "pas": entraineur.state.global_step,
            "epoques": entraineur.state.epoch,
            "perte_entrainement": resultat.training_loss,
            "meilleure_perte_validation": meilleur,
            "meilleur_point": entraineur.state.best_model_checkpoint,
            "exemples": {"train": len(jeu_train), "validation": len(jeu_validation), "trop_longs": jeu_train.trop_longs + jeu_validation.trop_longs},
            "duree_s": round(time.time() - debut),
            "pic_memoire_carte_go": pic_go,
            "adaptateur": str(sortie),
        }
        runs.ecrire_json(dossier / runs.BILAN, bilan)
        journal.info("Adaptateur écrit dans %s (durée %s).", sortie, runs.duree_lisible(time.time() - debut))
        if args.dry_run:
            journal.info("DRY-RUN terminé : le circuit fonctionne. Cet adaptateur est aléatoire, ne pas l'exporter.")
        else:
            journal.info("Étape suivante : python export_ollama.py --run %s (voir README.md).", dossier)
        return 0
    finally:
        runs.fermer_journal(journal)


if __name__ == "__main__":
    sys.exit(main())
