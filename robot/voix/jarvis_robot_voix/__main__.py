"""python -m jarvis_robot_voix --config config.toml"""

from __future__ import annotations

import argparse
import logging
import signal
import threading

from .arret import ReconnaissanceVosk
from .boucle import Boucle
from .config import charger
from .contrat import ClientPc, ClientRobot
from .reveil import ECHANTILLONS_PAR_TRAME, ReveilOpenWakeWord
from .wav import TAUX


def main(argv: list[str] | None = None) -> int:
    analyseur = argparse.ArgumentParser(prog="jarvis_robot_voix", description="Enceinte vocale du robot Jarvis")
    analyseur.add_argument("--config", default="config.toml")
    arguments = analyseur.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = charger(arguments.config)
    if not config.jeton_enceinte:
        logging.error("jeton_enceinte est vide dans %s", arguments.config)
        return 2

    client = ClientPc(config)
    robot = ClientRobot(config)
    reveil = ReveilOpenWakeWord(config.seuil_reveil)
    reconnaissance = ReconnaissanceVosk(config.modele_vosk)
    if not reconnaissance.disponible():
        logging.warning(
            "modèle Vosk absent (%s) : « stop » local ne sera pas reconnu tant qu'installer.sh n'a pas fini",
            config.modele_vosk,
        )

    from .sortie_alsa import SortieAlsa

    boucle = Boucle(
        client,
        robot,
        reveil.declenche,
        reconnaissance.texte,
        SortieAlsa(config.peripherique),
    )
    arret = threading.Event()

    def demander_arret(*_args: object) -> None:
        arret.set()

    signal.signal(signal.SIGINT, demander_arret)
    signal.signal(signal.SIGTERM, demander_arret)

    import sounddevice as sd

    peripherique = None if config.peripherique in ("", "default") else config.peripherique

    def rappel(entree, _frames, _temps, statut) -> None:
        if statut:
            logging.warning("audio : %s", statut)
        boucle.pas(entree.tobytes() if hasattr(entree, "tobytes") else bytes(entree))

    logging.info(
        "voix du robot : PC %s:%s, robot %s:%s, périphérique %s",
        config.pc_hote,
        config.pc_port,
        config.robot_hote,
        config.robot_port,
        config.peripherique,
    )
    with sd.InputStream(
        samplerate=TAUX,
        channels=1,
        dtype="int16",
        blocksize=ECHANTILLONS_PAR_TRAME,
        device=peripherique,
        callback=rappel,
    ):
        while not arret.wait(0.5):
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
