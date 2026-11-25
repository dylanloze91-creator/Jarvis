"""Le contrat `reseau` des yeux de Jarvis (cahier `docs/specs/yeux-etape-1.md`, § 2), et rien d'autre :

    GET /api/oeil/hello  → {"nom": …, "version": …}        (jeton Bearer)
    GET /api/oeil/photo  → une image JPEG (5 Mo au plus)    (jeton Bearer)

- seule la méthode GET existe (405 pour le reste) ; aucune redirection ; aucun flux continu ;
- adresse distante privée seulement (réseau local, boucle locale) : sinon 403 ;
- jeton comparé en temps constant ; sans jeton ou faux : 401 ;
- caméra coupée par l'interrupteur : 503 « caméra coupée », rien n'est pris ;
- une prise à la fois : une seconde demande pendant une prise reçoit 429 ;
- rien n'est enregistré : l'image part et n'est gardée nulle part.
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__
from .camera import Camera, CameraErreur, Coupure, SansCoupure

IMAGE_MAX = 5 * 1024 * 1024


def adresse_privee(hote: str) -> bool:
    try:
        adresse = ipaddress.ip_address(hote)
    except ValueError:
        return False
    if isinstance(adresse, ipaddress.IPv6Address) and adresse.ipv4_mapped:
        adresse = adresse.ipv4_mapped
    return adresse.is_private or adresse.is_loopback or adresse.is_link_local


def jeton_ok(entete: str | None, jeton: str) -> bool:
    if not entete or not entete.startswith("Bearer "):
        return False
    return hmac.compare_digest(entete[len("Bearer "):].encode("utf-8"), jeton.encode("utf-8"))


class ServiceOeil:
    def __init__(self, nom: str, jeton: str, camera: Camera, coupure: Coupure | None = None) -> None:
        self.nom = nom
        self.jeton = jeton
        self.camera = camera
        self.coupure = coupure or SansCoupure()
        self._prise = threading.Lock()
        self._serveur: ThreadingHTTPServer | None = None
        self._fil: threading.Thread | None = None

    def demarrer(self, hote: str, port: int) -> int:
        service = self

        class Requetes(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            server_version = "jarvis-oeil"
            sys_version = ""

            def log_message(self, format, *args):  # noqa: A002 - signature imposée
                return

            def _repondre(self, code: int, corps: bytes, type_: str) -> None:
                self.send_response(code)
                self.send_header("Content-Type", type_)
                self.send_header("Content-Length", str(len(corps)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(corps)

            def _json(self, code: int, donnees: dict) -> None:
                self._repondre(code, json.dumps(donnees, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

            def _refuser_methode(self) -> None:
                self.send_response(405)
                self.send_header("Allow", "GET")
                self.send_header("Content-Length", "0")
                self.end_headers()

            do_POST = do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _refuser_methode  # noqa: N815

            def do_GET(self) -> None:  # noqa: N802 - nom imposé
                if not adresse_privee(self.client_address[0]):
                    self._json(403, {"erreur": "Réseau local seulement."})
                    return
                if not jeton_ok(self.headers.get("Authorization"), service.jeton):
                    self._json(401, {"erreur": "Jeton absent ou faux."})
                    return
                chemin = self.path.split("?", 1)[0]
                if chemin == "/api/oeil/hello":
                    self._json(200, {"nom": service.nom, "version": __version__})
                    return
                if chemin != "/api/oeil/photo":
                    self._json(404, {"erreur": "Introuvable."})
                    return
                if service.coupure.coupee():
                    service.camera.fermer()
                    self._json(503, {"erreur": "Caméra coupée."})
                    return
                if not service._prise.acquire(blocking=False):
                    self._json(429, {"erreur": "Une photo est déjà en cours."})
                    return
                try:
                    image = service.camera.photo()
                except CameraErreur as erreur:
                    self._json(503, {"erreur": str(erreur)})
                    return
                finally:
                    service._prise.release()
                if not image.startswith(b"\xff\xd8\xff") or len(image) > IMAGE_MAX:
                    self._json(500, {"erreur": "Image illisible ou trop grande."})
                    return
                self._repondre(200, image, "image/jpeg")

        self._serveur = ThreadingHTTPServer((hote, port), Requetes)
        self._serveur.daemon_threads = True
        self._fil = threading.Thread(target=self._serveur.serve_forever, name="oeil-http", daemon=True)
        self._fil.start()
        return self._serveur.server_address[1]

    def arreter(self) -> None:
        if self._serveur:
            self._serveur.shutdown()
            self._serveur.server_close()
            self._serveur = None
        self.camera.fermer()
