"""Sans Pi ni caméra : une fausse caméra et un vrai port local."""

from __future__ import annotations

import http.client
import json
import threading
import time
from pathlib import Path

import pytest

from jarvis_oeil import __version__
from jarvis_oeil.camera import CameraErreur, FausseCamera, SansTemoin
from jarvis_oeil.config import ConfigErreur, charger, piece_interdite
from jarvis_oeil.service import IMAGE_MAX, ServiceOeil, adresse_privee, jeton_ok

JETON = "j" * 40
RACINE = Path(__file__).resolve().parents[1]


class TemoinCompte(SansTemoin):
    def __init__(self) -> None:
        self.allume = False
        self.allumages = 0

    def allumer(self) -> None:
        self.allume = True
        self.allumages += 1

    def eteindre(self) -> None:
        self.allume = False


class Interrupteur:
    def __init__(self) -> None:
        self.ferme = False

    def coupee(self) -> bool:
        return self.ferme


@pytest.fixture
def oeil():
    temoin = TemoinCompte()
    camera = FausseCamera(temoin, repos_s=0.3)
    interrupteur = Interrupteur()
    service = ServiceOeil("Rover avant", JETON, camera, interrupteur)
    port = service.demarrer("127.0.0.1", 0)
    yield service, port, camera, temoin, interrupteur
    service.arreter()


def appel(port: int, chemin: str, methode: str = "GET", jeton: str | None = JETON):
    connexion = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    entetes = {"Authorization": f"Bearer {jeton}"} if jeton else {}
    connexion.request(methode, chemin, headers=entetes)
    reponse = connexion.getresponse()
    corps = reponse.read()
    connexion.close()
    return reponse.status, dict(reponse.getheaders()), corps


def test_hello_et_photo_avec_le_jeton(oeil):
    _, port, camera, temoin, _ = oeil
    statut, _, corps = appel(port, "/api/oeil/hello")
    assert statut == 200
    assert json.loads(corps) == {"nom": "Rover avant", "version": __version__}
    statut, entetes, image = appel(port, "/api/oeil/photo")
    assert statut == 200
    assert entetes["Content-Type"] == "image/jpeg"
    assert entetes["Cache-Control"] == "no-store"
    assert image.startswith(b"\xff\xd8\xff")
    assert camera.prises == 1
    assert temoin.allume is True


def test_sans_jeton_ou_faux_jeton_rien(oeil):
    _, port, camera, _, _ = oeil
    assert appel(port, "/api/oeil/hello", jeton=None)[0] == 401
    assert appel(port, "/api/oeil/photo", jeton=None)[0] == 401
    assert appel(port, "/api/oeil/photo", jeton="x" * 40)[0] == 401
    assert camera.prises == 0


def test_seulement_get_et_seulement_deux_adresses(oeil):
    _, port, camera, _, _ = oeil
    for methode in ("POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"):
        statut, entetes, _ = appel(port, "/api/oeil/photo", methode=methode)
        assert statut == 405, methode
        assert entetes.get("Allow") == "GET"
    assert appel(port, "/api/oeil/flux")[0] == 404
    assert appel(port, "/api/oeil/photo/../hello")[0] == 404
    assert camera.prises == 0


def test_la_camera_s_eteint_seule_apres_le_repos(oeil):
    _, port, camera, temoin, _ = oeil
    appel(port, "/api/oeil/photo")
    appel(port, "/api/oeil/photo")
    assert camera.demarrages == 1
    time.sleep(0.6)
    assert camera.arrets == 1
    assert temoin.allume is False
    appel(port, "/api/oeil/photo")
    assert camera.demarrages == 2


def test_interrupteur_ferme_rien_n_est_pris(oeil):
    _, port, camera, temoin, interrupteur = oeil
    appel(port, "/api/oeil/photo")
    interrupteur.ferme = True
    statut, _, corps = appel(port, "/api/oeil/photo")
    assert statut == 503
    assert json.loads(corps)["erreur"] == "Caméra coupée."
    assert camera.prises == 1
    assert temoin.allume is False


def test_panne_de_camera_dite_temoin_eteint(oeil):
    _, port, camera, temoin, _ = oeil
    camera.panne = OSError("capteur")
    statut, _, corps = appel(port, "/api/oeil/photo")
    assert statut == 503
    assert "OSError" in json.loads(corps)["erreur"]
    assert temoin.allume is False


def test_une_prise_a_la_fois(oeil):
    service, port, camera, _, _ = oeil
    lente = threading.Event()
    origine = camera._capturer

    def capturer_lentement():
        lente.wait(2)
        return origine()

    camera._capturer = capturer_lentement  # type: ignore[method-assign]
    resultats = []
    fil = threading.Thread(target=lambda: resultats.append(appel(port, "/api/oeil/photo")[0]))
    fil.start()
    time.sleep(0.2)
    assert appel(port, "/api/oeil/photo")[0] == 429
    lente.set()
    fil.join()
    assert resultats == [200]


def test_image_illisible_ou_trop_grande_refusee(oeil):
    _, port, camera, _, _ = oeil
    camera.image = b"<html>"
    assert appel(port, "/api/oeil/photo")[0] == 500
    camera.image = b"\xff\xd8\xff" + b"0" * IMAGE_MAX
    assert appel(port, "/api/oeil/photo")[0] == 500


def test_adresses_et_jetons():
    assert adresse_privee("192.168.1.20")
    assert adresse_privee("10.0.0.3")
    assert adresse_privee("127.0.0.1")
    assert adresse_privee("::ffff:192.168.1.20")
    assert not adresse_privee("8.8.8.8")
    assert not adresse_privee("::ffff:8.8.8.8")
    assert not adresse_privee("pas une ip")
    assert jeton_ok(f"Bearer {JETON}", JETON)
    assert not jeton_ok(JETON, JETON)
    assert not jeton_ok(None, JETON)


def ecrire(tmp_path: Path, contenu: str) -> Path:
    chemin = tmp_path / "config.toml"
    chemin.write_text(contenu, encoding="utf-8")
    return chemin


def test_config_exemple_lue_et_refus(tmp_path):
    exemple = (RACINE / "config.example.toml").read_text(encoding="utf-8")
    with pytest.raises(ConfigErreur, match="Jeton"):
        charger(ecrire(tmp_path, exemple))
    config = charger(ecrire(tmp_path, exemple.replace('jeton = ""', f'jeton = "{JETON}"')))
    assert (config.nom, config.port, config.camera, config.largeur, config.temoin_gpio) == ("Rover avant", 8770, "picamera2", 1920, None)
    base = f'nom = "Hub"\npiece = "bureau"\njeton = "{JETON}"\n'
    for ajout, motif in [
        ('piece = "Chambre d\'amis"\n', "chambre"),
        ('camera = "usb"\n', "inconnue"),
        ("rotation = 90\n", "rotation"),
        ('hote = "8.8.8.8"\n', "réseau local"),
        ("temoin_gpio = 40\n", "GPIO"),
        ("qualite = 100\n", "Qualité"),
    ]:
        contenu = base.replace('piece = "bureau"\n', "") + ajout if ajout.startswith("piece") else base + ajout
        with pytest.raises(ConfigErreur, match=motif):
            charger(ecrire(tmp_path, contenu))


def test_jamais_de_chambre():
    for piece in ("chambre", "Chambre d’amis", "ma chambre", "CHAMBRES"):
        assert piece_interdite(piece), piece
    for piece in ("bureau", "salon", "antichambre", "mobile"):
        assert not piece_interdite(piece), piece


def test_fausse_camera_panne_leve_une_erreur_claire():
    camera = FausseCamera(repos_s=0.1)
    camera.panne = RuntimeError("x")
    with pytest.raises(CameraErreur, match="RuntimeError"):
        camera.photo()
    camera.fermer()
