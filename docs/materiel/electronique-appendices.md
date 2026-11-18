# L'électronique des appendices de Jarvis

Rédigé par Claude Code le 17 novembre 2026, pour Jarvis Development. À lire avec `docs/specs/jarvis-development.md` (à quoi sert chaque appendice, le contrat, l'ordre de construction).

Ce document dit **quoi acheter**, **pour quoi faire**, **à quel prix environ**, et **où**. Pour chaque appendice : le meilleur choix, et une option moins chère qui reste solide.

---

## 0. Comment lire les prix (important)

- **Tous les prix ont été cherchés sur le web le 17 novembre 2026.** Aucun n'est inventé. Quand rien n'a été trouvé, il est écrit **« prix à vérifier »**.
- **Limite de ce relevé.** Les pages des boutiques n'ont pas pu être ouvertes directement depuis cette session (le réseau de la session ne les autorise pas). Chaque prix est donc celui que le moteur de recherche a lu sur la page citée. La plupart ne portent **pas de date** : quand la page en donnait une, elle est notée. **Revérifie chaque prix sur la page avant de commander.**
- Les prix sont **TTC, hors frais de port**, sauf mention (« HT », « $ », « port compris »).
- **AliExpress** : presque aucun prix n'a pu y être lu. Les petites pièces (capteurs, cartes) y sont en général moins chères, avec deux à quatre semaines de livraison : à regarder au moment de commander.
- Le quota de recherches de la session a été atteint avant la fin. Les lignes « prix à vérifier » sont celles qui n'ont pas pu être cherchées, pas des pièces introuvables.
- Les prix de la mémoire ont beaucoup monté en 2026 : tout ce qui contient beaucoup de mémoire (Raspberry Pi, cartes graphiques, boîtiers domotiques) coûte nettement plus cher qu'un an plus tôt.

---

## 1. Ce que l'utilisateur a déjà, et ce qui va avec

| Matériel | Ce qui compte pour la suite |
| --- | --- |
| **Enceinte** : ESP32-S3 (copie XH-S3E N16R8), INMP441, MAX98357A, OLED SH1106 1,3" | Même carte et même programme pour d'autres enceintes. Broches prises : 4, 5, 6 (micro), 15, 16, 17 (ampli), 8, 9 (écran), 48 (LED). |
| **Robot** : Raspberry Pi 5 + ESP32, propulsion arrière, direction type voiture | Le Pi 5 a deux prises caméra (nappe **22 broches**, plus fine que celle des anciens Pi) et un port PCIe (pour un module IA). Il lui faut **5 V 5 A** ; avec 5 V 3 A, ses ports USB sont limités à 0,6 A ([documentation Raspberry Pi](https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/computers/raspberry-pi/power-supplies.adoc)). |
| **Imprimante** : Ender 3 S1 Plus sous Klipper | Volume 300 × 300 × 300 mm, buse 260 °C au plus, plateau 100 °C au plus, tête à entraînement direct ([3D Printing Industry](https://3dprintingindustry.com/news/creality-launches-the-ender-3-s1-plus-3d-printer-technical-specifications-and-pricing-212251/), [Clever Creations](https://clevercreations.org/creality-ender-3-s1-plus-review-specs/)). La puissance de son alimentation n'a pas été confirmée par une source : à lire sur son étiquette. Une webcam se branche sur l'ordinateur de Klipper, pas sur la carte de l'imprimante. |
| **PC** : RTX 2060 6 Go, 64 Go de RAM, i7 10e génération | La carte graphique est pleine (section 3). La mémoire vive et le processeur ont de la marge : c'est là que la vision lente tournera. |
| **Téléphone** : iPhone, appli web par Tailscale | Sert d'écran et de bouton d'accord. Rien à acheter. |

À confirmer avec l'utilisateur avant d'acheter (décisions du cahier, section 8) : l'ordinateur de Klipper et ses ports USB libres ; la batterie du robot ; les outils déjà possédés.

---

## 2. Les pièces, appendice par appendice

### 2.1 Les YEUX

**Œil de l'imprimante**

| | Pièce | Rôle | Prix relevé | Où |
| --- | --- | --- | --- | --- |
| **Meilleur choix** | Webcam USB **Logitech C920s** (réf. 960-001252), avec volet | Image nette, mise au point automatique, volet pour la couper | 59,99 € (relevé du 1er juillet 2026) | [Amazon.fr, via comparateur](https://www.comparateur-gamer.fr/prix/logitech-c920s-hd-pro-5099206082199) |
| **Moins cher, viable** | Webcam USB **Logitech C270** (réf. 960-001063) | Suffit pour surveiller une impression | 19,99 € (relevé du 1er juillet 2026) | [Amazon.fr, via comparateur](https://www.comparateur-gamer.fr/prix/logitech-c270-5099206064201) |
| Si l'ordinateur de Klipper est un Raspberry Pi | **Raspberry Pi Camera Module 3** (SC0872) | Mise au point automatique, bonne image en faible lumière | 30,90 € | [Kubii](https://www.kubii.com/fr/cameras-capteurs/3878-module-camera-v3-raspberry-pi-3272496313699.html) |
| S'il n'y a pas de port USB libre | **Seeed XIAO ESP32S3 Sense** (carte avec caméra, en Wi-Fi) | Une caméra autonome qui suit le contrat de Jarvis | 16,12 € | [RobotShop EU](https://eu.robotshop.com/products/seeedstudio-xiao-esp32s3-sense-wifi-ble-ov2640-mic-8mb-iot-embedded-ml) |
| Dans tous les cas | Barrette de LED blanches USB 5 V | Éclairer le plateau : sans lumière, pas de surveillance la nuit | prix à vérifier | — |
| Pour une caméra maison | Anneau de 12 LED **WS2812B** | Le témoin « la caméra regarde » | 4,50 € à 5,99 € | [Soldered](https://soldered.com/product/smart-led-ws2812b-ring12/), [AZ-Delivery](https://hackster.io/products/buy/116540) |

- **Compatibilité.** Une webcam USB se branche sur l'ordinateur de Klipper. Le service de caméra habituel (Crowsnest) la sert, et Moonraker donne son adresse (`GET /server/webcams/list`, avec l'adresse de l'image fixe) : Jarvis n'a rien à installer sur l'imprimante ([documentation Moonraker](https://github.com/Arksine/moonraker/blob/master/docs/external_api/webcams.md)). Moonraker ne sert pas l'image lui-même : elle vient du service de caméra.
- **À éviter.** Les petites cartes « ESP32-CAM » à 7 € : plusieurs fabricants les arrêtent (marquée « discontinued » chez [Waveshare](https://www.waveshare.com/ESP32-CAM.htm)). Pour une caméra Wi-Fi, prendre une carte ESP32-S3.
- **À imprimer** (en PETG, la pièce est près de la chaleur) : le support de la caméra, le support de l'éclairage.

**Œil du robot**

| | Pièce | Rôle | Prix relevé | Où |
| --- | --- | --- | --- | --- |
| **Meilleur choix** | **Raspberry Pi Camera Module 3 Wide** (SC0874, 120°) | Voit large : les objets au sol tout près, et les repères au mur | 39,90 € | [BerryBase (Allemagne)](https://www.berrybase.de/en/raspberry-pi-camera-module-3-wide-12mp) |
| **Moins cher, viable** | Caméra 5 MP 160° (capteur OV5647) | Image correcte, mise au point fixe | 12,95 € | [Kubii](https://www.kubii.com/fr/cameras-capteurs/2667-camera-5mp-pour-raspberry-pi-3-160-kubii-3272496298354.html) |
| Obligatoire avec l'une ou l'autre | **Nappe caméra pour Pi 5** (22 vers 15 broches, 200 mm) | Le Pi 5 n'a pas la même prise que les anciens Pi | 1,32 € | [Kubii](https://www.kubii.com/fr/nappes-cables-adaptateurs/4116-1860-nappe-csi-mipi-camera-pour-raspberry-pi-5-3272496316669.html) |
| Autre voie | **Raspberry Pi AI Camera** (SC1174, capteur IMX500) | La caméra reconnaît les objets elle-même, sans charger le Pi | 80,10 € | [Kubii](https://www.kubii.com/fr/cameras-capteurs/4391-raspberry-pi-ai-camera-5056561803890.html) |

- **Piège.** La nappe 22 broches n'est **pas fournie** avec les caméras bon marché. La caméra OV5647 marche bien sur le Pi 5 ([documentation Arducam](https://www.arducam.com/docs/Raspberry-Pi-Camera/Native-camera/5MP-OV5647/)).
- **À imprimer** : le support de caméra à l'avant du robot, inclinable.

**Œil du bureau ou d'une pièce** (seulement si l'utilisateur en veut un : décision A8)

| | Pièce | Prix relevé | Où |
| --- | --- | --- | --- |
| **Choix proposé** | **Seeed XIAO ESP32S3 Sense**, dans un boîtier imprimé avec un volet coulissant et un témoin | 16,12 € (+ témoin 4,50 €) | [RobotShop EU](https://eu.robotshop.com/products/seeedstudio-xiao-esp32s3-sense-wifi-ble-ov2640-mic-8mb-iot-embedded-ml) |
| Équivalent sans marque | Carte « ESP32-S3 WROOM CAM N16R8 + OV2640 » | 13,95 € + 4,99 € de port (fiche exacte à confirmer) | [Fruugo](https://www.fruugo.fr/2025-esp32-s3-wroom-n16r8-module-de-camera-de-carte-de-developpement-cam-avec-ov2640/p-402044273) |

Une webcam USB sur le PC n'est pas proposée : l'application refuse la caméra à sa fenêtre, et c'est une bonne règle à garder.

### 2.2 Les BRAS

**Le bras du robot : le bras treillis V1 de l'utilisateur** (correction du 19 novembre 2026 ; il remplace la « pince simple » de la première version)

Deux segments en treillis de 150 mm en PETG ; servos de base, de coude et de poignet de 25 kg, servo d'épaule de 35 kg ; pince à deux mâchoires sur un servo MF90 ; environ 540 g ; charge de 250 g à moins de 25 cm de l'épaule.

**Ce qui est déjà acheté**

| Pièce | Rôle |
| --- | --- |
| 3 × servo de 25 kg | Base, coude, poignet |
| 1 × servo de 35 kg | Épaule (l'articulation qui porte le plus) |

**Ce qui manque** (prix relevés par recherche web le **18 novembre 2026**, sauf mention ; mêmes limites qu'à la section 0 : à revérifier sur la page avant de commander)

| Pièce | Rôle | Prix relevé | Où |
| --- | --- | --- | --- |
| Carte **PCA9685** 16 canaux, modèle générique | Envoie le signal de commande aux cinq servos, par deux fils (I2C) depuis le Pi ou l'ESP32 | 6,00 € (relevé le 17 novembre) ; 7,95 € | [TinyTronics](https://www.tinytronics.nl/en/mechanics-and-actuators/motor-controllers-and-drivers/servomotor-controllers/16-channel-i2c-pwm-servo-controller-pca9685), [Bits & Parts (Pays-Bas)](https://www.bitsandparts.nl/en/servo-motor-driver-pwm-16-channel-12-bits-pca9685-i2c-p1930792) |
| Carte **PCA9685**, modèle de marque | Même rôle, mieux finie | 13,56 € | [RobotShop EU](https://eu.robotshop.com/products/pca9685-16-channel-12-bit-pwm-servo-driver) |
| **Alimentation des servos** : convertisseur abaisseur **réglable**, 300 W, 20 A au plus (15 A conseillés), à régler entre 6,8 et 7,4 V | Alimente les quatre gros servos depuis la batterie. Il faut 10 A au moins. | 15,95 € (+ 7,49 € de port) ; 24,99 € port compris | [Fruugo](https://www.fruugo.fr/module-de-conversion-abaisseur-reglable-300w-20a-dc-dc/p-398067443-848653422), [Kaufland.fr](https://www.kaufland.fr/product/565164962/) ; fiche technique : [Kubii](https://kubii.com/en/modulos-reles/3322-300w-20a-voltage-converter-step-down-module-3272496306424.html) |
| **Régulateur 5 à 6 V, 3 A** (UBEC de modélisme) | Alimente le MF90 de la pince, à part | 5,95 € (sans marque, + port) ; 12,95 € (Hobbywing, port compris) | [Fruugo](https://www.fruugo.fr/module-regulateur-de-tension-ubec-entree-55-26-v-carte-de-commutation-bec-anti-interference-pour-avion-rc/p-423636791-891305019), [Fruugo](https://www.fruugo.ie/hobbywing-3a-ubec-5v-6v-max-5a-lowest-rf-noise-bec-voltage-regulator/p-438161266-918315209) |
| **Porte-fusibles à lame en ligne + fusibles** | Le fusible de l'alimentation des servos, au plus près de la batterie | 7,99 € le lot de 3 avec 14 fusibles (relevé le 17 novembre) | [Touslesprix (vendeur Amazon)](https://www.touslesprix.com/achat,porte-fusible-voiture.html) |
| **Relais automobile 12 V 30 A**, 5 broches | Coupe l'alimentation des servos quand l'arrêt d'urgence est enfoncé | 13,29 € le lot de 5 | [Touslesprix (vendeur Amazon)](https://www.touslesprix.com/achat,relais-auto-12v-30a.html) |
| **Support de relais** 5 broches | Brancher le relais sans souder sur ses pattes | 10,85 € | [Touslesprix (vendeur Cdiscount)](https://www.touslesprix.com/achat,relais-auto-12v-30a.html) |
| Bouton d'arrêt d'urgence | Le même que celui de l'étape 5 : il coupe aussi le bras | déjà compté à l'étape 5 (15,59 €) | section 2.3 |
| Servo **MF90** | Serre la pince | **à confirmer : déjà là ?** Aucun prix trouvé pour ce modèle précis | — |
| Filament **PETG**, 1 kg | Les segments et les pièces du bras | 16,99 € HT ; 28,75 € | [filament2print](https://filament2print.com/fr/pet-petg-cpe/2484-petg-r3d.html), [LDLC](https://ldlc.com/en/product/PB00508702.html) |
| Petit contact (micro-interrupteur) dans la pince | Savoir que l'objet est tenu | prix à vérifier | — |
| Fil souple de bonne section, rallonges de servo | Porter 10 A sans chauffer ; atteindre le poignet | prix à vérifier | — |

**Comment c'est protégé**

```
batterie ── fusible ── contact du relais ── convertisseur 6,8 à 7,4 V ──► servos de 25 et 35 kg
                            ▲                └─ régulateur 5 à 6 V ──────► MF90 de la pince
        arrêt d'urgence ── bobine du relais
```

- **Le fusible** est le premier élément après la batterie. Son calibre se choisit selon la batterie (décision A10 du cahier) et la section du fil ; l'ordre de grandeur est 10 à 15 A.
- **L'arrêt d'urgence coupe par le câblage.** La bobine du relais passe par le contact « normalement fermé » du bouton : bouton enfoncé, ou fil arraché, la bobine n'a plus de courant, le relais s'ouvre, les servos sont coupés. Aucun programme n'est dans cette chaîne.
- Bouton enfoncé, **le bras retombe** (540 g, plus la charge). C'est voulu : un bras sans force ne pince plus. Il ne faut rien de fragile ni personne dessous.
- Un « stop » ordinaire, lui, ne coupe rien : le programme fige le bras, servos alimentés.

**Points à vérifier avant de câbler**

- **Régler le convertisseur à vide**, au multimètre, entre 6,8 et 7,4 V, **avant** de brancher un servo. Un module réglable peut sortir beaucoup plus à la livraison.
- **La carte PCA9685 distribue une seule tension** à toutes ses sorties. Le MF90 (5 à 6 V) ne prend que son signal sur la carte ; son alimentation vient de son régulateur. Toutes les masses sont reliées.
- **Les pistes de la carte PCA9685** ne sont pas forcément prévues pour 10 A. Si le doute reste, l'alimentation des gros servos est distribuée à part (un bornier), et la carte ne porte que les signaux.
- Un régulateur fixe de qualité a été regardé puis **écarté** : le Pololu D24V150F7 sort 7,5 V, au-dessus de la plage prévue, et coûte de 72 € HT à 122,50 € ([exp-tech](https://exp-tech.de/en/products/pololu-75v-15a-step-down-voltage-regulator-d24v150f7), [opencircuit](https://opencircuit.shop/product/pololu-7.5v-15a-step-down-voltage-regulator), [Botland](https://botland.store/converters-step-down/7615-step-down-voltage-regulator-d24v150f7-75v-15a-pololu-2883-5904422360108.html)).
- Ces servos **ne renvoient ni position ni effort**. Le contact dans la pince, ou la caméra, dit si l'objet est tenu.

**À imprimer** : les deux segments en treillis, les supports de servo, la base, les mâchoires de la pince (PETG ; des patins en TPU sur les mâchoires si les objets glissent), le support du bras sur le robot.

**Idée pour plus tard** : décoller une pièce du plateau de l'imprimante avec une spatule (cahier, section 6, « Idées en attente »).

**Bras de bureau** (plus tard, seulement si l'envie est là)

| | Pièce | Prix relevé | Où |
| --- | --- | --- | --- |
| **Meilleur choix** | Bras ouvert **SO-101**, bras seul : 6 servos STS3215, une carte, une alimentation ; pièces à imprimer | 124,30 € (total de la liste officielle des pièces, pas un prix de kit) | [dépôt SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100) |
| Kit prêt | Seeed SO-ARM101 Pro, moteurs seuls, deux bras (un qui guide, un qui suit) | 319,95 € | [OpenELAB](https://openelab.io/products/seeed-studio-so-101-pro-servo-motor-kit-lerobot) |
| **Moins cher** | Aucun bras moins cher n'est vraiment fiable. Un bras à micro-servos (lot de 10 SG90 : 18,99 €) sert à apprendre, pas à travailler. | 18,99 € | [Amazon.fr](https://www.amazon.fr/Moteurs-servomoteur-Servomoteur-Compatible-H%C3%A9licopt%C3%A8res/dp/B0H6JR4DJC) |

Les pièces du SO-101 sont prévues pour un plateau de 220 × 220 mm : elles tiennent largement sur l'Ender 3 S1 Plus. Matériel et logiciel sont sous licence Apache 2.0.

### 2.3 Les JAMBES

**Sentir les obstacles et savoir où il est**

| | Pièce | Rôle | Prix relevé | Où |
| --- | --- | --- | --- | --- |
| **Meilleur choix** | Capteur de distance **VL53L5CX** (Pololu 3417), une grille de 8 × 8 mesures | Voit l'obstacle devant **et** le vide (une marche) | 20,90 € | [Gotronic](https://www.gotronic.fr/art-capteur-de-distance-vl53l5cx-3417-35488.htm) |
| | Centrale **BNO085** (Adafruit 4754) | Garde le cap sans dériver | 34,50 € | [Gotronic](https://www.gotronic.fr/art-module-9-dof-bno085-ada4754-33477.htm) |
| **Moins cher, viable** | 2 × capteur à ultrasons **HC-SR04** | Un à gauche, un à droite | 3,90 € pièce | [Gotronic](https://www.gotronic.fr/art-module-de-detection-us-hc-sr04-20912.htm) |
| | Centrale **MPU6050** (Joy-It) | Donne le cap, mais il dérive : à recaler sur les repères | 5,80 € | [Gotronic](https://www.gotronic.fr/art-module-6-dof-sen-mpu6050-31492.htm) |
| Dans les deux cas | 2 micro-interrupteurs à levier | Le pare-chocs : le dernier filet | prix à vérifier | — |
| Dans les deux cas | Repères imprimés (AprilTag), sur papier | Le robot se recale en les voyant | 0 € | bibliothèque libre ([licence BSD](https://github.com/AprilRobotics/apriltag/blob/master/LICENSE.md)) |
| Si le robot n'en a pas | Bouton d'arrêt d'urgence 22 mm « coup de poing » | Coupe les moteurs par un fil | 15,59 € le lot de 4 | [Amazon.fr](https://www.amazon.fr/HAAMNING7-bouton-poussoir-durgence-verrouillage-champignon/dp/B0G5YM5VXN) |
| Plus tard | Capteur laser tournant **RPLIDAR C1** | Dessine la carte de la pièce | 81,12 € à 83,90 € | [Génération Robots](https://generationrobots.com/en/551-slamtec-lidar), [Gotronic](https://www.gotronic.fr/art-capteur-de-distance-rplidar-c1-38898.htm) |

- **Compatibilité.** Tous ces capteurs se branchent sur l'ESP32 du robot (I2C ou deux broches). Il faut d'abord relever ses broches libres.
- **Le capteur laser** demande un gros logiciel (ROS 2). Sur le système habituel du Raspberry Pi, il n'a qu'un support de troisième rang : il faut le faire tourner dans un conteneur, ou passer le Pi sous Ubuntu ([documentation ROS 2](https://github.com/ros2/ros2_documentation/blob/jazzy/source/How-To-Guides/Installing-on-Raspberry-Pi.rst)). C'est pour ça qu'il vient en dernier.
- **À imprimer** : les supports des capteurs, le pare-chocs, la base.

**Se recharger** : voir la section 4 (alimentation et batteries). Le choix dépend de la batterie actuelle du robot.

### 2.4 Les OREILLES et la VOIX

**Une enceinte de plus** (les mêmes pièces qu'aujourd'hui)

| Pièce | Prix relevé | Où |
| --- | --- | --- |
| Carte ESP32-S3 DevKitC-1 **N16R8** (copie) | 13,58 € ; 11,99 € ; 20,99 € le lot de 2 | [Amazon.fr](https://www.amazon.fr/d%C3%A9veloppement-DevKitC-WROOM1-Bluetooth-Maille/dp/B0CLD4QKT1), [Amazon.fr](https://www.amazon.fr/DollaTek-d%C3%A9veloppement-ESP32-S3-DevKitC-1-ESP32-S3-WROOM-1-N16R8-compatible/dp/B0CXT1Z2WD), [Amazon.fr](https://www.amazon.fr/Diymore-d%C3%A9veloppement-DevKitC-Bluetooth-Broches/dp/B0DFCQGW4C) |
| Micro **INMP441** | 7,59 € le lot de 3 ; 3,50 € pièce | [Amazon.fr](https://www.amazon.fr/Wcawnlt-Microphone-Omnidirectionnel-Enregistrement-Professionnel/dp/B0GCMZKQ6C), [TinyTronics](https://www.tinytronics.nl/en/sensors/sound/inmp441-mems-microphone-i2s) |
| Ampli **MAX98357A** | 7,99 € le lot de 3 | [Amazon.fr](https://www.amazon.fr/HENGBIRD-Amplificateur-MAX98357A-Num%C3%A9rique-Raspberry/dp/B0GY479Y14) |
| Haut-parleur 4 Ω 3 W | 4,90 € | [Kubii](https://kubii.com/es/altavoces-microfonos/2190-altavoz-4-ohmios-3w-3272496011045.html) |
| Écran OLED 1,3" **SH1106** I2C | 5,74 € ; 6,90 € | [Amazon.fr](https://www.amazon.fr/Reland-Sun-%C3%89cran-SH1106-pixels/dp/B08RWGXDQ7), [Audiophonics](https://www.audiophonics.fr/fr/ecrans-afficheurs-vu-metres/ecran-oled-13-128x64-sh1106-blanc-interface-i2c--p-11573.html) |

Soit **environ 29 € de pièces par enceinte** (13,58 + 2,53 + 2,66 + 4,90 + 5,74, en comptant les lots à l'unité), hors boîtier imprimé et fils.

**Couper Jarvis sur le PC** (l'annulation d'écho)

| | Solution | Prix relevé | Où |
| --- | --- | --- | --- |
| **À essayer d'abord** | En logiciel : le moteur de la fenêtre sait retirer l'écho, et ce réglage est **séparé** du réglage automatique du volume (coupé en 0.4.16). Rien à acheter. | 0 € | [documentation MDN](https://github.com/mdn/content/blob/main/files/en-us/web/api/mediatrackconstraints/index.md) |
| **Meilleur choix** si la mesure est mauvaise | Haut-parleur-micro USB **Jabra Speak2 40** | 113,22 € à 118,38 € | [Amazon.fr](https://www.amazon.fr/Jabra-Speak2-Speakerphone-r%C3%A9duction-Haut-parleur/dp/B0BWKFSTL5) |
| **Moins cher, viable** | **EMEET OfficeCore M0 Plus** | 48,49 € à 70,73 € selon le vendeur | [aio.lv (Lettonie)](https://aio.lv/en/product--emeet-e1103--12272861), [great-technology.be](https://www.great-technology.be/products/emeet-officecore-m0-plus-conference-speaker) |
| Entre les deux | **Anker PowerConf S3** | 99,99 € (56,99 € au plus bas sur 30 jours) | [Amazon.fr](https://www.amazon.fr/Anker-Haut-Parleur-conf%C3%A9rence-Microphones-Enregistrement/dp/B0899S421T) |

Le même haut-parleur-micro USB peut donner sa voix au **robot** (le Pi n'a pas de prise audio).

**Couper Jarvis depuis l'enceinte**

| | Solution | Prix relevé | Où |
| --- | --- | --- | --- |
| **À essayer d'abord** | Sur la carte actuelle, en logiciel : donner au programme le son qu'il joue comme référence | 0 € | [documentation ESP-SR](https://github.com/espressif/esp-sr/blob/master/docs/en/audio_front_end/README.rst) |
| **Meilleur choix** | **Seeed ReSpeaker Lite** (deux micros et une puce qui retire l'écho toute seule) ; en kit avec une carte XIAO ESP32S3 | 23,95 € seule ; 29,95 € en kit | [Reichelt](https://www.reichelt.com/de/en/shop/product/respeaker_lite_2-mic_integrated_ai_algorithms-387219), [Reichelt](https://www.reichelt.com/de/en/shop/product/respeaker_lite_2-mic_with_ai_algorithms_incl_xiao_esp32s3-387257) |
| **Moins cher, viable** | **Waveshare ESP32-S3-AUDIO-Board** (carte ESP32-S3 avec deux micros et la voie de référence câblée) | 23,90 € (indisponible) ; 26,99 € | [BerryBase](https://www.berrybase.de/en/waveshare-esp32-s3-ai-smart-speaker-development-board-dual-mikrofon-wifi-bt5-16mb-flash-240-mhz), [Amazon.fr](https://www.amazon.fr/-/en/Waveshare-ESP32-S3-Development-Microphones-Reduction/dp/B0FP1VL37J) |
| Haut de gamme | ReSpeaker XVF3800 (4 micros) avec XIAO ESP32S3 | 68,60 € | [Gotronic](https://www.gotronic.fr/art-respeaker-xmos-xiao-esp32s3-48749.htm) |

- **Ce qu'on sait.** Le programme d'Espressif retire l'écho si on lui donne une voie de référence. Avec un micro et une référence, il prend environ 60 Ko de mémoire interne, 740 Ko de mémoire externe et un cinquième d'un cœur de l'ESP32-S3 ([mesures d'Espressif](https://github.com/espressif/esp-sr/blob/master/docs/en/benchmark/README.rst)). La carte actuelle a la mémoire pour ça.
- **Ce qu'on ne sait pas.** Espressif conseille de reprendre le son **à la sortie de l'ampli**, par un fil ([guide matériel](https://github.com/espressif/esp-sr/blob/master/docs/en/audio_front_end/Espressif_Microphone_Design_Guidelines.rst)). Une référence donnée en logiciel a existé dans leurs outils, avec un retard à régler au millième de seconde. Ça peut marcher sur la carte actuelle, ou pas : il faut l'essayer avant d'acheter.
- **Compatibilité.** Le kit ReSpeaker Lite utilise une carte XIAO, plus petite que la carte actuelle : à vérifier que le programme de l'enceinte y tient. La ReSpeaker Lite seule peut aussi se brancher sur la carte actuelle.

### 2.5 Les SENS

**Une carte de capteurs que l'on construit**

| | Pièce | Rôle | Prix relevé | Où |
| --- | --- | --- | --- | --- |
| Base | Carte **ESP32-C3 SuperMini** | Le petit cerveau du capteur | 15,95 € le lot de 5, + 4,49 € de port ; 6,95 € pièce + 5,49 € (fiches exactes à confirmer) | [Fruugo](https://www.fruugo.fr/carte-de-developpement-esp32-c3-mini-5-pieces-carte-dextension-wi-fi-et-bluetooth/p-331692604-731425872), [Fruugo](https://www.fruugo.fr/esp32-c3-supermini-carte-de-developpement-wifi-bluetooth-esp32-mini-carte-de-developpement-esp32-c3-developme/p-363498211) |
| **Moins cher, viable** | Capteur **SHT40** (module Grove Seeed) | Température et humidité | 6,90 € | [Gotronic](https://gotronic.fr/download-product-page/36055) |
| **Meilleur choix** : ajouter | Radar de présence **HLK-LD2410C** | Sait qu'une personne est là, même immobile, sans la voir | prix à vérifier (vu de 2,90 € à 15,95 € selon le vendeur) | [OpenELAB](https://openelab.io/fr/products/hlk-ld2410c-24ghz-human-precense-radar-module), [Fruugo](https://www.fruugo.fr/module-de-detection-de-mouvement-de-capteur-radar-de-presence-humaine-ld2410c-a-ondes-millimetriques-24g/p-417892198) |
| **Meilleur choix** : ajouter | Capteur de CO2 **SCD40** (M5Stack U103) | Dit quand il faut aérer | 42,60 € | [Gotronic](https://www.gotronic.fr), code article 38039 |
| Variante | Capteur **BME280** (Waveshare) : température, humidité, pression | 15,90 € | [Welectron (Allemagne)](https://welectron.com/Waveshare-15231-BME280-Environmental-Sensor_1) |
| Porte | Contact magnétique à fil (type MC-38) | Porte ou fenêtre ouverte | prix à vérifier | — |

**Des capteurs tout faits, sans fil (Zigbee), à pile**

| Pièce | Rôle | Prix relevé | Où |
| --- | --- | --- | --- |
| Récepteur **Sonoff ZBDongle-E** | Indispensable : il reçoit tous les capteurs Zigbee | 16,00 € | [Domadoo](https://www.domadoo.fr/fr/dongle-zigbee/6315-sonoff-dongle-usb-zigbee-30-antenne-externe-v2-zbdongle-e-compatible-home-assistant-et-zigbee2mqtt-6920075777659.html) |
| **Sonoff SNZB-02P** | Température et humidité | 9,99 € | [Domadoo](https://www.domadoo.fr/fr/chauffage-connecte/6732-sonoff-capteur-de-temperature-et-d-humidite-zigbee-30-avec-support.html) |
| **Sonoff SNZB-04P** | Porte ou fenêtre | 9,99 € | [Domadoo](https://www.domadoo.fr/fr/securite/7058-sonoff-capteur-de-porte-ou-fenetre-zigbee-30-snzb-04p.html) |
| **Sonoff SNZB-06P** | Présence (radar) | 11,99 € (un autre relevé dit 16,19 €) | [Domadoo](https://www.domadoo.fr/fr/securite/6827-capteur-de-presence-humaine-zigbee-30-technologie-radar-sonoff.html) |
| **Aqara TVOC** | Qualité de l'air | 44,99 € (relevé du 9 juillet 2026) | [Domadoo](https://www.domadoo.fr/fr/peripheriques/5751-xiaomi-aqara-moniteur-de-qualite-d-air-zigbee-30-temp-hum-covt-6970504214644.html) |

Ces capteurs ne parlent pas directement à Jarvis : il leur faut un logiciel entre les deux (voir 2.6, « Home Assistant »). Ils sont plus propres et sans fil, mais ils ajoutent un programme à faire tourner.

**La fumée**

| | Pièce | Prix relevé | Où |
| --- | --- | --- | --- |
| **Meilleur choix** | **Shelly Plus Smoke** (Wi-Fi, norme EN 14604 citée par les revendeurs) : il prévient le PC lui-même, sans boîtier en plus | 49,89 € ; 52,99 € | [Alternate.fr](https://www.alternate.fr/Shelly/Plus-Smoke-Détecteur-de-fumée/html/product/1901013), [Domadoo](https://www.domadoo.fr/fr/objets-communicants/6520-shelly-detecteur-de-fumee-intelligent-wi-fi-shelly-plus-smoke-3800235265598.html) |
| **Moins cher, viable** | **Heiman HS1SA-E** (Zigbee, « certifié EN14604 » dans le titre de la fiche) + le récepteur Zigbee | 18,99 € + 16,00 € | [Domadoo](https://www.domadoo.fr/fr/peripheriques/6291-heiman-hs1sa-e-detecteur-de-fumee-zigbee-certifie-en14604.html) |
| Le minimum légal | Détecteur de fumée simple, certifié NF, non connecté | 16,50 € (fiche exacte à confirmer) | [Brico Dépôt](https://www.bricodepot.fr/p/4001869577777/detecteur-de-fumee-daaf-nf-o-70-mm-x-33-mm) |

- Le Shelly Plus Smoke peut appeler une adresse du réseau local quand il sonne ([guide Shelly](https://www.shelly.com/fr/blogs/documentation/shelly-plus-smoke-web-interface-guide)). Le nom exact de l'événement n'a pas été trouvé dans la documentation : **à vérifier avant d'acheter**. Il était en rupture sur le site de Shelly le jour du relevé.
- **Un capteur de gaz à quelques euros (type MQ-2) n'est pas un détecteur de fumée.** Il n'est ni étalonné, ni certifié, et n'a pas de sirène. Il n'est pas proposé ici.
- Le détecteur certifié **sonne tout seul**, que Jarvis marche ou pas. C'est pour ça qu'il reste la vraie sécurité.

### 2.6 Les MAINS SUR LA MAISON

**En direct (recommandé pour commencer)**

| | Pièce | Rôle | Prix relevé | Où |
| --- | --- | --- | --- | --- |
| **Meilleur choix** | **Shelly Plug S Gen3** | Prise qui mesure le courant et qui coupe. Elle parle au PC par le réseau local, sans Internet. | 23,68 € | [shelly.com/fr](https://www.shelly.com/fr/products/shelly-plug-s-gen3) |
| **Moins cher** | Il n'y a pas moins cher **en direct**. Les prises à 8 € (IKEA GRILLPLATS) ou à 16,99 € (NOUS A1Z) demandent un récepteur et un logiciel en plus. | 8 € ; 16,99 € | [iGeneration](https://www.igen.fr/tests/2026/05/test-de-la-grillplats-dikea-la-nouvelle-reference-des-prises-connectees-ne-coute-que-8-eu-156087), [Les Alexiens](https://www.lesalexiens.fr/actualites/100-offres-domotique-zigbee-tuya-home-assistant/) |
| Lumière | Une lampe branchée sur une Shelly Plug S | Le plus simple pour « allume la lampe » | 23,68 € | idem |
| Interrupteur mural | **Shelly 1PM Gen4** (module derrière l'interrupteur) | Commande un plafonnier | 22,00 € | [shelly.com/fr](https://www.shelly.com/fr/products/shelly-1pm-gen4) |

- **Compatibilité.** Les Shelly de 2e génération et plus se pilotent en local, sans compte en ligne ([documentation Home Assistant](https://raw.githubusercontent.com/home-assistant/home-assistant.io/current/source/_integrations/shelly.markdown)). La Plug S Gen3 est donnée pour 12 A et 2 500 W (vu sur une fiche de revendeur, à confirmer sur la fiche officielle).
- **Sécurité.** Un module mural se monte dans une boîte électrique, en 230 V : par quelqu'un qui sait le faire, courant coupé.

**Par Home Assistant (quand il y aura beaucoup d'appareils)**

| Pièce | Rôle | Prix relevé | Où |
| --- | --- | --- | --- |
| **À essayer d'abord** : Home Assistant dans une machine virtuelle sur le PC | Pour voir si ça plaît, sans rien acheter | 0 € | [documentation Home Assistant](https://raw.githubusercontent.com/home-assistant/home-assistant.io/current/source/_includes/installation/operating_system.md) |
| **Meilleur choix** : boîtier **Home Assistant Green** | Une petite machine toujours allumée, 2 à 3 W | 179,00 € | [Domadoo](https://www.domadoo.fr/fr/produits-compatibles-home-assistant/7046-nabu-casa-box-domotique-home-assistant-green-0794677011758.html) |
| **Moins cher, viable** : Raspberry Pi 5 4 Go + alimentation officielle | Même usage, à monter soi-même | 126,00 € + 11,50 € (+ carte mémoire, prix à vérifier) | [Espace-Domotique](https://www.espace-domotique.fr/fr/raspberry-pi/raspberry-pi-5-4-go-model-b-avec-ram-4-go-raspberry-4830.html), [Kubii](https://kubii.com/en/3-raspberry-pi-micro-bit) |
| Récepteur Zigbee | Sonoff ZBDongle-E, ou Home Assistant Connect ZBT-2 | 16,00 € ; 45,00 € | [Domadoo](https://www.domadoo.fr/fr/dongle-zigbee/6315-sonoff-dongle-usb-zigbee-30-antenne-externe-v2-zbdongle-e-compatible-home-assistant-et-zigbee2mqtt-6920075777659.html), [Domadoo](https://www.domadoo.fr/fr/dongle-zigbee/8542-nabu-casa-home-assistant-connect-zbt-2-adaptateur-usb-zigbee-ou-matter-thread-0860011789741.html) |

- Le boîtier Home Assistant Green coûtait 99 $ à sa sortie ; il a presque doublé avec le prix de la mémoire.
- Sur le PC, la machine virtuelle doit être faite avec VirtualBox ou VMware : Hyper-V ne sait pas lui passer la clé Zigbee USB (même documentation).
- Jarvis parle à Home Assistant par une seule adresse locale et un jeton ([documentation](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/api/rest.md)).

**Le chauffage** (dépend du type de chauffage : décision A3)

| Type de chauffage | Pièce | Prix relevé | Où |
| --- | --- | --- | --- |
| Radiateurs électriques à fil pilote | Module **NodOn SIN-4-FP-21** (Zigbee) | 39,90 € pièce | [Domadoo](https://www.domadoo.fr/fr/chauffage-connecte/6828-nodon-module-chauffage-fil-pilote-connecte-zigbee-30.html) |
| Radiateurs à eau | Tête thermostatique **Sonoff TRVZB** (Zigbee) | 32,90 € (prix relevé en Irlande ; France à vérifier) | [PriceSpy](https://pricespy.ie/product.php?p=13400682) |

Ces deux pièces sont en Zigbee : le chauffage arrive donc avec Home Assistant, pas en direct.

### 2.7 Les ÉCRANS

| | Pièce | Rôle | Prix relevé | Où |
| --- | --- | --- | --- | --- |
| Existe | OLED 1,3" SH1106 sur l'enceinte | Mascotte, heure, informations | 5,74 € | voir 2.4 |
| **Moins cher, viable** | **ESP32-2432S028R** (écran tactile 2,8" avec sa carte intégrée) | Le panneau d'atelier : progression, température, bouton Pause | 17,95 € + 4,49 € de port | [Fruugo](https://www.fruugo.fr/28-pouces-esp32-2432s028r-esp32-affichage-240x320-ecran-tactile-resistif/p-425554057) |
| **Meilleur choix** | **Waveshare ESP32-S3-Touch-LCD-4.3** (4,3", 800 × 480) | Le même, plus grand et plus lisible | 48,95 € à 49,00 € (vendeurs tiers) | [Fruugo](https://www.fruugo.fr/esp32-s3-43-pouces-ecran-tactile-lvgl-gui-carte-de-developpement-800x480-5-points-ecran-lcd-tactile-compatible/p-359363792) |
| Gratuit | Un vieux téléphone ou une tablette sur un support imprimé, ouvert sur l'appli de Jarvis | Tableau de bord | 0 € | — |
| Témoin | Anneau de 12 LED WS2812B | « La caméra regarde », « Jarvis surveille » | 4,50 € à 5,99 € | voir 2.1 |
| Plus tard | Petit écran rond **GC9A01** 1,28" | L'état du robot | 12,95 € + 4,49 € de port | [Fruugo](https://www.fruugo.fr/module-d%25E2%2580%2599affichage-lcd-tft-couleur-ips-de-128-pouce-ecran-rond-led-rvb-de-128-pouce-240x240-gc9a01-lecteur-4-fils-spi-interface/p-338288979-742066831) |
| Plus tard | Affichage à encre électronique Waveshare 2,9" | Briefing, notes | 17,99 $ (prix en euros à vérifier) | [Waveshare](https://www.waveshare.com/product/luckfox/boards-modules/luckfox-pico-core1106/pico-epaper-2.9.htm) |

**À imprimer** : les boîtiers et les pieds de tous ces écrans.

### 2.8 Les autres appendices

| Appendice | Pièce | Prix relevé | Où |
| --- | --- | --- | --- |
| **Énergie** — meilleur choix | Onduleur **APC Back-UPS BX750MI** (750 VA, 410 W, prise USB) | 89,90 € ; 124,99 € | [Officeeasy](https://www.officeeasy.fr/apc-bx750mi.html), [TopAchat](https://www.topachat.com/pages/detail2_cat_est_peripheriques_puis_rubrique_est_w_ond_puis_ref_est_in20007962.html) |
| **Énergie** — autre | Onduleur **Eaton 3S 700** | 99 € HT | [LDLC Pro](https://www.ldlc.pro/reseaux/onduleurs/cint7990/) |
| **Toucher** — bouton « Tout arrêter » | Une carte ESP32-C3 SuperMini et un gros bouton, dans un boîtier imprimé | une carte du lot (≈ 3,20 €) + bouton, prix à vérifier | voir 2.5 |
| **Télécommande** | **Broadlink RM4 mini** (infrarouge, pilotable en local) | 24,74 € (en promotion, relevé du 22 juin 2026) | [Les Alexiens](https://www.lesalexiens.fr/actualites/bon-plan-39-sur-broadlink-rm4-pro/) |

- **L'onduleur.** Windows voit en général un onduleur USB comme une batterie, sans logiciel du fabricant ([documentation Microsoft](https://raw.githubusercontent.com/MicrosoftDocs/windows-driver-docs/staging/windows-driver-docs-pr/battery/overview-of-system-battery-management.md)). Jarvis pourrait donc lire « secteur coupé » et « charge restante » sans rien installer. Aucune source ne le garantit pour ces deux modèles : **à essayer sur l'appareil**.
- **410 W** : à comparer à la consommation réelle du PC et de l'écran. Un wattmètre de prise la mesure (prix à vérifier), et la Shelly Plug S le fait aussi.

---

## 3. Où faire tourner la vision : la question à trancher

### La réponse courte

**Ne rien acheter au début.** Il y a trois sortes de vision, et aucune n'a besoin de la carte graphique en continu :

1. **Surveiller l'imprimante** : une image toutes les 10 à 30 secondes. Le **processeur du PC** suffit.
2. **Regarder à la demande** (« que vois-tu ? », lire un écran) : un petit modèle « vision + langage », lancé de temps en temps, sur le processeur du PC ou sur la RTX 2060 **à la place** du modèle de langage le temps d'une image.
3. **Voir en roulant** : sur le **Pi 5 du robot**, d'abord sans accélérateur.

Le **module IA du Pi 5** (79,80 €) est le premier achat à faire si, mesure faite, le robot voit trop lentement.

### Les chiffres

Les vitesses sont celles d'un petit détecteur d'objets (image de 640 × 640), relevées dans les documentations. Elles donnent un ordre de grandeur : **il faudra mesurer sur le matériel de l'utilisateur.**

| Où | Mémoire | Vitesse | Prix | Avis |
| --- | --- | --- | --- | --- |
| **RTX 2060 6 Go** (déjà là) | Pleine. Le modèle de langage `qwen2.5:7b` y occupe 4,3 Go et n'y tient qu'à 79 % (mesures du projet, `rapports/2026-11-04-entrainement-essai-1.md` et `rapports/2026-11-11-trieur-examen-jarvis.md`). Ollama ne charge un second modèle sur la carte que s'il y tient en entier ([FAQ Ollama](https://github.com/ollama/ollama/blob/main/docs/faq.mdx)). | Non mesurée sur cette carte. Très rapide en théorie : la documentation donne 1,5 millième de seconde par image sur une carte de serveur (Tesla T4). | 0 € | **Pas en continu.** Possible à la demande, en déchargeant le modèle de langage, comme le fait le module images. |
| **Processeur du PC** (i7, 64 Go) | Large | Environ 56 millièmes de seconde par image sur le processeur de référence de la documentation, soit environ 18 images par seconde ([source](https://github.com/ultralytics/ultralytics/blob/main/docs/en/models/yolo11.md)). | 0 € | **Le bon choix pour l'imprimante** : il lui faut une image toutes les 10 à 30 s. |
| **Pi 5 seul** | La mémoire du Pi | 67 millièmes de seconde par image dans le meilleur format (15 images/s), 126 à 147 dans un format courant (7 à 8 images/s) ([source](https://github.com/ultralytics/ultralytics/blob/main/docs/en/guides/raspberry-pi.md)). | 0 € | **Le bon point de départ pour le robot**, qui roule à 0,3 m/s au plus. |
| **Pi 5 + AI HAT+ 13 TOPS** (Hailo-8L) | Celle du Pi | 201 images/s annoncées, mais mesurées sur un PC, pas sur un Pi 5 ([source](https://github.com/hailo-ai/hailo_model_zoo/blob/master/docs/public_models/HAILO8L/HAILO8L_object_detection.rst)). | 79,80 € ([Kubii](https://www.kubii.com/en/embedded-boards/4343-kit-ai-ai-hat-raspberry-pi-3272496319608.html)) | **Le premier achat** si le Pi seul est trop lent. Il prend le port PCIe du Pi. |
| **Pi 5 + AI HAT+ 26 TOPS** (Hailo-8) | Celle du Pi | 1 036 images/s sur un PC ; environ 136 citées sur un Pi 5 ([source](https://github.com/hailo-ai/hailo_model_zoo/blob/master/docs/public_models/HAILO8/HAILO8_object_detection.rst)). | 123,48 € ([Kubii](https://www.kubii.com/fr/cartes-embarquees/4343-2136-ai-kit-ai-hat-pour-raspberry-pi-5-3272496319608.html)) | Trop pour un petit détecteur. |
| **Pi 5 + AI HAT+ 2** (Hailo-10H) | 8 Go à lui | 378 images/s sur un PC. Fait aussi tourner de petits modèles « vision + langage ». | 222,00 € ([Kubii](https://www.kubii.com/fr/cartes-embarquees/4343-2576-ai-kit-ai-hat-pour-raspberry-pi-5-3272496319608.html)) ; 198,90 € ([buyzero.de](https://buyzero.de/en/products/raspberry-pi-ai-hat-2-hailo-10h-ki-beschleuniger-8-gb-ram)) | Cher (il était à 130 $ à sa sortie, 200 $ aujourd'hui). Pas maintenant. |
| **Raspberry Pi AI Camera** (IMX500) | Dans la caméra | Environ 17 images/s ([source](https://github.com/ultralytics/ultralytics/blob/main/docs/en/integrations/sony-imx500.md)). | 80,10 € ([Kubii](https://www.kubii.com/fr/cameras-capteurs/4391-raspberry-pi-ai-camera-5056561803890.html)) | Une autre voie que le HAT : la caméra fait le travail. Moins de choix de modèles. |
| **Carte à part : Jetson Orin Nano Super** | 8 Go | Environ 219 images/s ([source](https://github.com/ultralytics/ultralytics/blob/main/docs/en/guides/nvidia-jetson.md)). | 399 $ officiel depuis juillet 2026 (249 $ avant) ([CNX Software](https://www.cnx-software.com/2026/07/22/nvidia-increases-the-price-of-jetson-modules-and-devkits-by-up-to-101/)) ; 339,96 € à 386,59 € vus en France, non datés | **Non justifié** : dix fois plus rapide que nécessaire, pour quatre fois le prix du HAT. |
| **Carte à part : mini PC** (Intel N150, 16 Go) | 16 Go | Non mesurée. | 234 € en promotion à 341,95 € ([Neozone](https://www.neozone.org/tests/je-teste-le-mini-pc-beelink-eq14-equipe-du-processeur-intel-twin-lake-n150), [LDLC](https://www.ldlc.com/en/product/PB00706216.html)) | Utile seulement s'il sert aussi à la domotique. |
| **Seconde carte graphique** dans le PC | 12 à 16 Go | — | RTX 3060 12 Go : 485 à 510 € neuve cet automne ([comparateur](https://www.comparateur-gamer.fr/prix/msi+geforce+rtx+3060+ti+ventus+3x+8+go+oc+lhr.html)), 298 € au plus bas en juillet ([gpuprix](https://gpuprix.com/fr/france/gpus/geforce-rtx-3060-12gb)) ; RTX 5060 Ti 16 Go : 612 € ([gpuprix](https://gpuprix.com/fr/france/gpus/geforce-rtx-5060-ti-16gb)) | Elle changerait surtout les **modèles de langage**. C'est une question pour Model Development, pas pour la vision. |

### Les petits modèles « vision + langage » (pour « que vois-tu ? »)

| Modèle | Taille dans Ollama | Remarque |
| --- | --- | --- |
| `moondream` (1,4 milliard de paramètres) | 829 Mo | Le plus petit. Licence Apache 2.0. |
| `gemma3` (4 milliards) | 3,3 Go | — |
| `llava` (7 milliards) | 4,5 Go | — |

Source : [liste des modèles d'Ollama](https://github.com/ollama/ollama/blob/v0.9.0/README.md). Des modèles plus récents existent ; leur taille reste à relever.

- Aucun ne tient sur la RTX 2060 **en même temps** que le modèle de langage de 7 milliards de paramètres. Le plus petit tient seul, largement.
- Leur vitesse sur un processeur sans carte graphique n'a été trouvée dans aucune source : **à mesurer**.

### Deux points à ne pas oublier

- **La licence.** Les chiffres ci-dessus viennent de la documentation d'Ultralytics, dont les modèles sont sous licence **AGPL-3.0** : ils ne peuvent pas entrer dans Jarvis. Des détecteurs de même taille sous licence Apache 2.0 existent (YOLOX, RT-DETR, D-FINE, NanoDet). Leur vitesse sera du même ordre, à mesurer.
- **La sécurité du robot ne dépend jamais de la vision.** Elle dépend de ses capteurs de distance, de son pare-chocs et de son bouton.

---

## 4. Alimentation, fusibles, batteries

### Qui mange quoi

| Appendice | Tension | Courant | Alimentation |
| --- | --- | --- | --- |
| Carte de capteurs, bouton, témoin | 5 V (USB) | faible | un chargeur USB ordinaire |
| Enceinte | 5 V (USB) | l'ampli de 3 W demande un chargeur d'au moins 2 A | un chargeur USB de 2 A |
| Caméra Wi-Fi | 5 V (USB) | faible | un chargeur USB ordinaire |
| Webcam USB | 5 V | prise sur l'ordinateur de Klipper | rien à ajouter |
| Écran tactile 2,8" ou 4,3" | 5 V (USB) | moins de 1 A | un chargeur USB |
| **Raspberry Pi 5** du robot | 5 V | **jusqu'à 5 A** | depuis la batterie, par un régulateur 5 V 5 A |
| Caméra du robot | — | alimentée par le Pi | rien à ajouter |
| **Servos du bras** (25 et 35 kg) | 6,8 à 7,4 V | **10 A au moins** ; de fortes pointes au démarrage et au blocage | **leur propre convertisseur**, derrière un fusible et la coupure de l'arrêt d'urgence ; jamais le 5 V du Pi |
| Servo MF90 de la pince | 5 à 6 V | moins de 3 A | son propre régulateur |
| Capteurs du robot | 3,3 ou 5 V | faible | l'ESP32 du robot |
| Prise Shelly, détecteur de fumée | 230 V ou pile | — | appareils certifiés, rien à câbler |

### Les pièces d'alimentation

| Pièce | Rôle | Prix relevé | Où |
| --- | --- | --- | --- |
| **Meilleur choix** : régulateur **Pololu D36V50F5** (5 V, 5,5 A) | Alimente le Pi 5 depuis la batterie du robot | 29,60 € | [RobotShop EU](https://eu.robotshop.com/products/5v-55a-step-down-voltage-regulator-d36v50f5) |
| **Moins cher, viable** : convertisseur 12 V vers 5 V 5 A, prise USB-C | Même rôle | 9,99 € | prix de la liste de pièces du projet [LeKiwi](https://github.com/SIGRobotics-UIUC/LeKiwi/blob/main/BOM.md) |
| Alimentation officielle 27 W du Pi 5 | Pour le Pi quand il est sur secteur | 11,50 € | [Kubii](https://kubii.com/en/3-raspberry-pi-micro-bit) |
| Porte-fusibles à lame en ligne + fusibles | Un fusible au plus près de la batterie | 7,99 € le lot de 3 avec 14 fusibles | [Touslesprix (vendeur Amazon)](https://www.touslesprix.com/achat,porte-fusible-voiture.html) |
| Connecteurs **XT60** | Brancher et débrancher la batterie sans se tromper de sens | 13,99 € les 10 paires | [Cdiscount](https://www.cdiscount.com/bricolage/r-prise+xt60.html) |
| Chargeur lithium 3 éléments, 12,6 V 2 A | Recharger une batterie lithium de 3 éléments | 15,89 € | [Amazon.fr](https://www.amazon.fr/Chargeur-Adaptateur-Secteur-Alimentation-Batterie/dp/B01M9I7CTR) |
| Carte de protection 3 éléments, 20 A | Protège la batterie (trop chargée, trop vidée, court-circuit) | 12,19 € le lot de 3 | [Amazon.fr](https://amazon.fr/Protection-Anti-Surcharge-Surd%C3%A9charge-Surintensit%C3%A9-Courts-Circuits/dp/B09R1LWHRG) |
| Batterie **LiFePO4 12 V 6 Ah**, protection intégrée | Une chimie plus calme que le lithium-ion, si la place le permet | 28,99 € | [Amazon.fr](https://www.amazon.fr/DCHOUSE-rechargeable-protection-camping-car-voiturette/dp/B0CPPBKL16) |
| Sac ignifugé pour la charge | Charger et ranger la batterie | 5,90 € | [Powair](https://www.powair6.com/fr/accessoires-batteries/40701-balystik-sac-ignifuge-pour-batterie-lipo-taille-s.html) |
| Alarme de tension basse (2 à 8 éléments) | Sonne avant que la batterie soit trop vide | 3,40 € | [MegaDron (Pologne)](https://megadron.pl/en/products/alarm-buzzer-lipo-li-ion-limn-li-fe-1-8s-7748.html) |
| Chargeur de modélisme **SkyRC B6neo** | Charge et équilibre tous les types de batteries | 45,90 € (modèle exact à confirmer) | [fpv24](https://www.fpv24.com/en/skyrc/skyrc-b6neo-charger-charger-lipo-1-6s-10a-200w) |
| Contacts à ressort pour la base de recharge | Le robot se pose dessus | prix à vérifier | — |

### La batterie du robot : ce qu'il faut savoir avant d'acheter

Le dépôt ne dit pas quelle batterie a le robot. Son programme de test annonce 11,8 V, ce qui ressemble à une batterie lithium de trois éléments : **à confirmer** (décision A10). Tant que ce n'est pas su, on n'achète ni chargeur ni base.

Les règles, quel que soit le choix :

1. **Un fusible au plus près de la batterie**, un par branche ([Libre Solar](https://github.com/LibreSolar/learn.libre.solar/blob/main/docs/system/wires_fuses.md)). Sa valeur se calcule à partir du courant que le robot mesure déjà.
2. **Une carte de protection** qui surveille la tension, le courant et la température : une batterie lithium trop chargée ou trop vidée peut s'emballer ([Libre Solar](https://github.com/LibreSolar/learn.libre.solar/blob/main/docs/system/battery.md)).
3. **Le bon chargeur pour la bonne chimie.** 12,6 V pour trois éléments lithium-ion ; 14,6 V pour une LiFePO4 de 12 V. Ils ne s'échangent pas.
4. **Charge surveillée, dans un sac ignifugé**, jamais la nuit, jamais sur du bois ou du tissu ([règles RoboCupJunior](https://github.com/robocup-junior/general-rules/blob/master/general-rules.adoc)).
5. **La batterie est fixée**, ses fils ne frottent nulle part, et **une coupure d'urgence est à portée de main** sur le robot (mêmes règles).
6. **Le retour à la base et la recharge automatique viennent en dernier.** Au début, on branche le chargeur à la main et on reste à côté.

### L'imprimante et le 230 V

- La caméra et l'éclairage se branchent en USB, jamais sur la carte de l'imprimante.
- La prise connectée se met **entre le mur et l'imprimante**. Couper le courant en pleine impression est le **dernier recours** : le ventilateur de la tête s'arrête aussi.
- Jarvis ne touche au 230 V que par des appareils du commerce, certifiés, montés selon leur notice.

---

## 5. Les outils

Si l'utilisateur n'a rien. Tout ce qu'il possède déjà se retire de la liste (décision A11).

| Outil | Le bon choix | Le moins cher qui reste fiable |
| --- | --- | --- |
| **Fer à souder** | Miniware **TS101** avec son alimentation : 94,78 € ([Amazon.fr](https://www.amazon.fr/MINIWARE-TS101-portable-Chauffage-Temp%C3%A9rature/dp/B0CPD1QXHT)) ; ou **Pinecil V2** : 67,50 € ([Pine64 EU](https://pine64eu.com/product-tag/pinecil/)) + chargeur 65 W : 23,99 € ([Amazon.fr](https://www.amazon.fr/FORCE-POWER-Chargeur-Delivery-Garanti/dp/B0BRWLFBC4)) | Station **YIHUA 926LED III** en kit (avec étain sans plomb, pannes et deux supports) : 50,99 € ([Amazon.fr](https://www.amazon.fr/YIHUA-926LED-III-60W-automatique/dp/B0CMLN63JZ)) |
| **Étain sans plomb** 0,7 mm, 100 g | Gotronic ESP007/100 : 19,40 € ([Gotronic](https://www.gotronic.fr/art-soudure-esp007-100-7476.htm)) | Stannol : 13,51 € ([Amazon.fr](https://www.amazon.fr/souder-Stannol-648104-Sn99-3Cu0-7-bobine/dp/B07QV9YYPQ), article exact à confirmer) |
| Pompe et tresse à dessouder | Pompe Gotronic PPD05N : 6,80 € ([Gotronic](https://www.gotronic.fr/art-pompe-a-dessouder-ppd05n-34818.htm)) ; tresse Velleman : 5,54 € ([Amazon.fr](https://www.amazon.fr/Tresse-dessouder-largeur-Longueur-m%C3%A8tre/dp/B0015A38L2)) | Pompe PPD01 : 3,70 € ([Gotronic](https://www.gotronic.fr/art-pompe-a-dessouder-ppd01-7402.htm)) |
| **Multimètre** | **UNI-T UT139C** : 47,69 € ([Amazon.fr](https://www.amazon.fr/UNI-T-UT139C-True-Multim%C3%A8tres-Num%C3%A9riques/dp/B00PY3V6O2)) | **ANENG AN8008** : 20,67 € ([Banggood](https://usa-m.banggood.com/ANENG-AN8008-True-RMS-Wave-Output-Digital-Multimeter-AC-DC-Current-Volt-Resistance-Frequency-Capacitance-Test-p-1157985.html), port et taxes non vus) |
| **Pince coupante** fine | Knipex 78 61 125 : 33,78 € ([Amazon.fr](https://www.amazon.fr/Knipex-78-61-125-Electronics-Super-Knips-Comfort/dp/B0048F601Q)) | Plato 170 : 11,58 € ([Amazon.fr](https://www.amazon.fr/%C3%89lectrique-Diagonale-Pr%C3%A9cision-Imprimante-Traitement/dp/B08BZQX91Y)) |
| Pince à dénuder | Knipex 12 62 180 : 35,99 € ([Reichelt](https://www.reichelt.com/de/en/stripping-pliers-0-2-to-6-mm--kn-12-62-180-p60331.html?r=1)) | Jokari Super 4 Pro : 28,65 € ([Amazon.fr](https://www.amazon.fr/Pince-d%C3%A9nuder-automatique-Jokari-8203200/dp/B084S5ZMX8)) |
| Pince à sertir + connecteurs | Engineer PA-09 : 46,90 € ([Gotronic](https://www.gotronic.fr/art-pince-a-sertir-pa-09-22718.htm)) | SN-28B : 20,49 € ([Amazon.fr](https://www.amazon.fr/Broco-SN-28B-Socket-Terminal-sertir/dp/B081NN12TB)) ; coffret Dupont : 18,79 € ([Amazon.fr](https://www.amazon.fr/610pcs-2-54mm-Coffret-Connecteur-Femelle/dp/B074W6LTXQ)) |
| **Fils Dupont** (120 fils) | 8,99 € ([Amazon.fr](https://www.amazon.fr/Dupont-Breadboard-M%C3%A2le-Femelle-M%C3%A2le-M%C3%A2le-Femelle-Femelle/dp/B0DFCT8RZ7)) | — |
| **Plaque d'essai** sans soudure | 5,90 € ([Gotronic](https://www.gotronic.fr/art-plaque-de-montage-rapide-6859.htm)) | — |
| Fil souple silicone (plusieurs couleurs) | 35,28 € ([Amazon.fr](https://www.amazon.fr/-/en/BNTECHGO-SW22G60008F25C7/dp/B08FMD7K7H)) | 14,24 € en promotion ([Amazon.fr](https://www.amazon.fr/Fil-d%C3%A9lectronique-calibre-Caoutchouc-temp%C3%A9ratures/dp/B07PWCNP9Z)) |
| **Gaine thermorétractable** | Coffret 328 pièces : 13,89 € ([Amazon.fr](https://www.amazon.fr/thermor%C3%A9tractable-pi%C3%A8ces-assortiment-couleur-m%C3%A9lang%C3%A9e/dp/B09BVRJHT7)) | Assortiment 63 pièces : 7,49 € ([Leroy Merlin](https://www.leroymerlin.fr/produits/electricite-et-domotique/rallonge-multiprise-enrouleur-et-cable-electrique/accessoires-de-connexion-boite-de-derivation/accessoires-de-electricite/assortiment-gaine-thermoretractable-p.html)) |
| Support de carte avec loupe | 29,99 € ([Amazon.fr](https://www.amazon.fr/MMOBIEL-Troisi%C3%A8me-Robuste-Support-soutien/dp/B07WF7GXS1)) | 15,89 € ([Amazon.fr](https://www.amazon.fr/Troisi%C3%A8me-Loupe-Support-SOUDER-Royaume/dp/B009GD0MWI)) |
| Tapis de soudure | 26,95 € ([Amazon.fr](https://www.amazon.fr/Velleman-r%C3%A9sistant-antistatique-compartiments-magn%C3%A9tiques/dp/B079Y7TL2Y)) | 14,49 € ([Amazon.fr](https://www.amazon.fr/MMOBIEL-Antistatique-antid%C3%A9rapant-Silicone-r%C3%A9paration/dp/B08XVZTF3P)) |
| **Lunettes de protection** | Uvex i-3 : 13,70 € ([Amazon.fr](https://www.amazon.fr/Uvex-Lunettes-Protection-gris-clair/dp/B00JDKAPPS)) | Uvex i-works : 11,15 € ([Amazon.fr](https://www.amazon.fr/s%C3%A9curit%C3%A9-lunettes-166-avec-protection-Lunettes/dp/B076ZWQTC4)) |
| Aspirateur de fumée de soudure | 46,99 € ([Amazon.fr](https://www.amazon.fr/Extraction-Aspirateur-Pr%C3%A9vention-Extracteur-Ventilateur/dp/B0BCPLMLS4)) | 30,56 € ([Amazon.fr](https://www.amazon.fr/dp/B0H2MK4JGL)) |
| Tournevis de précision | iFixit Mako : 39,95 € ([iFixit](https://www.ifixit.com/en-eu/products/mako-driver-kit-64-precision-bits)) | prix à vérifier |
| Visserie M3 (coffret inox) | 12,73 € ([Amazon.fr](https://www.amazon.fr/Cylindrique-Inoxydable-Serrage-Assortis-Utilis%C3%A9s/dp/B0C4T1BTNN)) | — |
| Inserts en laiton M3 pour pièces imprimées (lot de 100) | prix en euros à vérifier (8,90 CHF en Suisse, [3DJake.ch](https://www.3djake.ch/fr-CH/ruthex/inserts-filetes-m3-lot-de-100)) | — |
| **Extincteur** à poudre 1 kg | Kidde : 29,90 € ([Castorama](https://www.castorama.fr/extincteur-polyvalent-kidde-1-kg-abc/0090008462726_CAFR.prd)) | 13,90 € ([Carter-Cash](https://www.carter-cash.com/accessoires/p/extincteur-1-kg-autobest-homologue-classe-abc-avec-manometre-29254781)) |
| Couverture anti-feu, alimentation de laboratoire, pied à coulisse, wattmètre de prise, chargeur d'accus | prix à vérifier (non cherchés) | — |

**Les deux trousses de départ**

- **La moins chère** : station YIHUA en kit (50,99 €), multimètre AN8008 (20,67 €), pince coupante Plato (11,58 €), fils Dupont (8,99 €), plaque d'essai (5,90 €), gaine (7,49 €), lunettes (11,15 €). **Total : 116,77 €.**
- **La bonne** : fer TS101 avec alimentation (94,78 €), multimètre UT139C (47,69 €), pince Knipex (33,78 €), étain (19,40 €), fils Dupont (8,99 €), plaque d'essai (5,90 €), gaine (13,89 €), lunettes (13,70 €), support avec loupe (29,99 €), tapis (26,95 €). **Total : 295,07 €.**

Le multimètre et le fer sont les deux seuls outils vraiment indispensables. L'alimentation de laboratoire et la pince à sertir peuvent attendre.

**Filament pour l'Ender 3 S1 Plus**

| Matière | Pour quoi | Prix relevé (1 kg) | Où |
| --- | --- | --- | --- |
| PLA | Boîtiers, supports loin de la chaleur | prix à vérifier (non cherché) | — |
| **PETG** | Tout ce qui est sur ou près de l'imprimante, et sur le robot | 12,99 € (eSUN) ; 15,95 € (Sunlu) | [3DJake.fr](https://www.3djake.fr/esun/esun-filaments-petg-basic), [Powerplanet](https://www.powerplanetonline.com/fr/filament-sunlu-petg-noir-175mm-bobine-de-1kg) |
| **TPU 95A** | Les mors souples de la pince, les patins | prix en euros à vérifier | — |

---

## 6. Ce qui s'imprime sur l'Ender 3 S1 Plus

Son plateau de 300 × 300 mm et sa tête à entraînement direct suffisent pour tout ce qui suit. D'après les guides consultés, elle imprime le PLA, le PETG et le TPU sans modification ([Clever Creations](https://clevercreations.org/creality-ender-3-s1-plus-review-specs/), [SimplyPrint](https://simplyprint.io/compatibility/creality-ender-3-s1-plus)) ; à confirmer dans sa notice.

| À imprimer | Matière |
| --- | --- |
| Support de la caméra et de l'éclairage de l'imprimante | PETG |
| Boîtier de la carte de capteurs (avec des fentes : un capteur de température enfermé ment) | PLA ou PETG |
| Boîtier de la caméra de bureau, avec volet coulissant et logement du témoin | PLA |
| Pince du robot ; mors | PETG ; TPU |
| Supports de la caméra, des capteurs de distance et du pare-chocs du robot | PETG |
| Base du robot, guides d'entrée | PETG |
| Boîtier et pied du panneau d'atelier ; boîtier du bouton « Tout arrêter » | PLA |
| Boîtier d'enceinte (un générateur existe déjà sur la branche `claude/boitier-enceinte-v2`) | PLA |
| Pièces du bras SO-101 (prévues pour un plateau de 220 × 220 mm) | PLA+ |

**Ce qui ne s'imprime pas** : rien qui enferme du 230 V ; pas de boîtier fermé autour d'une batterie au lithium (elle doit pouvoir être vue, touchée et débranchée).

---

## 7. Récapitulatif par ordre de priorité

Les étapes sont celles du cahier (`docs/specs/jarvis-development.md`, section 6). Les totaux sont **hors frais de port** (sauf mention) et **hors pièces marquées « prix à vérifier »**. Ce sont des relevés du 17 novembre 2026, à revérifier.

| Étape | Moins cher, viable | Meilleur choix |
| --- | --- | --- |
| **0. Le socle** | 0 € | 0 € |
| **1. L'imprimante sous surveillance** | Webcam C270 (19,99) + prise Shelly Plug S Gen3 (23,68) + détecteur Heiman (18,99) + récepteur Zigbee (16,00) = **78,66 €** | Webcam C920s (59,99) + prise Shelly Plug S Gen3 (23,68) + Shelly Plus Smoke (49,89) = **133,56 €** |
| **2. Couper Jarvis sur le PC** | **0 €** (logiciel) | **0 €** d'abord ; haut-parleur-micro USB seulement si la mesure est mauvaise : 48,49 € à 113,22 € |
| **3. Les sens** | Lot de 5 cartes ESP32-C3, port compris (20,44) + SHT40 (6,90) = **27,34 €** | Le même + capteur de CO2 SCD40 (42,60) = **69,94 €**, + radar de présence (prix à vérifier) |
| **4. Les mains sur la maison** | 1 prise Shelly Plug S Gen3 = **23,68 €** | 2 prises = **47,36 €** |
| **5. Le robot voit et se protège** | Caméra OV5647 (12,95) + nappe (1,32) + 2 capteurs HC-SR04 (7,80) + MPU6050 (5,80) + bouton d'arrêt d'urgence (15,59) = **43,46 €** | Camera Module 3 Wide (39,90) + nappe (1,32) + VL53L5CX (20,90) + BNO085 (34,50) + bouton d'arrêt d'urgence (15,59) = **112,21 €** |
| **6. Le bras** (servos de 25 et 35 kg déjà achetés ; relevés du 18 novembre) | PCA9685 (6,00) + convertisseur réglable (15,95) + régulateur du MF90 (5,95) + porte-fusibles (7,99) + relais (13,29) + support de relais (10,85) = **60,03 €** | PCA9685 de marque (13,56) + convertisseur réglable (24,99) + régulateur Hobbywing (12,95) + porte-fusibles (7,99) + relais (13,29) + support de relais (10,85) = **83,63 €** |
| **7. Couper Jarvis depuis l'enceinte** | **0 €** (essai en logiciel sur la carte actuelle) | Kit ReSpeaker Lite = **29,95 €** |
| **8. Le robot rentre et se recharge** | non chiffré : dépend de la batterie actuelle | non chiffré |
| **Total des étapes 1 à 7** | **233,17 €** | **476,65 €** |
| Outils, si rien n'est déjà là | 116,77 € | 295,07 € |
| **Total général** | **349,94 €** | **771,72 €** |

Ce que les totaux ne comptent pas, faute de prix relevé : l'éclairage de l'imprimante, le servo MF90 du bras s'il n'est pas déjà là, le fil et les rallonges du bras, les micro-interrupteurs, le filament (PETG : 16,99 € HT à 28,75 € le kilo ; TPU), le radar de présence, le contact de porte, les contacts de recharge. Ce sont de petites pièces ; compter une marge de 30 à 50 €.

Le **minimum pour commencer** : une webcam et une prise, **43,67 €**.

Plus tard, hors total : une enceinte de plus (environ 29 € de pièces), le panneau d'atelier (17,95 € à 49,00 €), l'onduleur (89,90 € à 124,99 €), Home Assistant (0 € en machine virtuelle, sinon 137,50 € à 179,00 €), le capteur laser tournant (81,12 €), le module IA du Pi (79,80 €), le bras de bureau (124,30 € de pièces).

---

## 8. Licences relevées

Lues le 17 novembre 2026 sur la page de chaque projet, sauf mention « non revérifié ».

**Rappel des règles** (cahier, section 10) : ouvert seulement ; un programme GPL ou AGPL ne tourne que **à côté** de Jarvis, comme programme séparé ; un modèle « non commercial » n'entre pas dans Jarvis.

| Projet | À quoi il sert | Licence | Remarque |
| --- | --- | --- | --- |
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics/blob/main/LICENSE) | Détecter des objets | **AGPL-3.0** | **À ne pas intégrer.** |
| [Obico](https://github.com/TheSpaghettiDetective/obico-server) | Repérer une impression ratée | **AGPL-3.0** | **À ne pas intégrer.** Peut servir d'exemple à étudier. |
| [YOLOX](https://github.com/Megvii-BaseDetection/YOLOX), [RT-DETR](https://github.com/lyuwenyu/RT-DETR), [D-FINE](https://github.com/Peterande/D-FINE), [NanoDet](https://github.com/RangiLyu/nanodet) | Détecter des objets | Apache-2.0 | Les candidats pour Jarvis. |
| [moondream](https://github.com/vikhyat/moondream) | Décrire une image | Apache-2.0 | Fiche du modèle non relue. |
| Qwen2.5-VL 3B | Décrire une image | « Qwen Research License », non commerciale | **Non revérifié.** À écarter tant que ce n'est pas relu. |
| Florence-2 | Décrire une image, lire du texte | MIT | **Non revérifié.** |
| [OpenCV](https://github.com/opencv/opencv) | Traiter des images | Apache-2.0 | — |
| [AprilTag](https://github.com/AprilRobotics/apriltag/blob/master/LICENSE.md) | Repères visuels | BSD 2 clauses | — |
| [picamera2](https://github.com/raspberrypi/picamera2) | Caméra du Pi | BSD 2 clauses | — |
| [crowsnest](https://github.com/mainsail-crew/crowsnest), [ustreamer](https://github.com/pikvm/ustreamer), [camera-streamer](https://github.com/ayufan/camera-streamer) | Servir la webcam de Klipper | **GPL-3.0** | Programmes séparés, sur l'imprimante : Jarvis ne fait que lire l'image. |
| [go2rtc](https://github.com/AlexxIT/go2rtc), [MediaMTX](https://github.com/bluenviron/mediamtx), [Frigate](https://github.com/blakeblackshear/frigate) | Flux de caméras | MIT | — |
| [HailoRT](https://github.com/hailo-ai/hailort), [Hailo Model Zoo](https://github.com/hailo-ai/hailo_model_zoo) | Module IA du Pi | MIT | Les modèles YOLO du zoo viennent d'Ultralytics. |
| [LeRobot](https://github.com/huggingface/lerobot/blob/main/LICENSE), [SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100/blob/main/LICENSE) | Bras de bureau | Apache-2.0 | — |
| [feetech-servo-sdk](https://github.com/Adam-Software/FEETECH-Servo-Python-SDK) | Parler aux servos à bus | Unlicense (domaine public) | — |
| [Nav2](https://github.com/ros-navigation/navigation2/blob/main/LICENSE) | Navigation du robot | Apache-2.0, BSD, et **LGPL-2.1** pour une partie | Programme séparé sur le Pi. |
| [slam_toolbox](https://github.com/SteveMacenski/slam_toolbox) | Carte de la pièce | **LGPL-2.1** | Programme séparé sur le Pi. |
| [ESP-IDF](https://github.com/espressif/esp-idf/blob/master/LICENSE) | Base des programmes ESP32 | Apache-2.0 | Déjà utilisé par l'enceinte. |
| [ESP-SR](https://github.com/espressif/esp-sr/blob/master/LICENSE) | Mot de réveil et annulation d'écho sur ESP32 | « Espressif MIT » : **réservé aux puces Espressif** | Convient : nos cartes en sont. Déjà utilisé par l'enceinte. |
| [microWakeWord](https://github.com/OHF-Voice/micro-wake-word/blob/main/LICENSE) | Mot de réveil sur ESP32 | Apache-2.0, modèles compris | — |
| [openWakeWord](https://github.com/dscripka/openWakeWord) | Mot de réveil (déjà dans Jarvis) | Code Apache-2.0 ; **modèles fournis : CC BY-NC-SA 4.0** | Voir la remarque ci-dessous. |
| [Smart Turn](https://github.com/pipecat-ai/smart-turn) | Savoir que la phrase est finie | BSD 2 clauses, modèle compris | 23 langues dont le français, environ 8 Mo. |
| [Pipecat](https://github.com/pipecat-ai/pipecat/blob/main/LICENSE) | Conversation en temps réel | BSD 2 clauses | — |
| [LiveKit Agents](https://github.com/livekit/agents/blob/main/LICENSE) | Conversation en temps réel | Apache-2.0 | Son modèle de fin de tour a une licence à part, non lue. |
| [Silero VAD](https://github.com/snakers4/silero-vad/blob/master/LICENSE) | Détecter la voix | MIT | — |
| [LVGL](https://github.com/lvgl/lvgl/blob/master/LICENCE.txt) | Interfaces sur petits écrans | MIT | — |
| [Home Assistant](https://github.com/home-assistant/core/blob/dev/LICENSE.md) | Domotique | Apache-2.0 | Programme séparé. |
| [ESPHome](https://github.com/esphome/esphome/blob/dev/LICENSE) | Programmes de capteurs tout faits | **GPL-3.0** pour la partie embarquée | Non retenu : on écrit le programme des capteurs sur la base de celui de l'enceinte. |
| [Zigbee2MQTT](https://github.com/Koenkk/zigbee2mqtt/blob/master/LICENSE) | Parler aux appareils Zigbee | **GPL-3.0** | Programme séparé. |
| [Mosquitto](https://github.com/eclipse-mosquitto/mosquitto/blob/master/LICENSE.txt) | Messagerie entre programmes | EPL-2.0 ou BSD | Programme séparé. |
| [MQTT.js](https://github.com/mqttjs/MQTT.js/blob/main/LICENSE.md) | Parler à Mosquitto depuis Jarvis | MIT | Sans dépendance native. |
| [matter.js](https://github.com/matter-js/matter.js/blob/main/LICENSE) | Appareils Matter, en local | Apache-2.0 | — |
| [Network UPS Tools](https://github.com/networkupstools/nut/blob/master/COPYING) | Lire un onduleur | **GPL-2.0 ou plus** | Pas nécessaire si Windows voit déjà l'onduleur. |

**Deux remarques qui concernent ce qui existe déjà** (rien n'a été modifié) :

- Les **modèles fournis avec openWakeWord** (dont « hey jarvis », utilisé sur le PC et sur le robot) sont sous licence CC BY-NC-SA 4.0 : usage **non commercial**. Sans conséquence pour un usage personnel. À savoir si Jarvis devait un jour être vendu ; `CLAUDE.md` indique seulement « Apache 2.0 », ce qui est vrai du code, pas des modèles.
- Le dépôt d'origine de **Piper** (la voix locale) a été archivé en octobre 2025 ; son successeur est sous **GPL-3.0**. Jarvis utilise l'ancienne version, sous licence MIT, comme programme séparé : rien à changer, mais une mise à jour de Piper demandera de regarder ce point.
