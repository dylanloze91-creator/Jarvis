"""Le rappel audio ne fait qu'enfiler des trames.

Un fil traite la discussion (réveil, PC, lecture). Un autre, toujours
actif, écoute « stop », y compris pendant une requête ou la lecture.
Un chien de garde relance le flux ; s'il ne repart pas, le processus
sort avec un code non nul pour que systemd le redémarre.
"""

from __future__ import annotations

import logging
import os
import queue
import socket
import threading
import time
from collections.abc import Callable

journal = logging.getLogger("jarvis_robot_voix")

TAILLE_FILE = 48


def notifier_systemd(message: str) -> None:
    adresse = os.environ.get("NOTIFY_SOCKET")
    if not adresse:
        return
    if adresse.startswith("@"):
        adresse = "\0" + adresse[1:]
    prise = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    try:
        prise.sendto(message.encode(), adresse)
    except OSError:
        journal.debug("notification systemd impossible")
    finally:
        prise.close()


class ServiceVoix:
    def __init__(
        self,
        boucle,
        detecteur_stop: Callable[[bytes], bool],
        ouvrir_flux: Callable[[], None],
        fermer_flux: Callable[[], None],
        silence_s: float = 3.0,
        essais_flux: int = 2,
        notifier: Callable[[str], None] = notifier_systemd,
    ) -> None:
        self.boucle = boucle
        self.detecteur_stop = detecteur_stop
        self.ouvrir_flux = ouvrir_flux
        self.fermer_flux = fermer_flux
        self.silence_s = silence_s
        self.essais_flux = essais_flux
        self.notifier = notifier
        self.file_travail: queue.Queue[bytes] = queue.Queue(maxsize=TAILLE_FILE)
        self.file_stop: queue.Queue[bytes] = queue.Queue(maxsize=TAILLE_FILE)
        self.arret = threading.Event()
        self.dernier_son = time.monotonic()
        self.echecs_flux = 0
        self.ouvertures = 0
        self._fils: list[threading.Thread] = []

    def recevoir(self, pcm: bytes) -> None:
        """Rappel du micro : aucune reconnaissance, aucune requête, aucune lecture."""
        if not pcm:
            return
        self.dernier_son = time.monotonic()
        self._mettre(self.file_travail, pcm)
        self._mettre(self.file_stop, pcm)

    def demarrer_fils(self) -> None:
        self._fils = [
            threading.Thread(target=self._travail, name="voix-travail", daemon=True),
            threading.Thread(target=self._stop, name="voix-stop", daemon=True),
        ]
        for fil in self._fils:
            fil.start()

    def tourner(self) -> int:
        """Ouvre le flux et surveille. 0 = arrêt demandé, 1 = flux mort."""
        self.demarrer_fils()
        try:
            self._relancer()
        except Exception:
            journal.exception("le micro ne s'ouvre pas")
            self.arreter_fils()
            return 1
        self.notifier("READY=1")
        while not self.arret.is_set():
            self.notifier("WATCHDOG=1")
            if self.tick_garde() == 1:
                self.arreter_fils()
                return 1
            self.arret.wait(0.5)
        self.arreter_fils()
        return 0

    def arreter_fils(self) -> None:
        self.arret.set()
        for fil in self._fils:
            fil.join(timeout=1.5)

    def tick_garde(self) -> int | None:
        if time.monotonic() - self.dernier_son < self.silence_s:
            return None
        journal.warning("plus de son : relance du micro")
        try:
            self._relancer()
        except Exception:
            self.echecs_flux += 1
            journal.exception("relance du micro impossible (%s)", self.echecs_flux)
            if self.echecs_flux >= self.essais_flux:
                return 1
            return None
        self.dernier_son = time.monotonic()
        self.echecs_flux = 0
        return None

    def _relancer(self) -> None:
        self.fermer_flux()
        self.ouvrir_flux()
        self.ouvertures += 1

    def _travail(self) -> None:
        while not self.arret.is_set():
            try:
                trame = self.file_travail.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                self.boucle.pas(trame)
            except Exception:
                journal.exception("un tour de voix a échoué, l'écoute continue")

    def _stop(self) -> None:
        while not self.arret.is_set():
            try:
                trame = self.file_stop.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                if self.detecteur_stop(trame):
                    self.boucle.couper()
            except Exception:
                journal.exception("l'écoute du stop a échoué, elle continue")

    @staticmethod
    def _mettre(file: queue.Queue[bytes], pcm: bytes) -> None:
        try:
            file.put_nowait(pcm)
        except queue.Full:
            try:
                file.get_nowait()
            except queue.Empty:
                pass
            try:
                file.put_nowait(pcm)
            except queue.Full:
                pass
