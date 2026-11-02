"""Écoute, envoi au PC, lecture, suivi. Le micro est fermé pendant la lecture."""

from __future__ import annotations

import logging
import threading
from collections import deque
from collections.abc import Callable

from .arret import est_arret
from .contrat import SUIVI_PAR_DEFAUT_MS, ClientPc, ClientRobot, ErreurReseau
from .fin_parole import PHRASE_MAX_MS, SEUIL, FinDeParole
from .reveil import taille_trame_reveil
from .wav import TAUX, bip_alerte, bip_erreur, duree_ms, pcm_vers_wav, rms

journal = logging.getLogger("jarvis_robot_voix")

LIBELLES_PC = {
    401: "jeton d'enceinte refusé",
    403: "adresse refusée, réseau local seulement",
    413: "phrase trop longue pour le PC",
    429: "une phrase est déjà en cours sur le PC",
    503: "le PC n'a pas pu écouter",
}

PREROLL_MS = 300
DELAI_ECHO_MS = 300


class SortieAudio:
    def jouer(self, wav: bytes) -> None:
        raise NotImplementedError


class Boucle:
    def __init__(
        self,
        client: ClientPc,
        robot: ClientRobot,
        reveil: Callable[[bytes], bool],
        reconnaitre: Callable[[bytes], str],
        sortie: SortieAudio,
        reinitialiser: Callable[[], None] | None = None,
    ) -> None:
        self.client = client
        self.robot = robot
        self.reveil = reveil
        self.reconnaitre = reconnaitre
        self.sortie = sortie
        self.reinitialiser = reinitialiser
        self.etat = "veille"
        self.suivi = False
        self.suivi_restant_ms = 0.0
        self.suivi_ms = float(SUIVI_PAR_DEFAUT_MS)
        self.bonjour_fait = False
        self.micro_ouvert = True
        self.trames_ignorees = 0
        self.arrets_locaux = 0
        self.erreurs_reseau = 0
        self._annule = threading.Event()
        self._tampon = b""
        self._preroll: deque[bytes] = deque()
        self._preroll_octets = 0
        self._capture = b""
        self._fin: FinDeParole | None = None
        self._taille = taille_trame_reveil()
        self._plafond_preroll = int(TAUX * PREROLL_MS / 1000.0) * 2
        self._reste_echo_ms = 0.0

    def pas(self, trame: bytes) -> None:
        if not trame:
            return
        if self._reste_echo_ms > 0 and self.micro_ouvert:
            duree = duree_ms(trame)
            if duree <= self._reste_echo_ms + 0.01:
                self._reste_echo_ms = max(0.0, self._reste_echo_ms - duree)
                self.trames_ignorees += 1
                return
            self.trames_ignorees += 1
            garder = duree - self._reste_echo_ms
            self._reste_echo_ms = 0.0
            octets = int(TAUX * garder / 1000.0) * 2
            trame = trame[-octets:] if octets >= 2 else b""
            if not trame:
                return
        if not self.micro_ouvert:
            self.trames_ignorees += 1
            return
        if self.etat == "veille":
            self._veille(trame)
        elif self.etat == "suivi":
            self._suivi(trame)
        else:
            self._ecoute(trame)

    def _veille(self, trame: bytes) -> None:
        self._tampon += trame
        while len(self._tampon) >= self._taille:
            morceau = self._tampon[: self._taille]
            self._tampon = self._tampon[self._taille :]
            if self.reveil(morceau):
                self._ouvrir_ecoute(morceau, suivi=False)
                if self._tampon:
                    reste = self._tampon
                    self._tampon = b""
                    self.pas(reste)
                return
            self._memoriser(morceau)

    def _ouvrir_ecoute(self, debut: bytes, suivi: bool) -> None:
        self.etat = "ecoute"
        self.suivi = suivi
        self._fin = FinDeParole()
        preroll = b"".join(self._preroll) if not suivi else b""
        self._capture = preroll + debut
        self._fin.amorcer(self._capture)

    def _ecoute(self, trame: bytes) -> None:
        self._capture += trame
        assert self._fin is not None
        if duree_ms(self._capture) >= PHRASE_MAX_MS or self._fin.pousser(trame):
            self._finir()

    def _finir(self) -> None:
        assert self._fin is not None
        if not self._fin.commande_commencee:
            self._revenir_veille()
            return
        try:
            texte = self.reconnaitre(self._capture)
        except Exception:
            journal.exception("reconnaissance locale indisponible")
            texte = ""
        if est_arret(texte):
            self._stop_local()
            return
        self._envoyer(self._capture, self.suivi)

    def couper(self) -> None:
        """Stop immédiat, depuis n'importe quel fil, sans attendre la fin de phrase."""
        self._annule.set()
        interrompre = getattr(self.sortie, "interrompre", None)
        if interrompre is not None:
            interrompre()
        self._stop_local(revenir=False)

    def _stop_local(self, revenir: bool = True) -> None:
        """Avant tout appel au PC, et sans l'attendre."""
        self.arrets_locaux += 1
        try:
            self.robot.stop()
        except ErreurReseau:
            journal.warning("le service du robot n'a pas pris l'arrêt, après 3 essais")
            self._jouer(bip_alerte())
        if revenir:
            self._revenir_veille()

    def _envoyer(self, pcm: bytes, suivi: bool) -> None:
        if not self.bonjour_fait:
            self._lire_bonjour()
        if self._annule.is_set():
            self._annule.clear()
            self._revenir_veille()
            return
        try:
            reponse = self.client.tour(pcm_vers_wav(pcm), suivi=suivi)
        except ErreurReseau:
            self.erreurs_reseau += 1
            self._jouer(bip_erreur())
            self._revenir_veille()
            return
        if self._annule.is_set():
            self._annule.clear()
            self._revenir_veille()
            return
        if est_arret(reponse.transcription):
            self._stop_local()
            return
        if reponse.statut == 204 or reponse.statut == 200 and not reponse.wav:
            self._revenir_veille()
            return
        if reponse.statut != 200:
            self.erreurs_reseau += 1
            journal.warning(
                "réponse du PC %s : %s",
                reponse.statut,
                LIBELLES_PC.get(reponse.statut, "inattendue"),
            )
            if reponse.statut == 503 and reponse.wav:
                self._jouer(reponse.wav)
            else:
                self._jouer(bip_erreur())
            self._revenir_veille()
            return
        self._jouer(reponse.wav)
        if self.etat == "veille" or self._annule.is_set():
            self._annule.clear()
            self._revenir_veille()
            return
        if reponse.continuer:
            self.etat = "suivi"
            self.suivi = True
            self.suivi_restant_ms = self.suivi_ms
            self._capture = b""
            self._fin = FinDeParole()
            return
        self._revenir_veille()

    def _lire_bonjour(self) -> None:
        try:
            info = self.client.bonjour()
        except ErreurReseau:
            return
        if "followUpMs" in info:
            try:
                self.suivi_ms = float(info["followUpMs"])
            except (TypeError, ValueError):
                pass
        self.bonjour_fait = True

    def _jouer(self, wav: bytes) -> None:
        self.micro_ouvert = False
        try:
            self.sortie.jouer(wav)
        finally:
            self.micro_ouvert = True
            self._reste_echo_ms = float(DELAI_ECHO_MS)
        if self._annule.is_set():
            self._annule.clear()
            self._revenir_veille()

    def _suivi(self, trame: bytes) -> None:
        if rms(trame) >= SEUIL:
            self._ouvrir_ecoute(trame, suivi=True)
            return
        self.suivi_restant_ms -= duree_ms(trame)
        if self.suivi_restant_ms <= 0:
            self._revenir_veille()

    def _revenir_veille(self) -> None:
        self.etat = "veille"
        self.suivi = False
        self._capture = b""
        self._fin = None
        self._tampon = b""
        if self.reinitialiser is not None:
            self.reinitialiser()

    def _memoriser(self, trame: bytes) -> None:
        self._preroll.append(trame)
        self._preroll_octets += len(trame)
        while self._preroll_octets > self._plafond_preroll and self._preroll:
            vieux = self._preroll.popleft()
            self._preroll_octets -= len(vieux)
