# L’œil de Jarvis (Raspberry Pi 5 + Camera Module 3 Wide)

Un petit programme qui donne un œil à Jarvis : le **rover** (caméra avant, et plus tard celle de la pince) et le **hub** utilisent le même programme, seul le fichier de réglages change.

Jarvis lui demande une photo quand tu le veux (« montre-moi la caméra du rover avant », écran « Yeux »). L’œil **ne filme pas en continu** et **n’enregistre rien** : il prend une image, l’envoie au PC, et l’oublie. Il ne sait rien faire d’autre.

## Ce qu’il fait, et ce qu’il refuse

- deux adresses seulement, toutes deux avec le jeton :
  - `GET /api/oeil/hello` : son nom et sa version ;
  - `GET /api/oeil/photo` : une photo JPEG (5 Mo au plus) ;
- tout le reste est refusé : une autre méthode que GET (405), une autre adresse (404), pas de jeton ou un faux (401), un appareil qui n’est pas sur le réseau de la maison (403) ;
- une photo à la fois (429 si une autre est en cours) ;
- la caméra s’allume pour la photo et **s’éteint seule 5 secondes après** la dernière ;
- **jamais dans une chambre** : si le nom ou la pièce contient « chambre », le programme refuse de démarrer.

## Quoi acheter

- La **Camera Module 3 Wide** (grand angle, 120°).
- Une **nappe pour Pi 5** : le Pi 5 a des petits connecteurs caméra (22 broches), la caméra est livrée avec une nappe de 15 broches. Il faut une nappe « Pi 5 » 22 → 15 broches, de la bonne longueur pour le montage.
- Facultatif mais conseillé :
  - un **témoin** : une LED et une résistance de 330 Ω entre une broche GPIO et la masse. Elle s’allume tant que la caméra tourne (la Camera Module 3 n’a pas de voyant à elle) ;
  - un **interrupteur de coupure** entre une autre broche GPIO et la masse : fermé, la caméra est coupée et rien n’est pris, même si Jarvis le demande.

## Brancher

1. Pi éteint, débranché.
2. Nappe dans le connecteur caméra du Pi 5 (« CAM/DISP 0 », ou « 1 » pour une deuxième caméra), languette relevée, contacts du bon côté, languette rabattue.
3. Allumer. Vérifier que le Pi voit la caméra :

```bash
rpicam-hello --list-cameras
```

On doit lire `imx708_wide`. Sinon : nappe à l’envers ou mal enfoncée.

## Installer (avec l’utilisateur, sur le vrai Pi)

Copier le dossier `robot/oeil` sur le Pi, puis :

```bash
cd robot/oeil
sudo sh installer.sh avant
```

Le script installe Picamera2 et gpiozero (ils viennent de Raspberry Pi OS, rien à compiler), crée un utilisateur `jarvis-oeil`, écrit `/etc/jarvis-oeil/avant.toml` avec **un jeton tout neuf affiché une seule fois**, et démarre le service `jarvis-oeil@avant`, qui redémarre seul s’il s’arrête.

Ensuite, dans `/etc/jarvis-oeil/avant.toml` :

- `nom` et `piece` : ce que l’écran « Yeux » affichera (« Rover avant », « mobile » ; « Hub », « bureau ») ;
- `temoin_gpio` et `coupure_gpio` si la LED et l’interrupteur sont branchés (numéros BCM) ;
- `rotation = 180` si la caméra est montée à l’envers.

Puis `sudo systemctl restart jarvis-oeil@avant`.

**Deux caméras sur le même Pi** (rover : avant et pince) : une deuxième instance, avec son port et son connecteur :

```bash
sudo sh installer.sh pince
# puis dans /etc/jarvis-oeil/pince.toml : nom = "Rover pince", port = 8771, numero_camera = 1
```

## Le relier à Jarvis

Dans Jarvis Test, tableau de bord → **Yeux** → carte « Rover avant » (ou « Hub ») :

- adresse : `http://<nom-du-pi>.local:8770` (ou son adresse IP sur le réseau de la maison) ;
- jeton : celui affiché par l’installateur ;
- « Brancher ». Jarvis vérifie que l’œil répond avant de le garder.

## Essayer sans Pi

Sur n’importe quel ordinateur avec Python 3.11 ou plus :

```bash
cd robot/oeil
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt     # Windows : .venv\Scripts\pip
.venv/bin/python -m pytest
```

Les essais utilisent une fausse caméra et un vrai port local : photo avec le jeton, refus sans jeton, seulement GET, extinction après le repos, interrupteur, panne, une prise à la fois, chambre refusée.

Pour faire tourner l’œil sans caméra : `camera = "fausse"` dans le fichier de réglages.
