"""La caméra et son témoin.

- `CameraPicamera2` : Camera Module 3 (Wide) sur le Pi 5, par Picamera2 (paquet `python3-picamera2`
  de Raspberry Pi OS). Démarrée à la première photo, arrêtée après `repos_s` sans photo : le capteur
  est libéré et le témoin s'éteint. Une image fixe à la demande, jamais de flux continu.
- `FausseCamera` : pour les essais, sans matériel.
- `TemoinGpio` : une LED sur une broche GPIO (gpiozero), allumée tant que la caméra tourne.
- `Coupure` : un interrupteur sur une broche GPIO ; fermé = caméra coupée, rien n'est pris.
"""

from __future__ import annotations

import base64
import io
import threading
import time
from typing import Callable, Protocol

# Un vrai JPEG de 1 × 1 pixel (les essais vérifient les premiers octets, comme Jarvis).
_JPEG_1PX = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////"
    "////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
)


class CameraErreur(RuntimeError):
    """La prise a échoué : le message est dit tel quel à Jarvis."""


class Temoin(Protocol):
    def allumer(self) -> None: ...
    def eteindre(self) -> None: ...


class SansTemoin:
    def allumer(self) -> None:
        return None

    def eteindre(self) -> None:
        return None


class TemoinGpio:
    def __init__(self, broche: int) -> None:
        from gpiozero import LED  # paquet python3-gpiozero, seulement sur le Pi

        self._led = LED(broche)

    def allumer(self) -> None:
        self._led.on()

    def eteindre(self) -> None:
        self._led.off()


class Coupure(Protocol):
    def coupee(self) -> bool: ...


class SansCoupure:
    def coupee(self) -> bool:
        return False


class CoupureGpio:
    """Interrupteur entre la broche et la masse : fermé = caméra coupée."""

    def __init__(self, broche: int) -> None:
        from gpiozero import Button

        self._bouton = Button(broche, pull_up=True)

    def coupee(self) -> bool:
        return bool(self._bouton.is_pressed)


class Camera(Protocol):
    def photo(self) -> bytes: ...
    def regarde(self) -> bool: ...
    def fermer(self) -> None: ...


class _AvecRepos:
    """Démarre à la demande, s'arrête après `repos_s` sans photo. Une prise à la fois."""

    def __init__(self, temoin: Temoin, repos_s: float, horloge: Callable[[], float] = time.monotonic) -> None:
        self._temoin = temoin
        self._repos_s = repos_s
        self._horloge = horloge
        self._verrou = threading.Lock()
        self._allumee = False
        self._derniere = 0.0
        self._minuteur: threading.Timer | None = None

    def _demarrer(self) -> None:
        raise NotImplementedError

    def _arreter(self) -> None:
        raise NotImplementedError

    def _capturer(self) -> bytes:
        raise NotImplementedError

    def regarde(self) -> bool:
        return self._allumee

    def photo(self) -> bytes:
        with self._verrou:
            if not self._allumee:
                self._temoin.allumer()
                try:
                    self._demarrer()
                except Exception as erreur:
                    self._temoin.eteindre()
                    raise CameraErreur(f"La caméra ne démarre pas ({type(erreur).__name__}).") from erreur
                self._allumee = True
            try:
                image = self._capturer()
            except Exception as erreur:
                self._eteindre_sans_verrou()
                raise CameraErreur(f"La caméra n'a pas donné d'image ({type(erreur).__name__}).") from erreur
            self._derniere = self._horloge()
            self._programmer_repos()
            return image

    def _programmer_repos(self) -> None:
        if self._minuteur:
            self._minuteur.cancel()
        self._minuteur = threading.Timer(self._repos_s, self._repos)
        self._minuteur.daemon = True
        self._minuteur.start()

    def _repos(self) -> None:
        with self._verrou:
            if self._allumee and self._horloge() - self._derniere >= self._repos_s - 0.05:
                self._eteindre_sans_verrou()

    def _eteindre_sans_verrou(self) -> None:
        if self._allumee:
            try:
                self._arreter()
            finally:
                self._allumee = False
        self._temoin.eteindre()

    def fermer(self) -> None:
        if self._minuteur:
            self._minuteur.cancel()
        with self._verrou:
            self._eteindre_sans_verrou()


class CameraPicamera2(_AvecRepos):
    def __init__(self, numero: int, largeur: int, hauteur: int, qualite: int, rotation: int, temoin: Temoin, repos_s: float) -> None:
        super().__init__(temoin, repos_s)
        self._numero = numero
        self._taille = (largeur, hauteur)
        self._qualite = qualite
        self._rotation = rotation
        self._cam = None

    def _demarrer(self) -> None:
        from libcamera import Transform  # paquets de Raspberry Pi OS
        from picamera2 import Picamera2

        cam = Picamera2(self._numero)
        transform = Transform(hflip=1, vflip=1) if self._rotation == 180 else Transform()
        cam.configure(cam.create_still_configuration(main={"size": self._taille}, transform=transform))
        cam.options["quality"] = self._qualite
        cam.start()
        # Laisser l'exposition et la mise au point automatiques (Camera Module 3) se poser.
        time.sleep(0.8)
        self._cam = cam

    def _capturer(self) -> bytes:
        tampon = io.BytesIO()
        self._cam.capture_file(tampon, format="jpeg")  # type: ignore[union-attr]
        return tampon.getvalue()

    def _arreter(self) -> None:
        cam, self._cam = self._cam, None
        if cam is not None:
            cam.stop()
            cam.close()


class FausseCamera(_AvecRepos):
    """Pour les essais : un vrai petit JPEG, et des compteurs."""

    def __init__(self, temoin: Temoin | None = None, repos_s: float = 5.0, image: bytes = _JPEG_1PX) -> None:
        super().__init__(temoin or SansTemoin(), repos_s)
        self.image = image
        self.demarrages = 0
        self.arrets = 0
        self.prises = 0
        self.panne: Exception | None = None

    def _demarrer(self) -> None:
        self.demarrages += 1

    def _capturer(self) -> bytes:
        if self.panne:
            raise self.panne
        self.prises += 1
        return self.image

    def _arreter(self) -> None:
        self.arrets += 1
