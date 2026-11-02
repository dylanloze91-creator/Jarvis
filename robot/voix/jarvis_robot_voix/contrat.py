"""Client du contrat enceinte (Phase 1, « Serveur ») et arrêt local du robot.

POST /api/speaker/turn : WAV 16 kHz mono 16 bits, jeton Bearer.
X-Jarvis-Follow-Up: 1 seulement pour une phrase dite sans « Jarvis »
pendant la fenêtre de suivi. La réponse 200 est un WAV, avec
X-Jarvis-Continue et X-Jarvis-Transcript. 204 : rien à dire.
"""

from __future__ import annotations

import json
import time
import urllib.parse
from dataclasses import dataclass
from http.client import HTTPConnection, HTTPException

from .config import Config

CHEMIN_TOUR = "/api/speaker/turn"
CHEMIN_BONJOUR = "/api/speaker/hello"
CHEMIN_STOP = "/api/stop"
SUIVI_PAR_DEFAUT_MS = 8_000


class ErreurReseau(Exception):
    pass


@dataclass(frozen=True)
class ReponseTour:
    statut: int
    wav: bytes
    continuer: bool
    transcription: str


def _connexion(hote: str, port: int, timeout: float) -> HTTPConnection:
    return HTTPConnection(hote, port, timeout=timeout)


class ClientPc:
    def __init__(self, config: Config, timeout_connexion: float = 3.0, timeout_lecture: float = 90.0) -> None:
        self.config = config
        self.timeout_connexion = timeout_connexion
        self.timeout_lecture = timeout_lecture

    def bonjour(self) -> dict:
        statut, corps, _continuer, _transcription = self._demander(
            "GET", CHEMIN_BONJOUR, None, {}, self.timeout_connexion, self.config.jeton_enceinte, self.config.pc_hote, self.config.pc_port
        )
        if statut != 200:
            raise ErreurReseau(f"bonjour HTTP {statut}")
        try:
            donnees = json.loads(corps.decode("utf-8"))
        except json.JSONDecodeError as erreur:
            raise ErreurReseau("bonjour illisible") from erreur
        if not isinstance(donnees, dict):
            raise ErreurReseau("bonjour illisible")
        return donnees

    def tour(self, wav: bytes, suivi: bool) -> ReponseTour:
        entetes = {"Content-Type": "audio/wav"}
        if suivi:
            entetes["x-jarvis-follow-up"] = "1"
        statut, corps, continuer, transcription = self._demander(
            "POST",
            CHEMIN_TOUR,
            wav,
            entetes,
            self.timeout_lecture,
            self.config.jeton_enceinte,
            self.config.pc_hote,
            self.config.pc_port,
        )
        wav = corps if statut == 200 or (statut == 503 and corps.startswith(b"RIFF")) else b""
        return ReponseTour(statut, wav, continuer, transcription)

    def _demander(self, methode, chemin, corps, entetes, timeout, jeton, hote, port):
        tous = {"Authorization": f"Bearer {jeton}", **entetes}
        connexion = _connexion(hote, port, self.timeout_connexion)
        try:
            connexion.request(methode, chemin, body=corps, headers=tous)
            if connexion.sock is not None:
                connexion.sock.settimeout(timeout)
            reponse = connexion.getresponse()
            # getheader ignore la casse : le vrai pont envoie des minuscules.
            continuer = (reponse.getheader("x-jarvis-continue") or "0") == "1"
            transcription = urllib.parse.unquote(reponse.getheader("x-jarvis-transcript") or "")
            lu = reponse.read()
            return reponse.status, lu, continuer, transcription
        except (OSError, TimeoutError, HTTPException) as erreur:
            raise ErreurReseau(str(erreur)) from erreur
        finally:
            connexion.close()


class ClientRobot:
    """POST /api/stop sur le service de pilotage, en local."""

    def __init__(self, config: Config, timeout: float = 2.0) -> None:
        self.config = config
        self.timeout = timeout

    def stop(self, essais: int = 3, pause: float = 0.05) -> None:
        dernier: Exception | None = None
        for numero in range(essais):
            try:
                self._une_fois()
                return
            except ErreurReseau as erreur:
                dernier = erreur
                if numero + 1 < essais:
                    time.sleep(pause)
        if dernier is not None:
            raise dernier

    def _une_fois(self) -> None:
        connexion = _connexion(self.config.robot_hote, self.config.robot_port, self.timeout)
        entetes = {
            "Authorization": f"Bearer {self.config.jeton_robot}",
            "Content-Type": "application/json",
        }
        try:
            connexion.request("POST", CHEMIN_STOP, body=b"{}", headers=entetes)
            reponse = connexion.getresponse()
            reponse.read()
            if reponse.status >= 400:
                raise ErreurReseau(f"stop HTTP {reponse.status}")
        except (OSError, TimeoutError, HTTPException) as erreur:
            raise ErreurReseau(str(erreur)) from erreur
        finally:
            connexion.close()
