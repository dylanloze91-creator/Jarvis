#!/usr/bin/env python3
"""Prépare un jeu d'images pour entraîner un LoRA SDXL (kohya sd-scripts).

Usage :
    python preparer_images.py --source "C:\\Photos\\mon-style" --nom mon-style --declencheur "mnstyl"
    python preparer_images.py --source ... --nom ... --declencheur ... --legende "sticker, white background"

Ce que fait le script :
  1. lit les images du dossier source (jpg, jpeg, png, webp, bmp) ;
  2. vérifie qu'il y en a entre 15 et 40 (au-delà, les premières 40 sont gardées et c'est dit) ;
  3. redimensionne chaque image pour que son plus grand côté fasse 1024 pixels
     (SDXL travaille autour de 1 mégapixel ; le rapport largeur/hauteur est gardé,
     la taille est arrondie au multiple de 64 le plus proche) ;
  4. écrit les images en PNG dans  training/lora/jeux/<nom>/<repetitions>_<declencheur>/
     (le nom du sous-dossier « 20_mnstyl » est la convention de kohya : 20 répétitions par époque) ;
  5. écrit à côté de chaque image un fichier .txt de même nom : la « description », qui commence
     toujours par le mot-clé déclencheur, suivi de la légende commune (facultative).

Dépendance : Pillow (pip install pillow). Rien n'est envoyé sur Internet.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - message pour l'utilisateur
    print("Il manque Pillow. Lance :  python -m pip install pillow", file=sys.stderr)
    sys.exit(2)

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MIN_IMAGES = 15
MAX_IMAGES = 40
TARGET = 1024


def taille_cible(largeur: int, hauteur: int, cible: int = TARGET) -> tuple[int, int]:
    """Plus grand côté = cible, l'autre proportionnel, les deux arrondis au multiple de 64 (64 au moins)."""
    if largeur >= hauteur:
        nouvelle_largeur = cible
        nouvelle_hauteur = max(64, round(hauteur * cible / largeur / 64) * 64)
    else:
        nouvelle_hauteur = cible
        nouvelle_largeur = max(64, round(largeur * cible / hauteur / 64) * 64)
    return nouvelle_largeur, nouvelle_hauteur


def legende_pour(declencheur: str, legende: str) -> str:
    """Le déclencheur d'abord, puis la légende commune. Jamais vide."""
    parts = [declencheur.strip()]
    if legende.strip():
        parts.append(legende.strip().strip(","))
    return ", ".join(parts)


def preparer(source: Path, nom: str, declencheur: str, legende: str, repetitions: int, destination: Path) -> int:
    images = sorted(p for p in source.iterdir() if p.suffix.lower() in EXTENSIONS and p.is_file())
    if len(images) < MIN_IMAGES:
        print(f"Il faut au moins {MIN_IMAGES} images ({len(images)} trouvée(s) dans {source}).", file=sys.stderr)
        return 1
    if len(images) > MAX_IMAGES:
        print(f"{len(images)} images : seules les {MAX_IMAGES} premières (ordre alphabétique) sont gardées.")
        images = images[:MAX_IMAGES]

    dossier = destination / nom / f"{repetitions}_{declencheur}"
    if dossier.exists():
        shutil.rmtree(dossier)
    dossier.mkdir(parents=True)

    texte = legende_pour(declencheur, legende)
    for index, chemin in enumerate(images, start=1):
        with Image.open(chemin) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            largeur, hauteur = taille_cible(*image.size)
            image = image.resize((largeur, hauteur), Image.LANCZOS)
            sortie = dossier / f"{nom}-{index:03d}.png"
            image.save(sortie, format="PNG", optimize=True)
        (dossier / f"{nom}-{index:03d}.txt").write_text(texte + "\n", encoding="utf-8")
        print(f"  {chemin.name} -> {sortie.name} ({largeur}x{hauteur})")

    print()
    print(f"Prêt : {len(images)} images dans {dossier}")
    print(f"Mot-clé déclencheur : {declencheur}  (à écrire dans le prompt pour activer le LoRA)")
    print(f"Description de chaque image : « {texte} »")
    print("Étape suivante : voir GUIDE_ENTRAINEMENT.md (envoi sur la carte louée).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Prépare 15 à 40 images pour un LoRA SDXL.")
    parser.add_argument("--source", required=True, help="Dossier qui contient tes images.")
    parser.add_argument("--nom", required=True, help="Nom du jeu (lettres, chiffres, tirets) : ex. mon-style.")
    parser.add_argument("--declencheur", required=True, help="Mot-clé rare qui déclenchera le LoRA : ex. mnstyl.")
    parser.add_argument("--legende", default="", help="Texte commun ajouté après le déclencheur (facultatif).")
    parser.add_argument("--repetitions", type=int, default=20, help="Répétitions par époque (kohya) ; 20 par défaut.")
    parser.add_argument("--destination", default=str(Path(__file__).parent / "jeux"), help="Dossier de sortie.")
    args = parser.parse_args()

    source = Path(args.source)
    if not source.is_dir():
        print(f"Dossier introuvable : {source}", file=sys.stderr)
        return 1
    if not args.nom.replace("-", "").replace("_", "").isalnum():
        print("Le nom ne doit contenir que des lettres, des chiffres, - ou _.", file=sys.stderr)
        return 1
    return preparer(source, args.nom, args.declencheur, args.legende, args.repetitions, Path(args.destination))


if __name__ == "__main__":
    sys.exit(main())
