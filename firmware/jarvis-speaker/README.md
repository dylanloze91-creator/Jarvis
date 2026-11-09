# Enceinte Jarvis — monter sa propre enceinte (guide pas à pas)

Tu veux parler à Jarvis depuis le salon ou la cuisine, sans aller devant le PC ni sortir ton téléphone.
Ce guide explique comment fabriquer une petite enceinte qui écoute le mot « Jarvis », envoie ta phrase
au PC par le Wi-Fi de la maison, et lit la réponse à voix haute.

**Le cerveau reste sur le PC.** La carte ne comprend qu'un seul mot (« Jarvis ») ; tout le reste
(comprendre la phrase, réfléchir, parler) se passe sur ton ordinateur, comme d'habitude. Rien ne sort
de chez toi. Le PC doit rester allumé avec Jarvis ouvert.

Il faut compter une après-midi la première fois, sans rien souder : tout se branche avec des petits
fils. Aucune connaissance en programmation n'est nécessaire, il suffit de suivre les étapes dans l'ordre.

> Pas encore le matériel ? Tu peux déjà vérifier que le PC est prêt avec la « fausse enceinte »
> (voir tout en bas, « Essayer sans matériel »).

---

## 1. La liste d'achat

| Quoi | Référence exacte | À quoi ça sert | Prix indicatif |
| --- | --- | --- | --- |
| La carte (le petit ordinateur) | **ESP32-S3-DevKitC-1-N8R8** (Espressif) | Écoute « Jarvis », parle au PC par Wi-Fi. Les lettres comptent : **N8R8** = 8 Mo de mémoire flash + 8 Mo de mémoire vive (PSRAM). Une « N16R8 » marche aussi. Évite N8, N8R2, et les cartes « ESP32 » tout court ou « ESP32-C3 ». | 15 – 20 € |
| Le micro | **INMP441** (module I2S, 6 broches) | Entend ta voix. Prends la petite platine toute faite (environ 1 × 1,5 cm). | 3 – 5 € |
| L'ampli | **MAX98357A** (module I2S, ex. Adafruit n° 3006 ou copie) | Transforme la réponse en son pour le haut-parleur. | 5 – 8 € |
| Le haut-parleur | **4 Ω, 3 W**, 5 cm environ (ex. Adafruit n° 1314, Visaton K 50) | Fait entendre Jarvis. Deux fils à visser ou à clipser sur l'ampli. | 3 – 8 € |
| Les fils | **Fils Dupont femelle-femelle**, lot de 40 (10 ou 20 cm) | Relient micro et ampli à la carte, sans soudure. | 3 € |
| Le câble USB | **USB-A vers Micro-USB, « données »** (pas « charge seule ») | Branche la carte au PC pour y envoyer le programme, puis l'alimente. | 3 – 5 € |
| L'alimentation (ensuite) | **Chargeur USB 5 V, 1 A ou plus** | Pour laisser l'enceinte branchée dans la pièce, loin du PC. | déjà à la maison |

Facultatif : une petite boîte (carton, bois, impression 3D) pour tout ranger, et une plaque d'essai
(« breadboard ») si tu préfères piquer les broches au lieu d'utiliser des fils femelle-femelle.

**Attention aux cartes copiées.** Beaucoup de vendeurs proposent des « ESP32-S3 DevKitC-1 » qui ne
sont pas d'Espressif. Elles marchent en général très bien, mais vérifie bien **N8R8** ou **N16R8** dans
le nom, et sache que leur petite LED de couleur est parfois sur une autre broche (voir « Si ça ne
marche pas »).

---

## 2. Le câblage, broche par broche

La carte a deux rangées de broches, avec le nom écrit à côté de chacune (« 3V3 », « GND », « 4 », « 5 »…).
Les modules micro et ampli ont aussi leurs noms écrits. Un fil Dupont femelle-femelle relie une broche de
la carte à une broche d'un module. **Débranche la carte de l'USB pendant que tu câbles.**

### Le micro INMP441

| Broche du micro | → | Broche de la carte | Rôle |
| --- | --- | --- | --- |
| **VDD** | → | **3V3** | alimentation 3,3 V (**jamais 5V** : le micro grillerait) |
| **GND** | → | **GND** | masse |
| **SCK** | → | **4** | horloge |
| **WS** | → | **5** | horloge gauche/droite |
| **SD** | → | **6** | le son |
| **L/R** | → | **GND** | choisit le canal « gauche » (obligatoire) |

### L'ampli MAX98357A

| Broche de l'ampli | → | Broche de la carte | Rôle |
| --- | --- | --- | --- |
| **Vin** | → | **5V** | alimentation 5 V (l'ampli a besoin de puissance) |
| **GND** | → | **GND** | masse |
| **BCLK** | → | **15** | horloge |
| **LRC** | → | **16** | horloge gauche/droite |
| **DIN** | → | **17** | le son |
| **GAIN** | — | rien | laissé en l'air : volume moyen (9 dB) |
| **SD** | — | rien | laissé en l'air : ampli toujours allumé |

Le haut-parleur se branche sur les deux bornes **+** et **−** de l'ampli (à visser, ou à souder si le
module n'a pas de bornier). Le sens n'a pas d'importance pour un seul haut-parleur.

### Carte copiée « XH-S3E » (ou autre) : la broche 5V peut être morte

Sur beaucoup de copies (dont la « XH-S3E » N16R8), la broche **5V** n'est **pas** reliée à l'USB tant
que deux petites pastilles marquées **« IN-OUT »** (au dos ou près de la LED, à côté des broches 10-11)
ne sont pas reliées par un point de soudure. Sans ce pont, l'ampli n'est pas alimenté : aucun son, et au
multimètre les fils BCLK/LRC restent vers 0,3 V au lieu de 1,6 V.

- Test : carte branchée en USB, multimètre en **20 V continu** (V⎓), pointe noire sur **GND**, rouge sur
  **5V**. Moins de 1 V = pont manquant.
- Réparation : une goutte d'étain qui relie les deux pastilles « IN-OUT ». Après : environ **4,5 V**
  (normal, une diode prend un demi-volt).

### Vérifications avant de brancher

- Deux fils GND partent de la carte (un pour le micro, un pour l'ampli) : la carte a plusieurs broches
  GND, utilise-en deux différentes ou chaîne-les, peu importe.
- Le micro est bien sur **3V3**, l'ampli sur **5V**.
- Aucun fil nu ne touche un autre.

Les numéros de broches sont dans `include/config.h` (section « Micro » et « Ampli ») : si tu dois
changer un branchement, change le numéro en face, c'est tout.

---

## 3. Installer l'outil qui envoie le programme sur la carte (Windows)

On utilise **Visual Studio Code** (un éditeur gratuit) avec l'extension **PlatformIO**, qui sait
télécharger tout le nécessaire pour la carte et lui envoyer le programme.

1. Installe **Visual Studio Code** : [code.visualstudio.com](https://code.visualstudio.com/) → bouton
   « Download for Windows », puis suivant, suivant.
2. Installe **Python** s'il manque : [python.org/downloads](https://www.python.org/downloads/) → « Download
   Python 3.x ». À la première fenêtre, **coche « Add python.exe to PATH »** avant de cliquer sur
   « Install Now ». (PlatformIO en a besoin.)
3. Ouvre VS Code. À gauche, clique sur l'icône des **Extensions** (quatre petits carrés), tape
   `PlatformIO IDE`, clique sur **Install**. Attends le message « PlatformIO IDE installed » en bas à
   droite (quelques minutes), puis **redémarre VS Code** si on te le demande.
4. Une icône en forme de **tête de fourmi** (PlatformIO) apparaît dans la barre de gauche. C'est bon.

Ensuite, ouvre le dossier du programme de l'enceinte : **Fichier → Ouvrir le dossier…**, puis choisis
le dossier `firmware\jarvis-speaker` du projet Jarvis (celui qui contient le fichier `platformio.ini`).

> Première ouverture : PlatformIO télécharge l'outillage pour l'ESP32-S3 (environ 1 à 2 Go). Laisse-le
> finir ; la barre en bas indique l'avancement.

Le pilote USB : branche la carte avec le câble sur la prise marquée **« UART »** ou **« COM »** selon la
carte (elle en a deux ; l'autre s'appelle « USB »). Windows 10 et 11 installent le pilote tout seuls. Si
la carte n'apparaît pas plus tard (Gestionnaire de périphériques → « Ports (COM et LPT) »), regarde la
petite puce à côté de cette prise : **CP2102** → pilote « CP210x Universal Windows Driver » (Silicon
Labs) ; **CH343** ou **CH340** (fréquent sur les copies) → pilote « CH343SER » de WCH (wch-ic.com).

---

## 4. Remplir `secrets.h` (le mot de passe Wi-Fi et la clé de l'enceinte)

Ce fichier est **personnel** : il contient ton Wi-Fi et la clé qui prouve au PC que c'est bien ton
enceinte. Il reste sur ton ordinateur, il n'est jamais partagé.

1. Sur le PC, ouvre Jarvis (version **5.0.64** ou plus) → **Réglages → Enceintes** (depuis la 5.0.70 :
   **Réglages → Services → Enceintes**).
2. Active l'interrupteur **« Enceintes »**. La première fois, Windows demande si Jarvis peut recevoir des
   connexions : **coche « Réseaux privés »** et clique sur **Autoriser**. (Si tu as cliqué trop vite sur
   Annuler, voir « Si ça ne marche pas ».)
3. Note l'**adresse de ce PC** affichée (par exemple `192.168.1.20`).
4. Dans « Ajouter une enceinte », tape le nom de la pièce (**Salon**) et clique sur **Ajouter**. Jarvis
   affiche un bloc de texte qui commence par `// Enceinte Jarvis` : clique sur **« Copier le bloc »**.
   Ce bloc n'est montré **qu'une seule fois** (si tu le perds, retire l'enceinte et ajoute-la à nouveau).
5. Dans VS Code, dans le dossier `include`, fais un clic droit → **Nouveau fichier** → nomme-le
   exactement `secrets.h`. Colle le bloc dedans.
6. Remplace `A_REMPLIR` par le **nom de ton Wi-Fi** et son **mot de passe**, entre les guillemets :

```c
#define WIFI_SSID        "Livebox-1234"
#define WIFI_PASSWORD    "monmotdepasse"
```

7. Enregistre (**Ctrl + S**).

Le Wi-Fi doit être en **2,4 GHz** : la carte ne voit pas le 5 GHz. Si ta box a un seul nom pour les
deux, c'est bon ; si elle a deux noms (« …-5G » et l'autre), prends l'autre.

Le fichier `include/secrets.example.h` montre à quoi doit ressembler le résultat.

---

## 5. Envoyer le programme sur la carte

1. Branche la carte au PC (prise **UART** ou **COM**).
2. En bas de VS Code, dans la barre bleue, clique sur la **flèche →** (« PlatformIO: Upload »).
3. La première fois, ça compile longtemps (5 à 10 minutes : il télécharge aussi le modèle du mot
   « Jarvis »). Les fois suivantes, une minute.
4. À la fin, la fenêtre affiche `SUCCESS`. La carte redémarre toute seule.

Si l'envoi s'arrête sur `Connecting........_____` : maintiens le bouton **BOOT** de la carte appuyé,
appuie une fois sur **RESET** (ou « RST »), relâche **BOOT**, puis relance la flèche.

Le programme écrit deux choses sur la carte : le programme lui-même et le **modèle du mot « Jarvis »**
(dans une zone à part de la mémoire). C'est automatique (`flash_models.py`).

---

## 6. Premier essai

1. Clique sur la **prise électrique** dans la barre bleue (« PlatformIO: Serial Monitor ») : c'est le
   **journal** de la carte, il raconte ce qu'elle fait, en français.
2. Tu dois voir, dans l'ordre : `audio prêt`, `micro : bruit de fond 40 (seuil de parole SPEECH_RMS = 393)`
   (le chiffre dépend de ta pièce : en dessous de 150 c'est parfait), `mot de réveil : wn9_jarvis_tts`, `Wi-Fi connecté, adresse
   192.168.1.xx`, `PC trouvé : Jarvis 5.0.64`, puis **`prêt : dis « Jarvis »`**.
3. Dis « **Jarvis** » à voix normale, à un ou deux mètres. La carte fait un petit **bip** et la LED passe
   au **vert** : elle écoute. Tu n'as pas besoin d'attendre le bip : « Jarvis, quelle heure est-il ? »
   dit d'une traite marche aussi. (Le bip se coupe avec `WAKE_BEEP 0` dans `config.h`.)
4. Pose ta question (« quelle heure est-il ? »). Quand tu t'arrêtes de parler, la LED **bleue clignote**
   (la phrase est partie au PC), puis Jarvis répond dans le haut-parleur.
5. Après la réponse, tu as quelques secondes (8 par défaut, réglable dans Réglages → Voix) pour enchaîner
   **sans redire « Jarvis »**. Si tu ne dis rien, la LED s'éteint : retour en veille.

Sans VS Code, le même journal se lit avec `python outils/journal_enceinte.py COM5` (ton numéro de
port) : il redémarre la carte, écoute deux minutes, enregistre tout dans `journal-enceinte.txt` et
termine par un bilan « OK / NON » avec quoi faire pour chaque ligne en NON.

Sur le PC, la discussion apparaît dans l'historique avec le nom de la pièce devant : « Salon · quelle
heure est-il ». Dans Réglages → Enceintes, la ligne de l'enceinte indique « Dernière phrase à l'instant ».

Pour la laisser dans la pièce : débranche-la du PC et branche-la sur un chargeur USB. Elle se connecte
seule au Wi-Fi au démarrage (compte 10 à 20 secondes).

**Ce que l'enceinte ne fait pas** : les actions qui demandent ton accord (créer un dossier, envoyer un
mail, fermer un programme…). Elle n'a pas d'écran pour te montrer la carte de confirmation, alors Jarvis
répond : « Pour ça, il me faut ton accord : demande-le-moi sur le PC ou le téléphone. » C'est voulu.

---

## 7. Si ça ne marche pas

### Ce que dit la LED

| LED | Ça veut dire |
| --- | --- |
| **orange** fixe | démarrage en cours (quelques secondes) |
| **éteinte** | veille : elle attend « Jarvis » |
| **verte** | elle écoute ta phrase |
| **bleue qui clignote** | la phrase est partie au PC, elle attend la réponse |
| **bleue** fixe | elle parle |
| **rouge** (+ deux notes qui descendent) | problème : regarde le journal (point suivant) |
| **rouge** fixe dès le démarrage | le modèle ou la mémoire manque : voir plus bas |

Si la LED ne s'allume **jamais**, même pas en orange au démarrage, elle est sur l'autre broche : dans
`include/config.h`, mets `#define LED_PIN 38` (au lieu de 48, la valeur des copies), renvoie le
programme. Tout le reste marche quand même sans LED.

### Ce que dit le journal (Serial Monitor)

| Message | Quoi faire |
| --- | --- |
| `connexion au Wi-Fi…` puis `Wi-Fi perdu, nouvel essai` en boucle | Nom ou mot de passe Wi-Fi faux dans `secrets.h`, ou Wi-Fi en 5 GHz seulement. Corrige, renvoie le programme. |
| `PC pas encore joignable` ou `PC injoignable` | Jarvis n'est pas ouvert, ou l'interrupteur « Enceintes » est coupé, ou **le pare-feu Windows bloque**. Dans Windows : *Paramètres → Réseau et Internet → Pare-feu → Autoriser une application*, coche « Jarvis » dans la colonne **Privé**. Vérifie aussi que le réseau Wi-Fi du PC est en mode « Privé » (Paramètres → Réseau → propriétés du Wi-Fi). Et que `JARVIS_HOST` est bien l'adresse affichée dans Réglages → Enceintes (elle peut changer si la box a redémarré : fixe-la dans la box, ou utilise le nom en `.local` affiché à côté). |
| `le PC refuse le jeton` (401) | La clé n'est pas la bonne. Dans Réglages → Enceintes, **Retire** l'enceinte, **Ajoute**-la à nouveau, recopie le bloc dans `secrets.h` (garde ton Wi-Fi), renvoie le programme. |
| `réponse 403` | Le PC refuse une adresse hors de la maison. Carte et PC doivent être sur le même Wi-Fi (pas le Wi-Fi « invités »). |
| `le PC n'a pas pu écouter (503)` et Jarvis le dit | Sur le PC, la reconnaissance vocale (Whisper) n'est pas prête : ouvre Réglages → Voix et vérifie que la voix est installée ; attends quelques secondes après le démarrage de Jarvis. |
| `aucun modèle dans la partition « model »` | Le modèle du mot « Jarvis » n'a pas été écrit. Relance la **flèche** (Upload) et vérifie dans la fenêtre la ligne `flash_models.py : srmodels.bin sera écrit`. |
| `PSRAM absente` | Mauvaise carte (N8 ou N8R2 au lieu de N8R8/N16R8). |
| `rien dit après « Jarvis »` | Normal si tu n'as rien dit. Si tu as parlé : rapproche-toi, ou baisse `MIC_SHIFT` à 12 dans `config.h` (plus sensible). |
| `micro muet` | Le micro ne renvoie rien : VDD sur **3V3**, L/R sur **GND**, fils SCK/WS/SD sur les broches écrites dans `config.h` (4, 5, 6), soudures des broches du micro. |
| `pièce bruyante pour ce réglage` | Le bruit de fond est proche du seuil de parole : chaque phrase durerait 15 s. Mets dans `config.h` la valeur de `SPEECH_RMS` proposée par le message, ou `MIC_SHIFT 14`. |
| Rien du tout dans le journal | Mauvais câble USB (charge seule) ou mauvaise prise : utilise la prise **UART** (ou **COM**). En bas de VS Code, vérifie la vitesse `115200`. |

### Le son

- **Pas de son, jamais** : vérifie `Vin` sur **5V** et qu'il y a bien du 5V (copies : pont « IN-OUT », section 2), les trois fils BCLK/LRC/DIN sur **15/16/17**, et que
  le haut-parleur est bien vissé. Le petit bip au réveil est le test le plus simple.
- **Trop fort / trop faible** : `VOLUME` dans `config.h` (0 à 100).
- **Il ne m'entend pas quand je suis loin** : `MIC_SHIFT` à 12 ; **il sature / grésille** : 14.
- **Il se réveille tout seul** : `WAKE_THRESHOLD 0.8f` dans `config.h` (plus exigeant) ; **il ne se
  réveille pas assez** : `0.6f`. Le mot « Jarvis » du modèle est prononcé à l'anglaise (« djar-viss ») :
  la carte le reconnaît en général aussi dit à la française, mais articule au début.

### Essayer sans matériel

Sur le PC, dans le dossier du projet Jarvis, ouvre PowerShell et tape (avec ton jeton, celui de
`JARVIS_TOKEN`) :

```powershell
node apps/desktop/scripts/fake-speaker.mjs --token "ton_jeton" --hello
```

Il doit répondre `Pont trouvé : enceinte « Salon »…`. Pour aller jusqu'au bout, donne-lui un fichier
WAV 16 kHz mono d'une phrase (`--wav phrase.wav`) : il enregistre la réponse de Jarvis dans
`reponse-enceinte.wav`, que tu peux écouter.

---

## Pour les curieux : les choix techniques

- **Cadre : ESP-IDF 5.5 (pas Arduino).** Le mot de réveil « Jarvis » est un modèle officiel
  d'Espressif (ESP-SR, WakeNet `wn9_jarvis_tts`), qui se choisit dans la configuration du projet
  (`sdkconfig.defaults` : `CONFIG_SR_WN_WN9_JARVIS_TTS=y`). Le cœur Arduino-ESP32 3.x est précompilé
  avec un seul mot de réveil (« Hi, ESP ») : « Jarvis » n'y est pas accessible sans recompiler Arduino.
  Pistes écartées : microWakeWord (« hey_jarvis », pensé pour ESPHome) et le bouton « appuyer pour
  parler » (inutile puisque le modèle officiel existe).
- **Rien ne part au PC avant « Jarvis »** : la détection tourne sur la carte. Après le réveil, la fin de
  phrase est mesurée à l'énergie, comme sur le PC (650 ms de silence après la parole, 1,5 s si rien n'est
  dit, 15 s au plus). Un quart de seconde d'audio d'avant le réveil est gardé pour ne pas couper le début
  d'une phrase collée à « Jarvis ».
- **Écho** : pendant que la carte **répond**, le micro n'alimente plus la détection ; à la reprise, ce
  qui restait (sa propre voix) est jeté. Le bip de réveil, lui, est très court (≈ 120 ms) et ne coupe
  pas le micro : rien de ce qui suit « Jarvis » n'est perdu. Après la réponse, si le PC envoie `X-Jarvis-Continue: 1`, la carte écoute
  `followUpMs` sans mot de réveil et envoie la phrase avec `X-Jarvis-Follow-Up: 1`.
- **Mémoire** : la carte garde la phrase (jusqu'à 15 s) en PSRAM et envoie un WAV 16 kHz mono 16 bits
  (≤ 480 Ko ; le pont accepte 1,5 Mo). La réponse est jouée au fil de l'eau, sans être stockée : le
  lecteur (`src/wav_stream.c`) n'accepte que du PCM 16 bits mono entre 8 et 48 kHz, un entête de
  256 octets au plus, et s'arrête à la fin du bloc `data` (ou de la réponse si la taille est inconnue).
- **Fichiers** : `src/main.c` (l'enchaînement veille → écoute → envoi → réponse → suivi),
  `src/wake.c` (ESP-SR), `src/audio_io.c` (micro et ampli I2S, bips), `src/net.c` (Wi-Fi, mDNS,
  HTTP), `src/wav_stream.c` (lecture du WAV reçu), `src/led.c`, `include/config.h` (broches, volume,
  sensibilité), `include/secrets.example.h` (modèle de `secrets.h`), `partitions.csv` (zone « model »),
  `flash_models.py` (écrit le modèle au téléversement).
- **Tests sur PC** : `host-tests/run.sh` compile le lecteur WAV avec `gcc` (sans carte, sans PlatformIO)
  et le met à l'épreuve : paquets coupés n'importe où, WAV en flux, stéréo refusée, tailles de blocs
  absurdes. `pio run` ne touche pas à ce dossier.
