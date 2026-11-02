"""python -m jarvis_robot_voix --config config.toml"""

from __future__ import annotations

import argparse
import logging
import signal

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
    if not config.jeton_enceinte or not config.jeton_robot:
        logging.error("jeton_enceinte et jeton_robot doivent être remplis dans %s", arguments.config)
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

    from .service import ServiceVoix
    from .sortie_alsa import SortieAlsa

    sortie = SortieAlsa(config.peripherique)
    boucle = Boucle(client, robot, reveil.declenche, reconnaissance.texte, sortie, reinitialiser=reveil.reinitialiser)
    service = ServiceVoix(boucle, reconnaissance.pousser, ouvrir_flux=lambda: None, fermer_flux=lambda: None)
    peripherique = None if config.peripherique in ("", "default") else config.peripherique
    flux = {"courant": None}

    import sounddevice as sd

    def rappel(entree, _frames, _temps, statut) -> None:
        if statut:
            logging.warning("audio : %s", statut)
        try:
            service.recevoir(entree.tobytes() if hasattr(entree, "tobytes") else bytes(entree))
        except Exception:
            logging.exception("trame audio ignorée")

    def ouvrir() -> None:
        courant = sd.InputStream(
            samplerate=TAUX,
            channels=1,
            dtype="int16",
            blocksize=ECHANTILLONS_PAR_TRAME,
            device=peripherique,
            callback=rappel,
        )
        courant.start()
        flux["courant"] = courant

    def fermer() -> None:
        courant = flux["courant"]
        flux["courant"] = None
        if courant is not None:
            courant.stop()
            courant.close()

    service.ouvrir_flux = ouvrir
    service.fermer_flux = fermer

    def demander_arret(*_args: object) -> None:
        service.arret.set()

    signal.signal(signal.SIGINT, demander_arret)
    signal.signal(signal.SIGTERM, demander_arret)
    logging.info(
        "voix du robot : PC %s:%s, robot %s:%s, périphérique %s",
        config.pc_hote,
        config.pc_port,
        config.robot_hote,
        config.robot_port,
        config.peripherique,
    )
    return service.tourner()


if __name__ == "__main__":
    raise SystemExit(main())
