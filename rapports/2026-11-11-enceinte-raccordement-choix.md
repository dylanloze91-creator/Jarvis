# Choix — brancher une enceinte (partie 0)

Date : 11 novembre 2026. Branche `cursor/enceinte-raccordement`, base `origin/main` (`6ad0fa5`, Jarvis 5.0.75). Rien n'a été essayé sur une carte. Les tailles de `firmware.bin` et de `srmodels.bin` n'ont pas été mesurées : ces fichiers ne sont pas dans le dépôt, et PlatformIO n'est pas lancé ici.

## 1. Electron 44.4.5 et Web Serial

Version épinglée : **Electron 44.4.5** (`package-lock.json`, `apps/desktop/package.json`, `electron-builder.yml`). Documentation lue : [Device Access — Web Serial API](https://www.electronjs.org/docs/latest/tutorial/devices#web-serial-api) (même contrat que la 44 : l'exemple officiel est inchangé). Geste utilisateur : [electron#47211](https://github.com/electron/electron/issues/47211) (fermé le 22 mai 2025, limitation Chromium).

- `session.on('select-serial-port', (event, portList, webContents, callback) => …)` : Jarvis appelle `event.preventDefault()` et choisit le port lui-même (`callback(portId)` ou `callback('')`). Les événements `serial-port-added` et `serial-port-removed` ne vivent que tant que `callback` n'a pas été appelé.
- `session.setPermissionCheckHandler` : on n'autorise `permission === 'serial'` que pour la fenêtre de Jarvis.
- `session.setDevicePermissionHandler` : on n'autorise `deviceType === 'serial'` que pour cette même fenêtre. Le droit n'est pas donné aux autres origines.
- La CSP actuelle (`apps/desktop/src/renderer/index.html`) est `script-src 'self' 'wasm-unsafe-eval' …`. Elle ne contient pas `unsafe-eval`. `navigator.serial` est une API du moteur, pas un script distant : **aucun changement de CSP**.
- `requestPort()` **sans geste** est refusé (`SecurityError: Must be handling a user gesture`). Le clic sur « Ajouter une enceinte » est ce geste. `getPorts()` ne liste que les ports déjà accordés : il ne remplace pas la détection d'une carte qu'on vient de brancher.

## 2. esptool-js 0.7.1

Dernière version stable au 2 novembre 2026 : **0.7.1**, licence **Apache-2.0**. Paquet lu en local (`npm pack esptool-js@0.7.1`) : pas de `eval(` ni de `new Function` dans `lib/`. Dépendances d'exécution : `pako` et `atob-lite` seulement. Il sera importé par la fenêtre et empaqueté par electron-vite (pas de CDN).

Sources : [npm](https://www.npmjs.com/package/esptool-js), [notes v0.7.1](https://github.com/espressif/esptool-js/releases/tag/v0.7.1), [ESPLoader](https://espressif.github.io/esptool-js/docs/classes/ESPLoader.html).

API retenue, lue dans `lib/esploader.js` et `lib/reset.js` :

- `new Transport(port)`, `new ESPLoader({ transport, baudrate: 115200 })`, `main('default_reset')` puis `chip.CHIP_NAME`.
- `writeFlash({ fileArray, flashMode: 'qio', flashFreq: '80m', flashSize: 'detect', compress: true, calculateMD5Hash })`. Le MD5 est celui de la puce (`ESP_SPI_FLASH_MD5`) comparé au MD5 calculé par le PC. `compress: true` envoie les données compressées.
- `after('hard_reset')`. Sur le port USB natif (VID `0x303A`, PID `0x1001`, constantes `ESPRESSIF_VID` et `USB_JTAG_SERIAL_PID`), `usesUsbOtg()` est vrai et le reset USB-JTAG (`UsbJtagSerialReset`) est choisi. Sur un pont UART (CP210x `0x10C4`, CH340/CH343 `0x1A86`, FTDI `0x0403`), c'est le reset classique DTR/RTS.
- La carte XH-S3E a **deux prises** (`firmware/jarvis-speaker/README.md`) : **UART / COM** (souvent CH343, c'est celle du guide pour envoyer le programme) et **USB** (USB-Serial-JTAG). Les deux sont proposées. Si la puce n'entre pas seule en programmation, `main()` échoue après ses essais : la fenêtre montre le geste BOOT, RESET, relâche BOOT, puis « Réessayer ». Rien n'est inventé pour forcer le mode.

## 3. mDNS côté PC — `multicast-dns` 7.2.5

| Bibliothèque | Version | Licence | Dernière mise à jour lue | Pourquoi pas, ou pourquoi oui |
| --- | --- | --- | --- | --- |
| `multicast-dns` | 7.2.5 | MIT | 24 avril 2026 (npm) | **Retenue** |
| `bonjour-service` | 1.4.4 | MIT | 28 juillet 2026 | s'appuie sur `multicast-dns` mais publie sur toutes les interfaces |
| `bonjour` | 3.5.1 | MIT | peu entretenu (dernier vrai code ancien) | même limite, moins suivi |

Source lue : [index.js v7.2.5](https://github.com/mafintosh/multicast-dns/blob/v7.2.5/index.js). `reuseAddr` vaut vrai tant qu'on ne passe pas `false` (`opts.reuseAddr !== false`) : le port 5353 peut coexister avec le répondeur de Windows (`Dnscache`). On peut passer `interface` (une adresse) et `socket` (pour les tests). `bonjour-service` ne laisse pas choisir les interfaces aussi nettement : on répondrait aussi sur Tailscale ou WSL.

Choix : **une socket `multicast-dns` par interface gardée**, service `_jarvis-speaker._tcp`. Si l'ouverture échoue (`EADDRINUSE` est émis en événement `error`, il ne doit pas tuer Jarvis), on n'annonce rien et l'enceinte retombe sur les adresses données à l'installation. Le pont coupé n'ouvre aucune socket.

## 4. ESP-IDF livré par `espressif32 @ 6.12.0`

Plateforme : [platform-espressif32 6.12.0](https://github.com/platformio/platform-espressif32/releases/tag/v6.12.0) (31 juillet 2025) → **ESP-IDF v5.5.0**. Le fichier `firmware/jarvis-speaker/dependencies.lock` le confirme (`idf: 5.5.0`) et épingle **`espressif/mdns` 1.14.1** (le composant n'est plus dans l'IDF depuis la 5.0 ; le projet demande `^1.4.0`).

API lues :

- mDNS : [documentation du composant](https://docs.espressif.com/projects/esp-protocols/mdns/docs/latest/en/index.html) et [mdns.h](https://github.com/espressif/esp-protocols/blob/master/components/mdns/include/mdns.h). `mdns_query_ptr("_jarvis-speaker", "_tcp", timeout, max, &results)` renvoie une liste. Le TXT est dans `result->txt` (`key` / `value`), pas dans une fonction `mdns_query_results_get_txt` (cette fonction n'existe pas). On ne garde que `pc` égal à `pc_id`. `mdns_query_a` sert à résoudre le nom. Libérer avec `mdns_query_results_free`.
- NVS : [nvs.h v5.5](https://github.com/espressif/esp-idf/blob/v5.5/components/nvs_flash/include/nvs.h). Espace `jarvis`, `nvs_set_str` / `nvs_get_str`, `nvs_commit`. Une clé fait au plus 15 caractères : `ssid`, `pass`, `name`, `token`, `pc_id`, `port`, `hosts`, `last_ok` tiennent. `last_ok` n'est réécrit que s'il change.
- Wi-Fi : [guide ESP-IDF 5.5](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/api-guides/wifi.html). `WIFI_REASON_AUTH_FAIL`, `WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT`, `WIFI_REASON_HANDSHAKE_TIMEOUT` → `wrong_password`. `WIFI_REASON_NO_AP_FOUND` (et `NO_AP_FOUND_*`) → `not_found`. Pas d'adresse après connexion → `no_ip`. Délai dépassé → `timeout`.

## 5. Place en flash — partie 6 non faite

Table actuelle (`partitions.csv`) : application `factory` **0x300000** (3 145 728 octets) à `0x10000`, modèle **0x200000** (2 097 152 octets) à `0x310000`. Fin à `0x510000`, dans 8 Mo (`0x800000`).

L'exemple à deux emplacements (0x2D0000 + 0x2D0000 + modèle 0x1E0000, plus `otadata`) **tiendrait dans l'espace d'adresses** (fin vers `0x7A0000`). Mais chaque emplacement ferait **192 Ko de moins** que la partition actuelle, et **aucune taille réelle** de `firmware.bin` ni de `srmodels.bin` n'a été mesurée ici. Sans cette mesure, la mise à jour sans fil n'est pas écrite : une image trop grosse ne rentrerait pas. La mise à jour se fait par USB (chemin court de la partie 3).

## 6. Licences à redistribuer

Fichier prévu : `apps/desktop/speaker-firmware/LICENCES.md` (copié avec le programme, pas de `.bin` dans git).

| Pièce | Licence | Limite |
| --- | --- | --- |
| ESP-IDF 5.5 | Apache-2.0 | [LICENSE](https://github.com/espressif/esp-idf/blob/v5.5/LICENSE) |
| ESP-SR 2.6.1 et WakeNet (`wn9_jarvis_tts`) | Espressif MIT | [LICENSE](https://github.com/espressif/esp-sr/blob/master/LICENSE) : usage **sur les puces Espressif seulement** |
| `espressif/mdns` 1.14.1 | Apache-2.0 | composant esp-protocols |
| `espressif/led_strip` 3.x | Apache-2.0 | registre des composants |
| esptool-js 0.7.1 | Apache-2.0 | [dépôt](https://github.com/espressif/esptool-js) |
| `multicast-dns` 7.2.5 | MIT | [dépôt](https://github.com/mafintosh/multicast-dns) |
| `pako` (dépendance d'esptool-js) | MIT | compression zlib |

Le modèle de réveil ne doit pas être sorti du programme de l'ESP32. Le fichier de mentions le dit.

## Décisions qui suivent

- Programmation : esptool-js 0.7.1 dans la fenêtre, Web Serial, pas de module natif.
- Annonce : `multicast-dns` 7.2.5, une socket par interface filtrée, `reuseAddr` laissé à son défaut (vrai).
- Carte : ESP-IDF 5.5.0 déjà épinglé, mDNS 1.14.1, NVS `jarvis`.
- Partie 6 : **non faite** (taille réelle inconnue). Partie 7 : seulement si le reste est vert, et pas si elle complique.
