# Écran OLED de l'enceinte — programme de la carte

16 novembre 2026, écrit par Claude (le chat) à la demande de l'utilisateur. Branche `claude/enceinte-ecran`. **Pas fusionné, pas essayé sur la carte.**

## Ce que ça fait

L'écran suit l'état de l'enceinte (le même que la LED) :

| État | Écran |
| --- | --- |
| Veille | heure en grand, date, nom de l'enceinte, barres Wi-Fi ; lumière baissée ; décalage d'un point chaque minute pour ne pas marquer l'OLED |
| Après « Jarvis » | « J'écoute… » et des barres qui bougent |
| Réflexion | trois points animés, « Je réfléchis… » |
| Erreur | « PC injoignable » ou « Pas de Wi-Fi » |
| Démarrage, installation, clé refusée, « faire un signe » | un message court |

L'heure vient d'Internet (SNTP, `pool.ntp.org`), à l'heure de Paris (changement d'heure compris), une fois le Wi-Fi connecté. Avant cela, l'écran affiche « Jarvis ».

## Matériel

- Écran I2C à 4 broches : **SH1106 1,3 pouce** (par défaut), SSD1306 0,96 pouce ou SSD1306 0,91 pouce (`DISPLAY_TYPE` dans `include/config.h`).
- Câblage : GND → GND, VCC → **3V3** (jamais 5V), SDA → **IO8**, SCL → **IO9**. Ces broches sont libres (déjà prises : 4, 5, 6, 15, 16, 17, 48).
- Adresse 0x3C, puis 0x3D est essayée.

## Sûreté

- **Sans écran branché, rien ne change** : il est cherché une fois au démarrage, puis oublié (« aucun écran trouvé » dans le journal).
- Une seule tâche parle à l'écran, en priorité basse. Elle ne bloque jamais le réveil, le micro ni le son. Un faux contact est signalé au journal, puis rattrapé.
- `led_set` prévient l'écran : aucune autre partie du programme n'a changé.

## Fichiers

- `src/display_gfx.c/.h` : dessin en mémoire, police, coupe avec « … » (sans matériel).
- `src/display_view.c/.h` : ce que montre chaque état (sans matériel).
- `src/display.c/.h` : I2C (`driver/i2c_master.h`, ESP-IDF 5.5), SNTP, tâche.
- `src/font5x7.h` : police 5 x 7 dessinée pour l'enceinte, avec les accents du français, générée par `outils/police_5x7.py`.
- `host-tests/display_test.c` : tests sur le PC (`host-tests/run.sh`). Chaque écran, en 128 x 64 et en 128 x 32, tient dans la surface. L'heure se décale bien d'une minute à l'autre. UTF-8 abîmé sans plantage.
- `include/config.h` : réglages de l'écran. `src/CMakeLists.txt` : `esp_driver_i2c`. `src/main.c` : `display_init()`. `src/led.c` : `display_state()`.

## RAPPORT DE VÉRIFICATION

- Tests sur le PC (`host-tests/run.sh`, gcc avec ASan/UBSan et `-Werror -Wconversion`) : **OK** (filtre du micro, flux WAV, écran).
- `display.c` : syntaxe vérifiée avec des en-têtes de remplacement. **Pas compilé avec ESP-IDF** (pas de chaîne de compilation dans le cloud) : à faire par `pio run` sur le PC.
- Testé en vrai (sur la carte) : **PAS FAIT**.
- À venir : l'animation dessinée par l'utilisateur, à incorporer quand il l'enverra.

## Compilation et tests sur le PC Windows (Claude Code, nuit du 16 au 17 novembre)

Fait sur la branche telle quelle (`788645c`), dans une copie de travail à part. **Rien n'a été flashé.** Aucune correction n'a été nécessaire : aucun fichier du programme n'est modifié.

- **`pio run`** (`firmware/jarvis-speaker`, PlatformIO, `PYTHONUTF8=1`) : **SUCCÈS** en 317 s. `display.c` compile donc avec ESP-IDF (`driver/i2c_master.h`). Aucun avertissement venant des fichiers de l'enceinte. RAM 27,1 % (88 692 octets sur 327 680), flash 53,3 % (1 677 525 octets sur 3 145 728), `srmodels.bin` 284 Ko (`wn9_jarvis_tts`).
  - `include/secrets.h` n'est pas dans le dépôt : la compilation a utilisé une copie de `secrets.example.h` (valeurs d'exemple, sans clé), effacée après. Le binaire obtenu ne sert qu'à vérifier la compilation : il ne doit pas être flashé tel quel.
- **`host-tests/run.sh`** : gcc n'existe pas sous Windows ; lancé dans WSL (Ubuntu, gcc 15.2.0, ASan/UBSan, `-Werror -Wconversion`) : **OK**, code de sortie 0 (filtre du micro, flux WAV, `display_test`).
- Remarque sans conséquence : `run.sh` compile et lance `mic_filter_test` deux fois (lignes en double). Non corrigé : ça n'empêche rien.
- Broches vérifiées dans `config.h` : IO8 et IO9 ne sont prises ni par le micro (4, 5, 6), ni par l'ampli (15, 16, 17), ni par la LED (48).

RAPPORT DE VÉRIFICATION (Claude Code)
Lancement : OK (pio run, firmware.bin et srmodels.bin construits)
Types     : sans objet (C)
Style     : OK (aucun avertissement dans les fichiers de l'enceinte)
Tests     : OK (host-tests/run.sh dans WSL, code 0)
Secrets   : OK (secrets.h d'exemple, effacé, jamais commité)
Fichiers modifiés : ce rapport seulement
Prêt à fusionner : à décider après l'essai sur la carte
Testé en vrai (sur la carte) : PAS FAIT (pas de flash cette nuit, à la demande de l'utilisateur)

## La mascotte (17 novembre, matin)

L'utilisateur a dessiné une mascotte animée (`include/jarvis_mascotte.h`, aperçu `apercu.html` et `mascotte-apercu.gif`). Cursor l'a branchée de son côté, à partir de `main` (archive `mascotte-ecran.patch`), avec la bibliothèque U8g2. Comme l'écran avait déjà son programme ici (compilé cette nuit), Claude a **réuni les deux** au lieu d'en garder deux. Il n'y a donc qu'un seul programme d'écran.

**Repris de Cursor, sans changement de comportement :**
- le dessin, non modifié ;
- `src/mascotte_etat.c/.h` : dort, écoute, réfléchit, parle ; 10 s d'écoute après la réponse ; décalage pendant le sommeil ;
- les appels dans `main.c` (réfléchit, dort, écoute) et dans `net.c` (« parle » quand le son part, bouche réglée sur le volume du bloc) ;
- ses deux tests sur PC.

**Gardé d'ici :**
- le pilote I2C sans bibliothèque (`display.c`, ESP-IDF `i2c_master`), déjà compilé sur le PC ;
- l'image en mémoire (`display_gfx.c`) ;
- les messages : PC injoignable, pas de Wi-Fi, clé refusée, à installer, « C'est moi ! ».

**Retiré :**
- U8g2 (environ 10 000 lignes) : le pilote d'ici sait déjà parler aux puces SH1106 et SSD1306 ;
- l'horloge et l'heure par Internet : quand l'enceinte est en veille, c'est la mascotte qui dort. L'horloge pourra revenir en option si l'utilisateur la veut.

**Ce qui s'affiche :** la mascotte pour la vie normale ; un message court quand l'enceinte doit dire ce qui ne va pas (LED en erreur, à installer, clé refusée, signe demandé).

**Nouveau :** `src/display_mascotte.cpp/.h`, le pont entre le dessin (C++) et l'image (C). `display_gfx.h` est utilisable depuis le C++. Le test `host-tests/display_mascotte_test.cpp` vérifie que les 4 états allument des points sur 4 s, que la bouche imposée change l'image et que le décalage la déplace.

**Tâche de l'écran :** 15 images par seconde, cœur 0 (le son tourne sur l'autre cœur), pile de 8 Ko, priorité basse.

### Vérification

- `host-tests/run.sh` (gcc et g++, ASan/UBSan, `-Werror`) : **OK**. Dans l'ordre : filtre du micro, flux WAV, messages, état de la mascotte, dessin, mascotte dans l'image. Le doublon de `mic_filter_test` est retiré.
- `display.c` : syntaxe vérifiée avec des en-têtes de remplacement. **À recompiler sur le PC** (`pio run`), puisque `display.c`, `main.c` et `net.c` ont changé depuis la compilation de cette nuit.
- Testé en vrai (sur la carte) : **PAS FAIT**.

## L'heure et les informations reviennent (17 novembre, 8 h, demande de l'utilisateur)

« Garde l'heure et les écrans d'information, incorpore-les aux écrans de la mascotte. » Le choix est fait par `display_choose` (`src/display_view.c`), testé sur le PC. L'ordre :

1. **Un souci ou une étape à comprendre** : PC injoignable, pas de Wi-Fi, clé refusée, à installer, « C'est moi ! ». Toujours en premier.
2. **L'activité** : il écoute, il réfléchit, il parle. C'est toujours la mascotte.
3. **Une information importante envoyée par le PC**, le temps demandé.
4. **L'heure et la date**, quand la mascotte dort depuis 2 minutes (`DISPLAY_HEURE_APRES_MS`) et que l'heure est connue (SNTP, heure de Paris). Lumière baissée, petit décalage chaque minute.
5. Sinon, la mascotte.

**Informations du PC** : en-tête `X-Jarvis-Ecran: titre|ligne|secondes`, en UTF-8 encodé pour une URL (`Imprimante|Impression%20termin%C3%A9e|30`).
- Il est lu sur **toutes** les réponses du PC, l'interrogation régulière `hello` comprise : le PC peut donc afficher quelque chose sans qu'on parle à l'enceinte.
- 20 s par défaut, 300 s au plus. `-` efface.
- Un en-tête illisible ne change rien. Les caractères de contrôle sont refusés, et un texte trop long est coupé sans casser une lettre accentuée.

**Côté PC, rien n'envoie encore cet en-tête.** C'est une petite mission pour Jarvis Test, à confier à Cursor : `cursor-ecran-infos.zip`.

### Vérification

- `host-tests/run.sh` : **OK**. Ajouts testés : le choix de l'écran (10 cas), l'en-tête (11 cas, dont l'illisible, le retour à la ligne, la coupe d'un accent), l'écran d'information avec un titre trop long.
- `display.c` : syntaxe vérifiée avec des en-têtes de remplacement. **À recompiler sur le PC** (`pio run`).
