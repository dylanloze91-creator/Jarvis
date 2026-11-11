# Mentions du programme d'enceinte

Le programme est compilé pour une puce **Espressif ESP32-S3** et n'a pas à être exécuté ailleurs.

| Pièce | Licence | Note |
| --- | --- | --- |
| ESP-IDF 5.5 | Apache-2.0 | https://github.com/espressif/esp-idf/blob/v5.5/LICENSE |
| ESP-SR et WakeNet (`wn9_jarvis_tts`) | Espressif MIT | Usage **sur les puces Espressif seulement**. https://github.com/espressif/esp-sr/blob/master/LICENSE |
| espressif/mdns | Apache-2.0 | https://github.com/espressif/esp-protocols |
| espressif/led_strip | Apache-2.0 | registre des composants Espressif |
| esptool-js | Apache-2.0 | outil qui écrit la flash depuis Jarvis. https://github.com/espressif/esptool-js |
| multicast-dns | MIT | annonce du PC sur le réseau local. https://github.com/mafintosh/multicast-dns |

Les fichiers `.bin` de ce dossier, quand ils sont présents, reprennent ces programmes.
Ils ne contiennent ni mot de passe ni clé d'enceinte.
