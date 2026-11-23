"""python -m jarvis_oeil --config /etc/jarvis-oeil/config.toml"""

from __future__ import annotations

import argparse
import signal
import sys
import threading

from .camera import CameraPicamera2, CoupureGpio, FausseCamera, SansCoupure, SansTemoin, TemoinGpio
from .config import ConfigErreur, charger
from .service import ServiceOeil


def main(argv: list[str] | None = None) -> int:
    lecteur = argparse.ArgumentParser(prog="jarvis_oeil")
    lecteur.add_argument("--config", required=True)
    args = lecteur.parse_args(argv)
    try:
        config = charger(args.config)
    except (ConfigErreur, OSError, ValueError) as erreur:
        print(f"Réglages refusés : {erreur}", file=sys.stderr)
        return 2

    temoin = TemoinGpio(config.temoin_gpio) if config.temoin_gpio is not None else SansTemoin()
    coupure = CoupureGpio(config.coupure_gpio) if config.coupure_gpio is not None else SansCoupure()
    if config.camera == "fausse":
        camera = FausseCamera(temoin, config.repos_s)
    else:
        camera = CameraPicamera2(
            config.numero_camera, config.largeur, config.hauteur, config.qualite, config.rotation, temoin, config.repos_s
        )
    service = ServiceOeil(config.nom, config.jeton, camera, coupure)
    port = service.demarrer(config.hote, config.port)
    print(f"Œil « {config.nom} » ({config.piece}) prêt sur le port {port}.", flush=True)

    fin = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: fin.set())
    signal.signal(signal.SIGINT, lambda *_: fin.set())
    fin.wait()
    service.arreter()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
