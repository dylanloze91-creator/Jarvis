"""Sans micro, sans PC, sans robot : des WAV générés et deux petits serveurs."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from jarvis_robot_voix.arret import est_arret, grammaire_json
from jarvis_robot_voix.boucle import Boucle
from jarvis_robot_voix.config import charger
from jarvis_robot_voix.contrat import ClientPc, ClientRobot
from jarvis_robot_voix.fin_parole import FinDeParole
from jarvis_robot_voix.wav import TAUX, bip_erreur, generer, pcm_vers_wav, silence, wav_vers_pcm

RACINE = Path(__file__).resolve().parents[1]
SEUIL_REVEIL = 0.2


class Journal(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        return

    def _corps(self) -> bytes:
        taille = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(taille) if taille else b""

    def _noter(self, corps: bytes) -> None:
        self.server.journal.append(
            {
                "methode": self.command,
                "chemin": self.path.split("?")[0],
                "auth": self.headers.get("Authorization"),
                "type": self.headers.get("Content-Type"),
                "suivi": self.headers.get("X-Jarvis-Follow-Up"),
                "corps": corps,
            }
        )

    def do_GET(self):
        self._noter(b"")
        if self.server.refuser:
            self.send_response(401)
            self.end_headers()
            return
        corps = json.dumps({"name": "Jarvis", "version": "test", "followUpMs": self.server.suivi_ms}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def do_POST(self):
        corps = self._corps()
        self._noter(corps)
        if self.path.startswith("/api/stop"):
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        mode = self.server.modes.pop(0)
        if mode == "204":
            self.send_response(204)
            self.send_header("x-jarvis-continue", "0")
            self.end_headers()
            return
        wav = pcm_vers_wav(silence(50))
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("x-jarvis-continue", "1" if mode == "suite" else "0")
        self.send_header("x-jarvis-transcript", "bonjour")
        self.send_header("Content-Length", str(len(wav)))
        self.end_headers()
        self.wfile.write(wav)


class Serveur(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def servir(modes, suivi_ms=1000, refuser=False):
    serveur = Serveur(("127.0.0.1", 0), Journal)
    serveur.journal = []
    serveur.modes = list(modes)
    serveur.suivi_ms = suivi_ms
    serveur.refuser = refuser
    fil = threading.Thread(target=serveur.serve_forever, daemon=True)
    fil.start()
    return serveur


def config_vers(pc_port, robot_port, timeout=0.4):
    from jarvis_robot_voix.config import Config

    config = Config(
        pc_hote="127.0.0.1",
        pc_port=pc_port,
        jeton_enceinte="jeton-enceinte",
        robot_hote="127.0.0.1",
        robot_port=robot_port,
        jeton_robot="jeton-robot",
        peripherique="default",
        sensibilite=0.5,
        modele_vosk="modeles/absent",
    )
    return config, ClientPc(config, timeout_connexion=timeout, timeout_lecture=timeout), ClientRobot(config, timeout=timeout)


class Sortie:
    def __init__(self, boucle=None, pendant=False):
        self.joues = []
        self.boucle = boucle
        self.pendant = pendant

    def jouer(self, wav: bytes) -> None:
        self.joues.append(wav)
        if self.pendant and self.boucle is not None:
            self.boucle.pas(generer(80, amplitude=20000))


def reveil_fort(pcm: bytes) -> bool:
    from jarvis_robot_voix.wav import rms

    return rms(pcm) >= SEUIL_REVEIL


def phrase(texte):
    return lambda _pcm: texte


def alimenter(boucle: Boucle, *morceaux: bytes) -> None:
    for morceau in morceaux:
        boucle.pas(morceau)


def scenario_parole():
    return (
        silence(160),
        generer(80, amplitude=20000),
        generer(400, amplitude=4000, frequence=220),
        silence(720),
    )


def test_exemple_sans_secret():
    config = charger(RACINE / "config.example.toml")
    assert config.jeton_enceinte == ""
    assert config.jeton_robot == ""
    assert config.pc_port == 53131
    assert config.robot_hote == "127.0.0.1"
    assert config.seuil_reveil == pytest.approx(0.6)


def test_wav_contrat_et_phrases_d_arret():
    pcm = generer(40, amplitude=1000)
    taux_relu = wav_vers_pcm(pcm_vers_wav(pcm))
    assert taux_relu[1] == TAUX
    assert taux_relu[0] == pcm
    assert est_arret("Stop")
    assert est_arret("arrête-toi")
    assert est_arret("arrête toi")
    assert est_arret("stop robot")
    assert not est_arret("avance de 50 cm")
    assert not est_arret("stoppe")
    assert not est_arret("[unk]")
    mots = json.loads(grammaire_json())
    assert "[unk]" in mots and "stop" in mots


def test_point1_entetes_minuscules_comme_le_pont():
    """Le vrai pont (cursor/enceinte-5064) envoie x-jarvis-continue en minuscules."""
    pc = servir(["suite"])
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1])
        sortie = Sortie()
        boucle = Boucle(client, client_robot, reveil_fort, phrase("bonjour"), sortie)
        alimenter(boucle, *scenario_parole())
        assert boucle.etat == "suivi"
        assert boucle.suivi_ms == 1000
        assert len(sortie.joues) == 1
    finally:
        pc.shutdown()
        robot.shutdown()


def test_fin_de_parole_650_ms():
    fin = FinDeParole()
    assert fin.pousser(silence(1400)) is False
    assert fin.pousser(generer(200, amplitude=4000)) is False
    assert fin.commande_commencee
    assert fin.pousser(silence(700)) is True


def test_reveil_envoi_lecture():
    pc = servir(["fin"])
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1])
        sortie = Sortie()
        boucle = Boucle(client, client_robot, reveil_fort, phrase("quelle heure"), sortie)
        sortie.boucle = boucle
        alimenter(boucle, *scenario_parole())
        assert boucle.etat == "veille"
        posts = [e for e in pc.journal if e["chemin"] == "/api/speaker/turn"]
        assert len(posts) == 1
        assert posts[0]["auth"] == "Bearer jeton-enceinte"
        assert posts[0]["type"] == "audio/wav"
        assert posts[0]["suivi"] is None
        pcm, taux = wav_vers_pcm(posts[0]["corps"])
        assert taux == TAUX and pcm
        assert len(sortie.joues) == 1
        assert robot.journal == []
        assert any(e["chemin"] == "/api/speaker/hello" for e in pc.journal)
    finally:
        pc.shutdown()
        robot.shutdown()


def test_204_ne_joue_rien():
    pc = servir(["204"])
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1])
        sortie = Sortie()
        boucle = Boucle(client, client_robot, reveil_fort, phrase("bonjour"), sortie)
        alimenter(boucle, *scenario_parole())
        assert sortie.joues == []
        assert boucle.etat == "veille"
    finally:
        pc.shutdown()
        robot.shutdown()


def test_suivi_sans_mot_de_reveil():
    pc = servir(["suite", "fin"], suivi_ms=1000)
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1])
        sortie = Sortie()
        boucle = Boucle(client, client_robot, reveil_fort, phrase("et demain"), sortie)
        alimenter(boucle, *scenario_parole())
        assert boucle.etat == "suivi"
        assert boucle.suivi_ms == 1000
        alimenter(
            boucle,
            silence(80),
            generer(320, amplitude=4000, frequence=330),
            silence(720),
        )
        posts = [e for e in pc.journal if e["chemin"] == "/api/speaker/turn"]
        assert len(posts) == 2
        assert posts[1]["suivi"] == "1"
        assert boucle.etat == "veille"
    finally:
        pc.shutdown()
        robot.shutdown()


def test_stop_local_avant_le_pc():
    pc = servir(["fin"])
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1])
        sortie = Sortie()
        boucle = Boucle(client, client_robot, reveil_fort, phrase("arrête-toi"), sortie)
        alimenter(boucle, *scenario_parole())
        assert pc.journal == []
        assert [e["chemin"] for e in robot.journal] == ["/api/stop"]
        assert robot.journal[0]["auth"] == "Bearer jeton-robot"
        assert sortie.joues == []
        assert boucle.arrets_locaux == 1
        assert boucle.etat == "veille"
    finally:
        pc.shutdown()
        robot.shutdown()


def test_pc_injoignable_joue_une_erreur_sans_bloquer():
    import socket

    prise = socket.socket()
    prise.bind(("127.0.0.1", 0))
    port_ferme = prise.getsockname()[1]
    prise.close()
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(port_ferme, robot.server_address[1], timeout=0.3)
        # Le port 9 n'est pas à nous : refus de connexion, ou délai court.
        sortie = Sortie()
        boucle = Boucle(client, client_robot, reveil_fort, phrase("bonjour"), sortie)
        alimenter(boucle, *scenario_parole())
        assert boucle.erreurs_reseau == 1
        assert boucle.etat == "veille"
        assert sortie.joues == [bip_erreur()]
        assert robot.journal == []
    finally:
        robot.shutdown()


def test_micro_coupe_pendant_la_lecture():
    pc = servir(["fin"])
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1])
        sortie = Sortie(pendant=True)
        boucle = Boucle(client, client_robot, reveil_fort, phrase("bonjour"), sortie)
        sortie.boucle = boucle
        alimenter(boucle, *scenario_parole())
        assert boucle.trames_ignorees >= 1
        assert len([e for e in pc.journal if e["chemin"] == "/api/speaker/turn"]) == 1
    finally:
        pc.shutdown()
        robot.shutdown()
