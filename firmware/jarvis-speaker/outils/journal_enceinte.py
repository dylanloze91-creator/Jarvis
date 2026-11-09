"""
Lit le journal de l'enceinte Jarvis par le câble USB, l'enregistre dans un fichier et dit, en clair,
ce qui marche et ce qui coince.

    python outils/journal_enceinte.py COM5            # 120 s d'écoute, la carte redémarre au début
    python outils/journal_enceinte.py COM5 300        # 5 minutes
    python outils/journal_enceinte.py COM5 120 --sans-reset

Pendant qu'il tourne, tu peux dire « Jarvis, quelle heure est-il ? » : il note le réveil, l'envoi et
la réponse. Le journal complet est écrit dans `journal-enceinte.txt` (dossier courant).

Il faut `pyserial` (installé avec PlatformIO ; sinon `python -m pip install pyserial`).
Le port COM ne doit pas être ouvert ailleurs (fermer le « Serial Monitor » de PlatformIO avant).
"""
import re
import sys
import time

try:
    import serial  # pyserial
except ImportError:
    print("Il manque pyserial : python -m pip install pyserial")
    sys.exit(2)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# (clé, motif cherché dans le journal, ce que ça veut dire, quoi faire s'il manque)
ETAPES = [
    ("audio", r"audio prêt", "micro et ampli démarrés",
     "La carte n'arrive pas jusqu'à l'audio : regarde les lignes en erreur juste au-dessus."),
    ("bruit", r"micro : bruit de fond (\d+)", "micro mesuré",
     "Le micro n'a pas été mesuré : programme pas à jour ? (relancer le téléversement)"),
    ("modele", r"mot de réveil : ", "modèle « Jarvis » chargé",
     "Le modèle du mot « Jarvis » manque : relancer le téléversement et vérifier la ligne flash_models.py."),
    ("wifi", r"Wi-Fi connecté, adresse ([\d.]+)", "Wi-Fi connecté",
     "Pas de Wi-Fi : nom ou mot de passe faux dans secrets.h, ou box en 5 GHz seulement."),
    ("pc", r"PC trouvé : Jarvis ([\w.\-]+)", "PC Jarvis trouvé",
     "Le PC ne répond pas : Jarvis ouvert ? Réglages → Services → Enceintes activé ? Pare-feu Windows "
     "(Jarvis coché en « Privé ») ? JARVIS_HOST = l'adresse affichée dans Jarvis ?"),
    ("pret", r"prêt : dis « Jarvis »", "prête à écouter", "La carte n'a pas fini de démarrer."),
]
TOUR = [
    ("reveil", r"« Jarvis » entendu", "« Jarvis » entendu"),
    ("envoi", r"envoi de ([\d.]+) s", "phrase envoyée au PC"),
    ("reponse", r"réponse jouée", "réponse jouée dans le haut-parleur"),
]
ALERTES = [
    (r"micro muet", "Le micro ne renvoie rien : VDD sur 3V3, L/R sur GND, fils 4/5/6, soudures."),
    (r"pièce bruyante", "Bruit de fond trop proche du seuil : appliquer la valeur SPEECH_RMS proposée."),
    (r"jeton refusé|refuse le jeton", "Jeton refusé : retirer puis rajouter l'enceinte dans Jarvis, recopier le bloc."),
    (r"réponse 403", "Le PC refuse : carte et PC doivent être sur le même Wi-Fi (pas le Wi-Fi invités)."),
    (r"\(503\)", "Whisper pas prêt sur le PC : Réglages → Voix, attendre après le démarrage de Jarvis."),
    (r"aucun modèle dans la partition", "Modèle « Jarvis » absent : relancer le téléversement complet."),
    (r"PSRAM absente", "PSRAM introuvable : carte N8 ou N8R2 ? (il faut N8R8 ou N16R8)."),
    (r"Wi-Fi perdu", "Le Wi-Fi n'accroche pas (une fois au démarrage, c'est normal ; en boucle, non)."),
    (r"PC injoignable", "Le PC ne répond pas (voir l'étape « PC Jarvis trouvé »)."),
    (r"rien dit après", "Rien entendu après « Jarvis » : parler plus près, ou MIC_SHIFT 12."),
    (r"Guru Meditation|abort\(\)|Backtrace", "La carte a planté : envoyer ce journal à Claude."),
]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(2)
    port = args[0]
    duree = int(args[1]) if len(args) > 1 else 120
    reset = "--sans-reset" not in sys.argv

    ser = serial.Serial()
    ser.port = port
    ser.baudrate = 115200
    ser.timeout = 0.5
    ser.dtr = False  # BOOT relâché
    ser.rts = False
    try:
        ser.open()
    except serial.SerialException as err:
        print(f"Impossible d'ouvrir {port} : {err}")
        print("Le port est peut-être pris par le Serial Monitor : ferme-le, ou vérifie le numéro (pio device list).")
        sys.exit(1)

    if reset:
        ser.rts = True  # EN à 0 : la carte s'arrête
        time.sleep(0.15)
        ser.rts = False  # elle redémarre normalement
        print(f"Carte redémarrée. Écoute du journal pendant {duree} s…\n")
    else:
        print(f"Écoute du journal pendant {duree} s…\n")

    vus, valeurs, alertes_vues = set(), {}, []
    tampon = b""
    fin = time.time() + duree
    with open("journal-enceinte.txt", "w", encoding="utf-8") as sortie:
        while time.time() < fin:
            tampon += ser.read(4096)
            while b"\n" in tampon:
                brut, tampon = tampon.split(b"\n", 1)
                ligne = brut.decode("utf-8", errors="replace").rstrip("\r")
                sortie.write(ligne + "\n")
                print(ligne)
                for cle, motif, *_ in ETAPES + TOUR:
                    m = re.search(motif, ligne)
                    if m:
                        if cle not in vus:
                            vus.add(cle)
                        if m.groups():
                            valeurs[cle] = m.group(1)
                for motif, conseil in ALERTES:
                    if re.search(motif, ligne) and conseil not in alertes_vues:
                        alertes_vues.append(conseil)
    ser.close()

    print("\n================ BILAN ================")
    for cle, _motif, sens, conseil in ETAPES:
        if cle in vus:
            extra = f" ({valeurs[cle]})" if cle in valeurs else ""
            print(f"  OK   {sens}{extra}")
        else:
            print(f"  NON  {sens} → {conseil}")
    for cle, _motif, sens in TOUR:
        extra = f" ({valeurs[cle]} s)" if cle == "envoi" and cle in valeurs else ""
        print(f"  {'OK ' if cle in vus else '-- '}  {sens}{extra}")
    if "bruit" in valeurs:
        bruit = int(valeurs["bruit"])
        avis = "parfait" if bruit < 150 else ("correct" if bruit < 275 else "trop proche du seuil 393")
        print(f"\n  Bruit de fond du micro : {bruit} → {avis}")
    if alertes_vues:
        print("\n  À regarder :")
        for conseil in alertes_vues:
            print(f"   - {conseil}")
    if "reponse" in vus:
        print("\n  La liaison marche de bout en bout.")
    elif "pret" in vus:
        print("\n  La carte est prête. Dis « Jarvis, quelle heure est-il ? » pendant que ce programme écoute.")
    print("\n  Journal complet : journal-enceinte.txt")


if __name__ == "__main__":
    main()
