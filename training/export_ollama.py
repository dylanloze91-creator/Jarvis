#!/usr/bin/env python
"""Export de l'élève entraîné vers Ollama, sous le nom `jarvis-coder` (5.0.65).

Depuis le dossier `training/`, dans l'environnement créé par `setup-windows.ps1` :

    .venv\\Scripts\\python export_ollama.py --run runs\\2026-11-20-2130

Quatre étapes, chacune reprise si son résultat existe déjà dans `--out` :
  1. fusion    : l'adaptateur LoRA est fondu dans le modèle de base (fp16, sur processeur : il faut
                 ~16 Go de mémoire vive libre et ~35 Go de disque dans --out pour un 7B ; le script
                 l'annonce et avertit si ça manque) → `<out>/fusion/`
  2. conversion: `convert_hf_to_gguf.py` de llama.cpp (version épinglée par setup-windows.ps1) → `<out>/<nom>-f16.gguf`
  3. quantification : `llama-quantize … Q4_K_M` → `<out>/<nom>-Q4_K_M.gguf` (même taille que qwen2.5-coder:7b)
  4. Modelfile : repris de `ollama show --modelfile qwen2.5-coder:7b` (TEMPLATE, PARAMETER, SYSTEM,
                 LICENSE gardés tels quels), seule la ligne FROM change → `ollama create jarvis-coder -f Modelfile`

Avec `--gguf <fichier>` (GGUF déjà produit sur une carte louée, voir cloud/README.md), seules les
étapes 3 (si le fichier n'est pas déjà quantifié) et 4 sont faites.

Rien ne remplace quoi que ce soit : `qwen2.5-coder:7b` reste installé, `jarvis-coder` s'ajoute à
côté. Le choix du modèle de code se fait ensuite dans Jarvis (Réglages → Développeur) après
`npm run lab:compare`. Pour revenir en arrière : `ollama rm jarvis-coder`.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from jarvis_training import runs  # noqa: E402

NOM_PAR_DEFAUT = "jarvis-coder"
MODELE_SOURCE_PAR_DEFAUT = "qwen2.5-coder:7b"
QUANTIFICATION_PAR_DEFAUT = "Q4_K_M"
LLAMA_TAG = "b12032"
# Besoins de la fusion d'un 7B sur processeur (revue du 2026-11-02, point 10) : le modèle fp16 entier en mémoire vive
# (~15 Go) ; sur disque, fusion/ (~15 Go) + GGUF f16 (~15 Go) + GGUF Q4_K_M (~4,7 Go), dans --out. Le modèle de base
# téléchargé par Hugging Face (~15 Go) est dans son cache, en plus.
BESOINS_FUSION_7B = {"ram_go": 16, "disque_go": 35}


def construire_parseur() -> argparse.ArgumentParser:
    parseur = argparse.ArgumentParser(
        prog="export_ollama.py",
        description="Fusionne l'adaptateur, convertit en GGUF, quantifie et crée le modèle Ollama jarvis-coder.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    source = parseur.add_mutually_exclusive_group(required=True)
    source.add_argument("--run", type=Path, help="dossier d'un entraînement (training/runs/<date>) : l'adaptateur est dans adaptateur/")
    source.add_argument("--adapter", type=Path, help="dossier d'un adaptateur LoRA (adapter_config.json, adapter_model.safetensors)")
    source.add_argument("--gguf", type=Path, help="GGUF déjà converti (carte louée) : saute fusion et conversion")
    parseur.add_argument("--base", default=None, help="modèle de base Hugging Face (défaut : celui noté dans adapter_config.json)")
    parseur.add_argument("--name", default=NOM_PAR_DEFAUT, help="nom du modèle créé dans Ollama")
    parseur.add_argument("--source-model", default=MODELE_SOURCE_PAR_DEFAUT, help="modèle Ollama dont le Modelfile (gabarit, paramètres) est repris")
    parseur.add_argument("--quant", default=QUANTIFICATION_PAR_DEFAUT, help="type de quantification llama.cpp")
    parseur.add_argument("--out", type=Path, default=None, help="dossier de sortie (défaut : training/export/<nom>)")
    parseur.add_argument("--llama", type=Path, default=None, help=f"dossier llama.cpp préparé par setup-windows.ps1 (défaut : training/llama.cpp, tag {LLAMA_TAG})")
    parseur.add_argument("--no-create", action="store_true", help="écrire le Modelfile sans lancer « ollama create »")
    parseur.add_argument("--gguf-only", action="store_true", help="s'arrêter au GGUF quantifié, sans Ollama (carte louée : le fichier est ensuite rapatrié et passé en --gguf)")
    parseur.add_argument("--clean", action="store_true", help="supprimer fusion/ et le GGUF f16 une fois le modèle créé (≈ 30 Go libérés)")
    return parseur


# --- Fonctions pures (testées sans torch ni Ollama) -----------------------------------------------


def reecrire_modelfile(texte: str, gguf: Path) -> str:
    """Le Modelfile de `ollama show --modelfile`, où seule la ligne FROM est remplacée par le GGUF.

    `ollama show` rend un FROM qui pointe vers le blob local du modèle source (commentaire
    « To build a new Modelfile based on this… » compris) ; tout le reste — TEMPLATE, PARAMETER,
    SYSTEM, LICENSE — est conservé à l'identique. Seuls les commentaires **hors** des blocs
    `\"\"\"…\"\"\"` sont retirés : le gabarit de qwen2.5-coder contient la ligne `# Tools`, qui fait
    partie du texte vu par le modèle et doit rester (revue du 2026-11-02, point 1). La documentation d'Ollama (docs/import.mdx,
    docs/modelfile.mdx, lues le 2026-11-02) décrit l'import d'un GGUF par `FROM /chemin/fichier.gguf`
    et ne liste pas d'instruction qui appliquerait un adaptateur LoRA séparé : d'où la fusion
    préalable, seule voie documentée.
    """
    chemin = gguf.resolve().as_posix()
    ligne_from = f'FROM "{chemin}"' if " " in chemin else f"FROM {chemin}"
    lignes = texte.splitlines()
    sortie: list[str] = []
    from_remplace = False
    dans_bloc = False  # à l'intérieur d'un bloc """…""" (TEMPLATE, SYSTEM, LICENSE) : tout est gardé au caractère près
    for ligne in lignes:
        if dans_bloc:
            sortie.append(ligne)
            if ligne.count('"""') % 2 == 1:
                dans_bloc = False
            continue
        depouillee = ligne.strip()
        if depouillee.startswith("#"):
            continue
        if re.match(r"(?i)^FROM\s", depouillee):
            if not from_remplace:
                sortie.append(ligne_from)
                from_remplace = True
            continue
        sortie.append(ligne.rstrip())
        if ligne.count('"""') % 2 == 1:
            dans_bloc = True
    if not from_remplace:
        sortie.insert(0, ligne_from)
    while sortie and not sortie[0].strip():
        sortie.pop(0)
    return "\n".join(sortie).rstrip("\n") + "\n"


def avertissements_place(disque_libre_go: float | None, ram_libre_go: float | None, besoins: dict[str, int] = BESOINS_FUSION_7B) -> list[str]:
    """Ce qui manque (disque dans --out, mémoire vive) pour fusionner un 7B ; liste vide si tout va bien ou si c'est inconnu."""
    avis = []
    if disque_libre_go is not None and disque_libre_go < besoins["disque_go"]:
        avis.append(f"disque : {disque_libre_go:.0f} Go libres dans le dossier de sortie, il en faut environ {besoins['disque_go']} (fusion ~15 Go + GGUF f16 ~15 Go + GGUF quantifié ~5 Go ; --clean les libère à la fin, pas avant)")
    if ram_libre_go is not None and ram_libre_go < besoins["ram_go"]:
        avis.append(f"mémoire vive : {ram_libre_go:.0f} Go libres, il en faut environ {besoins['ram_go']} pour charger le 7B en fp16 sur processeur (fermer les autres programmes, Ollama compris)")
    return avis


def memoire_vive_libre_go() -> float | None:
    """Mémoire vive disponible, en Go, ou `None` si le système ne le dit pas simplement."""
    try:
        if sys.platform == "win32":
            import ctypes

            class EtatMemoire(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            etat = EtatMemoire()
            etat.dwLength = ctypes.sizeof(EtatMemoire)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(etat)):  # type: ignore[attr-defined]
                return etat.ullAvailPhys / 2**30
            return None
        with open("/proc/meminfo", encoding="utf-8") as f:
            for ligne in f:
                if ligne.startswith("MemAvailable:"):
                    return int(ligne.split()[1]) * 1024 / 2**30
    except (OSError, ValueError, AttributeError):
        return None
    return None


def verifier_place(sortie: Path, journal) -> None:
    disque = shutil.disk_usage(sortie).free / 2**30
    for avis in avertissements_place(disque, memoire_vive_libre_go()):
        journal.warning("ATTENTION : %s.", avis)


def trouver_convertisseur(llama: Path) -> Path:
    """`convert_hf_to_gguf.py` dans le dossier llama.cpp (archive source dézippée par setup)."""
    candidats = [llama / "convert_hf_to_gguf.py", llama / f"llama.cpp-{LLAMA_TAG}" / "convert_hf_to_gguf.py"]
    candidats += sorted(llama.glob("llama.cpp-*/convert_hf_to_gguf.py"))
    for candidat in candidats:
        if candidat.is_file():
            return candidat
    raise SystemExit(f"convert_hf_to_gguf.py introuvable sous {llama}. Relance setup-windows.ps1 (il télécharge llama.cpp {LLAMA_TAG}).")


def trouver_quantize(llama: Path) -> Path:
    """`llama-quantize(.exe)` : binaire Windows déposé par setup, ou dans le PATH."""
    for nom in ("llama-quantize.exe", "llama-quantize"):
        for candidat in (llama / "bin" / nom, llama / nom):
            if candidat.is_file():
                return candidat
        trouve = shutil.which(nom)
        if trouve:
            return Path(trouve)
    raise SystemExit(f"llama-quantize introuvable sous {llama / 'bin'} ni dans le PATH. Relance setup-windows.ps1.")


def deja_quantifie(gguf: Path, quant: str) -> bool:
    return gguf.stem.upper().endswith(quant.upper())


def base_depuis_adaptateur(adaptateur: Path) -> str:
    config = runs.lire_json(adaptateur / "adapter_config.json")
    base = config.get("base_model_name_or_path")
    if not isinstance(base, str) or not base:
        raise SystemExit(f"{adaptateur / 'adapter_config.json'} ne donne pas le modèle de base : passe --base.")
    return base


# --- Étapes ----------------------------------------------------------------------------------------


def fusionner(base: str, adaptateur: Path, destination: Path, journal) -> Path:
    if (destination / "config.json").exists() and any(destination.glob("*.safetensors")):
        journal.info("Fusion déjà présente dans %s, étape sautée.", destination)
        return destination
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    journal.info("Chargement de %s en fp16 sur processeur (long : plusieurs minutes, ~16 Go de mémoire vive)…", base)
    modele = AutoModelForCausalLM.from_pretrained(base, dtype=torch.float16, low_cpu_mem_usage=True)
    journal.info("Application de l'adaptateur %s puis fusion…", adaptateur)
    modele = PeftModel.from_pretrained(modele, str(adaptateur))
    modele = modele.merge_and_unload()
    destination.mkdir(parents=True, exist_ok=True)
    modele.save_pretrained(str(destination), safe_serialization=True)
    AutoTokenizer.from_pretrained(base).save_pretrained(str(destination))
    journal.info("Modèle fusionné écrit dans %s.", destination)
    return destination


def convertir(fusion: Path, gguf_f16: Path, llama: Path, journal) -> Path:
    if gguf_f16.exists():
        journal.info("GGUF f16 déjà présent (%s), conversion sautée.", gguf_f16)
        return gguf_f16
    convertisseur = trouver_convertisseur(llama)
    commande = [sys.executable, str(convertisseur), str(fusion), "--outtype", "f16", "--outfile", str(gguf_f16)]
    journal.info("Conversion GGUF : %s", " ".join(commande))
    subprocess.run(commande, check=True)
    return gguf_f16


def quantifier(gguf_f16: Path, gguf_quant: Path, quant: str, llama: Path, journal) -> Path:
    if gguf_quant.exists():
        journal.info("GGUF %s déjà présent (%s), quantification sautée.", quant, gguf_quant)
        return gguf_quant
    outil = trouver_quantize(llama)
    commande = [str(outil), str(gguf_f16), str(gguf_quant), quant]
    journal.info("Quantification : %s", " ".join(commande))
    subprocess.run(commande, check=True)
    return gguf_quant


def modelfile_source(modele_source: str, journal) -> str:
    commande = ["ollama", "show", "--modelfile", modele_source]
    journal.info("Lecture du Modelfile de %s : %s", modele_source, " ".join(commande))
    try:
        resultat = subprocess.run(commande, check=True, capture_output=True, text=True, encoding="utf-8")
    except FileNotFoundError:
        raise SystemExit("Ollama introuvable (commande « ollama »). Installe Ollama ou ajoute-le au PATH.") from None
    except subprocess.CalledProcessError as erreur:
        raise SystemExit(f"« ollama show --modelfile {modele_source} » a échoué : {erreur.stderr.strip()}. Le modèle source est-il installé (ollama pull {modele_source}) ?") from None
    return resultat.stdout


def creer_modele(nom: str, modelfile: Path, journal) -> None:
    commande = ["ollama", "create", nom, "-f", str(modelfile)]
    journal.info("Création du modèle Ollama : %s", " ".join(commande))
    subprocess.run(commande, check=True)


def main(argv: list[str] | None = None) -> int:
    args = construire_parseur().parse_args(argv)
    racine = runs.racine_training()
    sortie = (args.out or racine / "export" / args.name).resolve()
    sortie.mkdir(parents=True, exist_ok=True)
    llama = (args.llama or racine / "llama.cpp").resolve()
    journal = runs.ouvrir_journal(sortie, nom="jarvis-export")
    try:
        journal.info("=== Export vers Ollama : %s ===", args.name)
        if args.gguf:
            gguf = args.gguf.resolve()
            if not gguf.is_file():
                raise SystemExit(f"GGUF introuvable : {gguf}")
            if deja_quantifie(gguf, args.quant):
                gguf_final = gguf
                journal.info("GGUF fourni déjà en %s : %s", args.quant, gguf)
            else:
                gguf_final = quantifier(gguf, sortie / f"{args.name}-{args.quant}.gguf", args.quant, llama, journal)
        else:
            adaptateur = (args.adapter or args.run / runs.ADAPTATEUR).resolve()
            if not (adaptateur / "adapter_config.json").is_file():
                raise SystemExit(f"Adaptateur introuvable : {adaptateur}. L'entraînement s'est-il terminé (bilan.json dans le dossier du run) ?")
            if args.run and (args.run / runs.BILAN).is_file() and runs.lire_json(args.run / runs.BILAN).get("dry_run"):
                raise SystemExit("Ce run est un --dry-run (modèle minuscule aléatoire) : rien à exporter.")
            base = args.base or base_depuis_adaptateur(adaptateur)
            journal.info("Base : %s · adaptateur : %s", base, adaptateur)
            if not (sortie / "fusion" / "config.json").exists():
                verifier_place(sortie, journal)
            fusion = fusionner(base, adaptateur, sortie / "fusion", journal)
            gguf_f16 = convertir(fusion, sortie / f"{args.name}-f16.gguf", llama, journal)
            gguf_final = quantifier(gguf_f16, sortie / f"{args.name}-{args.quant}.gguf", args.quant, llama, journal)

        if args.gguf_only:
            journal.info("--gguf-only : GGUF prêt dans %s. Sur le PC : python export_ollama.py --gguf <ce fichier>.", gguf_final)
            if args.clean and not args.gguf:
                shutil.rmtree(sortie / "fusion", ignore_errors=True)
                (sortie / f"{args.name}-f16.gguf").unlink(missing_ok=True)
            return 0

        modelfile = sortie / "Modelfile"
        modelfile.write_text(reecrire_modelfile(modelfile_source(args.source_model, journal), gguf_final), encoding="utf-8")
        journal.info("Modelfile écrit : %s", modelfile)
        if args.no_create:
            journal.info("--no-create : lance toi-même « ollama create %s -f %s ».", args.name, modelfile)
            return 0
        creer_modele(args.name, modelfile, journal)
        journal.info("Modèle « %s » créé dans Ollama. Étape suivante : npm run lab:compare --workspace @jarvis/core -- --base %s --candidate %s --runs 3", args.name, args.source_model, args.name)
        if args.clean and not args.gguf:
            shutil.rmtree(sortie / "fusion", ignore_errors=True)
            (sortie / f"{args.name}-f16.gguf").unlink(missing_ok=True)
            journal.info("Nettoyage : fusion/ et GGUF f16 supprimés (le GGUF %s et le Modelfile restent).", args.quant)
        return 0
    finally:
        runs.fermer_journal(journal)


if __name__ == "__main__":
    sys.exit(main())
