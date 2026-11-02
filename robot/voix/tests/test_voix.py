"""Sans micro, sans PC, sans robot : des WAV générés et deux petits serveurs."""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from jarvis_robot_voix.arret import DetecteurArret, est_arret, grammaire_json
from jarvis_robot_voix.boucle import Boucle
from jarvis_robot_voix.config import charger, version_python_acceptee
from jarvis_robot_voix.contrat import ClientPc, ClientRobot
from jarvis_robot_voix.fin_parole import FinDeParole
from jarvis_robot_voix.service import ServiceVoix
from jarvis_robot_voix.wav import TAUX, bip_alerte, bip_erreur, generer, pcm_vers_wav, silence, wav_vers_pcm

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
        if self.path.startswith("/api/speaker/turn") and getattr(self.server, "bloque", None) is not None:
            self.server.entre.set()
            self.server.bloque.wait(timeout=5)
        if self.path.startswith("/api/stop"):
            self.server.arrets = getattr(self.server, "arrets", 0) + 1
            if self.server.arrets <= getattr(self.server, "stops_en_echec", 0):
                self.send_response(503)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        mode = self.server.modes.pop(0)
        if mode == "503":
            wav = pcm_vers_wav(generer(40, amplitude=50, frequence=660))
            self.send_response(503)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("x-jarvis-continue", "0")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
            return
        if mode == "401":
            self.send_response(401)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if mode == "204":
            self.send_response(204)
            self.send_header("x-jarvis-continue", "0")
            self.end_headers()
            return
        wav = pcm_vers_wav(silence(50))
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("x-jarvis-continue", "1" if mode == "suite" else "0")
        self.send_header("x-jarvis-transcript", getattr(self.server, "transcription", "bonjour"))
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
    def __init__(self, boucle=None, pendant=False, bloquer=False):
        self.joues = []
        self.boucle = boucle
        self.pendant = pendant
        self._couper = threading.Event()
        self.bloquer = bloquer
        self.en_lecture = threading.Event()

    def interrompre(self) -> None:
        self._couper.set()

    def jouer(self, wav: bytes) -> None:
        self._couper.clear()
        self.joues.append(wav)
        self.en_lecture.set()
        if self.pendant and self.boucle is not None:
            self.boucle.pas(generer(80, amplitude=20000))
        if self.bloquer:
            self._couper.wait(timeout=3)


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


def test_point7_503_joue_le_wav_du_pc_et_401_est_nomme(caplog):
    from jarvis_robot_voix.boucle import LIBELLES_PC

    assert "refusé" in LIBELLES_PC[401]
    attendu = pcm_vers_wav(generer(40, amplitude=50, frequence=660))
    pc = servir(["503", "401"])
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1])
        sortie = Sortie()
        boucle = Boucle(client, client_robot, reveil_fort, phrase("bonjour"), sortie)
        with caplog.at_level("WARNING"):
            alimenter(boucle, *scenario_parole())
        assert sortie.joues == [attendu]
        assert "503" in caplog.text and "écouter" in caplog.text
        caplog.clear()
        boucle._reste_echo_ms = 0
        with caplog.at_level("WARNING"):
            alimenter(boucle, *scenario_parole())
        assert "401" in caplog.text and "refusé" in caplog.text
        assert sortie.joues[-1] == bip_erreur()
    finally:
        pc.shutdown()
        robot.shutdown()


def test_point6_echo_doublon_et_reinitialisation():
    vus: list[bytes] = []

    def memoriser(pcm: bytes) -> str:
        vus.append(pcm)
        return "bonjour"

    remises = {"n": 0}
    pc = servir(["fin"])
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1])
        boucle = Boucle(
            client,
            client_robot,
            reveil_fort,
            memoriser,
            Sortie(),
            reinitialiser=lambda: remises.__setitem__("n", remises["n"] + 1),
        )
        alimenter(boucle, *scenario_parole())
        fort = generer(80, amplitude=20000)
        assert vus and vus[0].count(fort) == 1
        assert remises["n"] >= 1
        ignores = boucle.trames_ignorees
        boucle.pas(fort)
        assert boucle.etat == "veille"
        assert boucle.trames_ignorees > ignores
        assert len([e for e in pc.journal if e["chemin"] == "/api/speaker/turn"]) == 1
    finally:
        pc.shutdown()
        robot.shutdown()


def test_point5_python_3_11_a_3_13_seulement():
    assert version_python_acceptee(3, 11) and version_python_acceptee(3, 12) and version_python_acceptee(3, 13)
    assert not version_python_acceptee(3, 10)
    assert not version_python_acceptee(3, 14)
    texte = (RACINE / "requirements.txt").read_text(encoding="utf-8")
    assert "numpy==2.4.6" in texte and "scipy==1.17.1" in texte and "onnxruntime==1.31.1" in texte
    assert "numpy==1.26.4" not in texte
    assert "11<=v[1]<=13" in (RACINE / "installer.sh").read_text(encoding="utf-8")


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
            silence(300),
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


def _marque_stop(pcm: bytes) -> bool:
    if len(pcm) < 2:
        return False
    return int.from_bytes(pcm[:2], "little", signed=True) == 12345


def _trame_stop() -> bytes:
    brut = bytearray(generer(80, amplitude=1000))
    brut[0:2] = (12345).to_bytes(2, "little", signed=True)
    return bytes(brut)


def test_point2_stop_pendant_la_requete_et_pendant_la_lecture():
    bloque = threading.Event()
    service = None
    pc = servir(["fin", "fin"])
    pc.bloque = bloque
    pc.entre = threading.Event()
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1], timeout=3)
        sortie = Sortie()
        boucle = Boucle(client, client_robot, reveil_fort, phrase("bonjour"), sortie)
        service = ServiceVoix(boucle, _marque_stop, lambda: None, lambda: None, silence_s=30)
        service.demarrer_fils()
        for morceau in scenario_parole():
            service.recevoir(morceau)
        assert pc.entre.wait(2), "la requête PC aurait dû rester ouverte"
        avant = time.monotonic()
        service.recevoir(_trame_stop())
        assert time.monotonic() - avant < 0.3
        for _ in range(50):
            if robot.journal:
                break
            time.sleep(0.02)
        assert [e["chemin"] for e in robot.journal] == ["/api/stop"]
        assert not bloque.is_set()
        bloque.set()

        robot.journal.clear()
        pc.entre.clear()
        pc.bloque = None
        sortie.bloquer = True
        for morceau in scenario_parole():
            service.recevoir(morceau)
        assert sortie.en_lecture.wait(2)
        service.recevoir(_trame_stop())
        for _ in range(50):
            if robot.journal:
                break
            time.sleep(0.02)
        assert robot.journal
        assert sortie._couper.is_set()
    finally:
        bloque.set()
        if service is not None:
            service.arreter_fils()
        pc.shutdown()
        robot.shutdown()


def test_point4_trois_essais_alerte_jeton_et_transcription_du_pc(tmp_path):
    from jarvis_robot_voix.__main__ import main

    vide = tmp_path / "config.toml"
    vide.write_text((RACINE / "config.example.toml").read_text(encoding="utf-8"), encoding="utf-8")
    assert main(["--config", str(vide)]) == 2

    robot = servir([])
    robot.stops_en_echec = 2
    pc = servir(["fin"])
    pc.transcription = "stop"
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1])
        assert client_robot.stop() is None
        assert robot.arrets == 3
        robot.journal.clear()
        robot.arrets = 0
        robot.stops_en_echec = 0
        sortie = Sortie()
        boucle = Boucle(client, client_robot, reveil_fort, phrase("bonjour"), sortie)
        alimenter(boucle, *scenario_parole())
        assert [e["chemin"] for e in robot.journal] == ["/api/stop"]
        assert sortie.joues == []
    finally:
        pc.shutdown()
        robot.shutdown()

    ferme = servir([])
    try:
        prise = __import__("socket").socket()
        prise.bind(("127.0.0.1", 0))
        port = prise.getsockname()[1]
        prise.close()
        _config, client, client_robot = config_vers(ferme.server_address[1], port, timeout=0.2)
        sortie = Sortie()
        boucle = Boucle(client, client_robot, reveil_fort, phrase("stop"), sortie)
        alimenter(boucle, *scenario_parole())
        assert sortie.joues == [bip_alerte()]
    finally:
        ferme.shutdown()


def test_point3_stop_immediat_malgre_unk_et_repetition():
    assert est_arret("[unk] stop")
    assert est_arret("stop stop")
    assert est_arret("unk stop stop")
    assert not est_arret("[unk]")
    assert not est_arret("toi")
    vu = {"texte": ""}

    def lire(pcm: bytes) -> str:
        return "[unk] stop" if _marque_stop(pcm) else ""

    detecteur = DetecteurArret(lire)
    assert detecteur.pousser(generer(80, amplitude=1000)) is False
    service = None
    pc = servir([])
    robot = servir([])
    try:
        _config, client, client_robot = config_vers(pc.server_address[1], robot.server_address[1])
        boucle = Boucle(client, client_robot, reveil_fort, phrase("bonjour"), Sortie())
        service = ServiceVoix(boucle, detecteur.pousser, lambda: None, lambda: None, silence_s=30)
        service.demarrer_fils()
        avant = time.monotonic()
        service.recevoir(_trame_stop())
        for _ in range(50):
            if robot.journal:
                break
            time.sleep(0.02)
        assert robot.journal
        assert time.monotonic() - avant < 0.5
        assert pc.journal == []
    finally:
        if service is not None:
            service.arreter_fils()
        pc.shutdown()
        robot.shutdown()


def test_point2_chien_de_garde_quitte_si_le_flux_ne_repart_pas():
    def ouvrir():
        raise RuntimeError("usb débranché")

    service = ServiceVoix(None, lambda _pcm: False, ouvrir, lambda: None, silence_s=0, essais_flux=2)
    service.dernier_son = 0
    assert service.tick_garde() is None
    assert service.tick_garde() == 1


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
