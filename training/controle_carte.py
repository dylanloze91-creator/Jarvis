#!/usr/bin/env python
"""Contrôle, après `setup-windows.ps1`, que la carte est vraiment utilisable pour QLoRA.

    .venv\\Scripts\\python controle_carte.py

Deux choses sont vérifiées, chacune avec une ligne lisible :
  1. torch voit la carte et sa roue contient l'architecture de la carte (sm_75 pour une RTX 2060) ;
  2. bitsandbytes fonctionne **sur la carte** : une couche `Linear4bit` (nf4, calcul fp16) est créée, envoyée
     sur la carte (c'est là que les poids sont quantifiés) et traversée une fois. C'est exactement ce que fait
     `train_lora.py` au chargement 4 bits ; un bitsandbytes installé mais sans noyau CUDA compatible échoue ici,
     à la mise en place, au lieu d'échouer après 15 Go de téléchargement du modèle (revue du 2026-11-02, point 9).

Codes de sortie : 0 tout va bien ; 2 pas de carte vue par torch ; 3 bitsandbytes ne fonctionne pas sur la carte.
Rien n'est téléchargé, rien n'est écrit.
"""

from __future__ import annotations

import sys
from typing import Callable

PAS_DE_CUDA = "PAS_DE_CUDA"
ARCH_ABSENTE = "ARCH_ABSENTE"
BNB_OK = "BNB_OK"
BNB_ECHEC = "BNB_ECHEC"


def controler_bitsandbytes(torch, bnb) -> str:
    """Crée une `Linear4bit` sur la carte et la traverse ; rend `BNB_OK …` ou `BNB_ECHEC …`."""
    try:
        couche = bnb.nn.Linear4bit(64, 32, bias=False, compute_dtype=torch.float16, quant_type="nf4")
        couche = couche.to("cuda")
        entree = torch.randn(2, 64, dtype=torch.float16, device="cuda")
        with torch.no_grad():
            sortie = couche(entree)
        if sortie.shape != (2, 32) or not torch.isfinite(sortie).all():
            return f"{BNB_ECHEC} sortie inattendue de Linear4bit ({tuple(sortie.shape)}, finie : {bool(torch.isfinite(sortie).all())})"
        return f"{BNB_OK} bitsandbytes {bnb.__version__} : Linear4bit nf4 fonctionne sur la carte"
    except Exception as erreur:  # noqa: BLE001 - on veut le message, quel qu'il soit
        return f"{BNB_ECHEC} {type(erreur).__name__} : {erreur}"


def controler(ecrire: Callable[[str], None] = print) -> int:
    import torch

    ecrire(f"torch {torch.__version__} cuda {torch.version.cuda}")
    if not torch.cuda.is_available():
        ecrire(PAS_DE_CUDA)
        return 2
    nom = torch.cuda.get_device_name(0)
    capacite = torch.cuda.get_device_capability(0)
    architectures = torch.cuda.get_arch_list()
    voulue = "sm_%d%d" % capacite
    ecrire(f"carte {nom} capacité {capacite[0]}.{capacite[1]}, mémoire {torch.cuda.get_device_properties(0).total_memory / 2**30:.1f} Go")
    ecrire(f"architectures compilées {' '.join(architectures)}")
    ecrire("ARCH_OK" if voulue in architectures else f"{ARCH_ABSENTE} {voulue}")
    try:
        import bitsandbytes as bnb
    except Exception as erreur:  # noqa: BLE001
        ecrire(f"{BNB_ECHEC} import impossible : {type(erreur).__name__} : {erreur}")
        return 3
    verdict = controler_bitsandbytes(torch, bnb)
    ecrire(verdict)
    return 0 if verdict.startswith(BNB_OK) else 3


if __name__ == "__main__":
    sys.exit(controler())
