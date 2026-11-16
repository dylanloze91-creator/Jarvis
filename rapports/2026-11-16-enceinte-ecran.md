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
