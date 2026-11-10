# Cahier des charges — Brancher une enceinte en cinq minutes, sans rien taper

Rédigé par Claude pour Cursor, le 11 novembre 2026. Demande de l'utilisateur : « raccorder une enceinte au réseau Jarvis, que ce soit facile. Ce n'est pas le cas actuellement. Simplifier vraiment ce raccordement. »

À lire avant de commencer : `CLAUDE.md` (sections 5.0.64 « Enceinte Jarvis », 5.0.63 « Téléphone » pour le modèle du jumelage, 5.0.70 « Jarvis plus simple » pour la carte des réglages), `docs/specs/enceinte-jarvis.md`, `docs/specs/enceinte-reflexe.md`, `firmware/jarvis-speaker/README.md`.

## Constat : ce que l'utilisateur doit faire aujourd'hui

1. Installer VS Code, l'extension PlatformIO et ESP-IDF (plus de 2 Go, première compilation d'une dizaine de minutes).
2. Copier `secrets.example.h` en `secrets.h`, y coller un bloc donné une seule fois par Jarvis, puis taper le Wi-Fi à la main dans un fichier C.
3. Compiler et téléverser, en choisissant le bon port COM et le bon environnement.
4. Se battre avec le réseau. Exemple vécu le 10 novembre : l'enceinte de la chambre est restée **orange**. Il fallait une règle de pare-feu (PowerShell **en administrateur**) et passer le réseau Windows de « Public » à « Privé ». Rien ne le lui disait.
5. L'adresse du PC est **écrite en dur** (`JARVIS_HOST "192.168.1.20"`). Si la box donne une autre adresse au PC, l'enceinte ne le trouve plus. Les cartes virtuelles (Tailscale, Radmin, WSL, Hyper-V) brouillent l'adresse affichée.
6. Ensuite, rien ne dit si l'enceinte est vivante. On sait seulement quand elle a entendu sa dernière phrase.

C'est un parcours de développeur. L'utilisateur n'est pas développeur.

## Le parcours visé (ce que l'utilisateur fait, et rien de plus)

1. Il branche la carte au PC avec un câble USB.
2. Jarvis → Parler à Jarvis → Enceintes → **« Ajouter une enceinte »**.
3. Il choisit la pièce (Salon, Chambre, Cuisine, Bureau, ou un nom libre). Il choisit son Wi-Fi dans **la liste des réseaux que l'enceinte voit elle-même**, puis tape le mot de passe.
4. Il clique sur **« Installer »**. Une liste se coche en direct :
   - carte reconnue ;
   - programme installé (barre de progression) ;
   - Wi-Fi connecté ;
   - PC trouvé ;
   - essai de voix : l'enceinte dit « Bonjour, je suis l'enceinte du Salon ».
5. Il débranche l'enceinte et la pose dans la pièce. C'est fini.

**Cible : moins de cinq minutes.** Aucun fichier à modifier, aucune commande à taper, aucun outil à installer. Chaque échec affiche une phrase claire et **un seul bouton** pour le régler.

En plus :
- une liste des enceintes vivante : en ligne ou non, signal Wi-Fi, version du programme ;
- un diagnostic réseau qui répare le pare-feu en un clic (avec l'accord de Windows) ;
- la remise à zéro par un bouton de la carte ;
- le changement de Wi-Fi par USB ;
- la mise à jour du programme sans fil, si la place le permet (partie 6).

## Principes

- **Le câble USB est la preuve de confiance.** Brancher la carte au PC, c'est l'autoriser. Pas de code à lire, pas de QR code. La clé de l'enceinte passe par le câble, jamais en clair sur le Wi-Fi avant le jumelage.
- **Le PC se fait trouver.** Fini l'adresse en dur. Le PC s'annonce sur le réseau local (mDNS). L'enceinte retient la dernière adresse qui a marché et la liste des adresses données à l'installation.
- **Un seul programme pour toutes les enceintes.** Il est compilé à l'avance, livré avec Jarvis, sans aucun secret dedans. Les réglages de chaque enceinte (Wi-Fi, nom, clé) vivent dans sa mémoire (NVS).
- **Le chemin des développeurs reste possible.** PlatformIO avec `secrets.h` continue de marcher, pour Claude Code et pour les essais. Il passe dans une section « Avancé ».
- **Aucune dépendance native à compiler** (règle du projet). La liaison série passe par le **Web Serial** d'Electron. La programmation de la carte passe par **esptool-js** (Espressif, Apache-2.0). L'annonce mDNS passe par une bibliothèque **100 % JavaScript**. Interdits : `serialport` et tout module `.node`.

## Partie 0 — Reconnaissance (avant d'écrire du code)

Écris `rapports/2026-11-XX-enceinte-raccordement-choix.md` (une page). Vérifie chaque point **à la source** (dépôt officiel, documentation, code de la version épinglée), jamais de mémoire. Pour chaque point, donne la version et le lien.

1. **Electron et Web Serial.** Vérifie la version d'Electron du projet. Note comment on accorde l'accès à un port série :
   - `session.on('select-serial-port')` ;
   - `setPermissionCheckHandler` ;
   - `setDevicePermissionHandler`.

   Précise aussi :
   - ce que donne `navigator.serial` dans la fenêtre avec la CSP actuelle ;
   - si un `requestPort()` sans geste de l'utilisateur est refusé.
2. **esptool-js.** Relève :
   - la dernière version stable et sa licence ;
   - son API : `ESPLoader`, `Transport`, écriture compressée, vérification MD5, `hard_reset` ;
   - son fonctionnement sur le **port USB natif** de l'ESP32-S3 (USB-Serial-JTAG, identifiant fabricant `0x303A`) et sur le port **UART** de la DevKitC-1 (pont CP210x ou CH343) ;
   - ce qui se passe si la carte n'entre pas seule en mode programmation.

   Il doit être empaqueté par electron-vite (pas de CDN) et ne pas exiger `unsafe-eval`.
3. **mDNS côté PC.** Compare `multicast-dns`, `bonjour-service` et ce qui existe d'autre en 100 % JavaScript : licence, maintenance, partage du port 5353 avec le répondeur mDNS de Windows (service `Dnscache`), choix des interfaces. Choisis-en un.
4. **ESP-IDF.** Note la version d'ESP-IDF fournie par `espressif32 @ 6.12.0`. Vérifie trois API :
   - le composant `espressif/mdns` : `mdns_query_ptr` pour un service et lecture du TXT ;
   - NVS ;
   - les codes de raison des déconnexions Wi-Fi (`WIFI_REASON_*`).
5. **Place en mémoire flash.** Mesure la taille réelle de `firmware.bin` et de `srmodels.bin`. Dis si deux emplacements de programme (OTA) tiennent dans 8 Mo à côté du modèle de réveil (voir partie 6).
6. **Licences à redistribuer** avec l'installateur : ESP-IDF, ESP-SR et les modèles WakeNet (licence Espressif, à lire : usage limité aux puces Espressif ?), `mdns`, `led_strip`, esptool-js, la bibliothèque mDNS. Prévois un fichier de mentions dans les ressources.

Si un point rend une partie impossible, ne contourne pas en silence. Écris-le dans ce rapport, choisis la solution la plus simple qui reste sans dépendance native, et continue.

## Partie 1 — Le programme générique de l'enceinte (`firmware/jarvis-speaker/`)

### Réglages dans la mémoire de la carte

- **Espace NVS `jarvis`** avec ces clés :
  - `ssid` (32 octets au plus) et `pass` (vide, ou 8 à 63 caractères) ;
  - `name` (24 caractères au plus) ;
  - `token` (64 caractères hexadécimaux) ;
  - `pc_id` (8 caractères hexadécimaux) ;
  - `port` ;
  - `hosts` (au plus 4 adresses IPv4 données à l'installation) ;
  - `last_ok` (dernière adresse qui a répondu, écrite **seulement quand elle change** pour ménager la flash).
- **Compatibilité développeurs.** Si `include/secrets.h` existe à la compilation (`__has_include`) et que la NVS est vide, ses valeurs servent comme avant. Le programme livré avec Jarvis est compilé **sans** `secrets.h`. Le README dit lequel est lequel.

### États de l'enceinte et LED

| État | LED | Ce que fait l'enceinte |
| --- | --- | --- |
| À installer (NVS vide) | violet qui respire (nouvel état `LED_SETUP`) | n'écoute pas « Jarvis », attend l'installation par USB |
| Démarrage | orange (`LED_BOOT`, inchangé) | Wi-Fi, puis recherche du PC |
| Prête | éteinte (inchangé) | écoute « Jarvis » |
| Clé refusée (trois réponses 401 de suite) | violet fixe | garde le Wi-Fi, attend une réinstallation par USB |
| Wi-Fi ou PC perdu plus de 5 minutes | rouge (inchangé) | continue d'essayer, avec des pauses de plus en plus longues |

Les états vert, bleu et bleu fixe ne changent pas.

### Installation par la liaison USB

L'enceinte reçoit ses réglages par des lignes de texte sur la console série, sur le port USB natif **et** sur l'UART0.

- Chaque réponse est une ligne `JARVIS> {json}`. Jarvis la reconnaît parmi les lignes du journal ESP-IDF.
- Le décodage des lignes et le contrôle des réglages sont dans **un fichier C pur** (`src/provision_proto.c`, sans en-tête ESP-IDF). Il est donc testable sur le PC avec gcc.

Les commandes :

- `hello` → `{fw, chip, mac, psram_mb, state, configured}`.
- `scan` → les réseaux Wi-Fi vus par la carte (nom, force du signal, protégé ou non), sans doublon, du plus fort au plus faible. L'utilisateur choisit dans ce que **l'enceinte** voit : un réseau 5 GHz n'y apparaît jamais.
- `config {ssid, pass, name, token, pc_id, port, hosts[]}` → contrôle des longueurs et des caractères, enregistrement, `{ok:true}` ou `{ok:false, error:"…"}`.
- `test` → la carte essaie pour de vrai et envoie une ligne par étape :
  - `{"step":"wifi","ok":true,"ip":"…","rssi":-52}`, ou un code d'échec ;
  - `{"step":"pc","ok":true,"host":"…","via":"mdns|last|hosts"}` ;
  - `{"step":"bridge","ok":true}` (le `hello` du pont avec la clé) ;
  - `{"step":"voice","ok":true}` (la phrase d'accueil est jouée).
- `forget` → efface l'espace `jarvis`, puis redémarre en « à installer ».
- `reboot`.

**Jamais** le mot de passe ni la clé ne sont renvoyés ni écrits dans le journal (masqués : `pass=***`). Aucune commande ne permet de les relire.

Les échecs de l'étape Wi-Fi se traduisent en codes simples :
- `wrong_password` (raisons `AUTH_FAIL`, `4WAY_HANDSHAKE_TIMEOUT`, `HANDSHAKE_TIMEOUT`…) ;
- `not_found` (`NO_AP_FOUND`) ;
- `no_ip` (pas d'adresse donnée par la box) ;
- `timeout`.

Les échecs de l'étape PC : `pc_not_found` (ni mDNS ni les adresses connues ne répondent), `refused` (port fermé), `timeout`. Ceux du pont : `bad_key` (401), `not_private` (403), `old_bridge`.

### Trouver le PC

L'ordre des essais :
1. `last_ok` ;
2. mDNS : service `_jarvis-speaker._tcp`, en gardant seulement la réponse dont le TXT `pc=` égale `pc_id` ;
3. les `hosts` de l'installation.

Un échec de connexion relance cette recherche, au plus une fois toutes les 10 secondes. Le nom `enceinte-jarvis` en `.local` devient `enceinte-<pièce>` (minuscules, sans accents), pour qu'on puisse distinguer les enceintes.

### Signe de vie

- Un `GET /api/speaker/hello` toutes les **30 secondes** quand l'enceinte est au repos. Il porte ces en-têtes : `X-Jarvis-Fw`, `X-Jarvis-Rssi`, `X-Jarvis-Ip`, `X-Jarvis-Mac`, `X-Jarvis-Uptime`, `X-Jarvis-Reset` (raison du dernier redémarrage).
- La réponse peut contenir `"action":"identify"`. L'enceinte fait alors un bip, met la LED en blanc pendant 3 s et joue « Je suis l'enceinte du Salon » (`GET /api/speaker/greeting`).
- Un tour de parole en cours a toujours la priorité sur le signe de vie.

### Bouton BOOT (GPIO0)

- Un appui de **10 secondes** fait clignoter la LED en blanc pendant les 3 dernières secondes, puis lance `forget`.
- Un appui court ne fait rien.
- Le bouton n'est lu qu'après le démarrage (c'est aussi une broche de démarrage de la puce).

### Phrase d'accueil

`GET /api/speaker/greeting` (avec la clé) renvoie un WAV du pont : « Bonjour, je suis l'enceinte du Salon. Dis « Jarvis » quand tu veux me parler. » La voix choisie (Piper ou Windows) est celle des réponses ordinaires.

## Partie 2 — Le programme livré avec Jarvis

- **Script `apps/desktop/scripts/setup-speaker-firmware.mjs`** (commande `npm run setup:speaker-firmware`). Il **ne fait pas partie** de `setup:voice` : un développeur sans PlatformIO doit pouvoir lancer Jarvis.
  - Il cherche `pio` (PlatformIO) et lance `pio run -d firmware/jarvis-speaker`.
  - Il copie dans `apps/desktop/speaker-firmware/` : `bootloader.bin`, `partitions.bin`, `firmware.bin`, `srmodels.bin`.
  - Il écrit `manifest.json` : `version`, `chip: "ESP32-S3"`, `flashSize: "8MB"`, `commit`, et pour chaque fichier `{name, offset, size, sha256}`.
- **Les adresses en flash sont lues dans `partitions.csv`** et dans le résultat de la compilation, jamais écrites deux fois à la main. Le manifeste est vérifié par une fonction pure de `@jarvis/core` : SHA-256, adresses dans la flash, aucun chevauchement, fichier présent.
- **Pas de fichier `.bin` dans git.** `apps/desktop/speaker-firmware/` est ignoré, sauf un `LISEZMOI.md`. `electron-builder.yml` copie ce dossier dans `resources/speaker-firmware/` ; la construction ne doit pas échouer s'il ne contient que le `LISEZMOI.md`.
- **Programme absent de l'installation** : la fenêtre « Ajouter une enceinte » le dit (« Le programme de l'enceinte n'est pas inclus dans cette version de Jarvis ») et renvoie à la section « Avancé ».
- **Publication.** `release.sh` (Claude Code) appellera ce script. Ajoute-le **dans le rapport** comme étape à faire, sans modifier `release.sh` toi-même.
- **Contrôle de compilation dans GitHub Actions** (facultatif) : `.github/workflows/firmware.yml`, qui ne se lance que sur `firmware/**` et compile seulement, sans publier.
- **Version du programme** : une constante `JARVIS_FW_VERSION` dans le firmware, reprise dans le manifeste. Jarvis compare la version de l'enceinte à celle du manifeste.

## Partie 3 — « Ajouter une enceinte » par USB, dans Jarvis

### Le déroulé, en logique pure

Fichier `packages/core/src/speaker/setupFlow.ts`, une machine à états testée. Les étapes :
1. port choisi ;
2. carte reconnue (esptool-js lit la puce et la taille de la flash ; une puce autre que l'ESP32-S3 ou une flash de moins de 8 Mo est refusée, avec la raison) ;
3. programme écrit (progression en %) puis vérifié (MD5) ;
4. redémarrage ;
5. `hello` reçu ;
6. `scan` ;
7. réglages envoyés ;
8. `test` (wifi, pc, bridge, voice) ;
9. terminé.

Règles du déroulé :
- **Même version déjà installée** (`hello.fw` égale la version du manifeste) : l'écriture est sautée. C'est le chemin court, aussi utilisé par « Changer le Wi-Fi ».
- **Annulation ou échec** : rien ne reste à moitié. L'entrée en attente est retirée, et la carte garde son état d'avant ou repasse « à installer ».

### Électron

- **Accès au port** (processus principal) : `select-serial-port` est géré par Jarvis, qui montre **sa propre liste**. Les cartes Espressif (`0x303A`) et les ponts USB courants (CP210x `0x10C4`, CH34x `0x1A86`, FTDI `0x0403`) apparaissent en premier, avec un nom lisible : « Carte ESP32-S3 (COM5) ». S'il n'y a qu'une carte Espressif, elle est choisie seule.
- **Droits limités** : seulement l'accès série, seulement pour la fenêtre de Jarvis.
- **Pas de mode programmation tout seul** : la fenêtre montre trois gestes, avec un petit schéma (maintiens BOOT, appuie sur RESET, relâche BOOT), puis « Réessayer ».

### Fenêtre « Ajouter une enceinte »

Un assistant en trois écrans, au tutoiement :
1. Branche ta carte (détection en direct).
2. Pièce et Wi-Fi :
   - liste issue du `scan` ;
   - champ « mot de passe » avec un œil pour l'afficher ;
   - « Autre réseau… » pour un nom caché.
3. Installation, avec la liste qui se coche.

### Avertissements sur le Wi-Fi

- **PC en 5 GHz** : Jarvis lit la bande Wi-Fi du PC par une commande fixe en lecture seule (`netsh wlan show interfaces`, sans paramètre). Si le PC est en 5 GHz et que le même nom n'apparaît pas dans le `scan`, une phrase l'explique : l'enceinte a besoin du 2,4 GHz ; si la box a deux noms, choisis celui en 2,4 GHz.
- **Réseau invité ou isolé** : si le Wi-Fi est bon mais que le PC est introuvable, Jarvis le suggère dans le diagnostic (partie 4).

### Jumelage et clé

- La clé (32 octets) est créée par le PC, sur une entrée **en attente** de `speakers.json`. Elle passe seulement par le câble.
- L'entrée devient définitive au premier `hello` réussi (étape `bridge`). Elle est retirée si l'installation est abandonnée.
- **Même carte (même MAC) qu'une enceinte existante** : Jarvis propose « Remplacer l'enceinte Chambre ». Le nom est gardé, une nouvelle clé est créée, l'ancienne cesse de marcher.
- Champs ajoutés à `speakers.json` : `mac`, `pending`, `fw`, `lastHelloAt`, `rssi`, `ip`, et `pcId` au niveau du fichier. La lecture d'un ancien fichier reste tolérante.
- **Rien dans `settings.json`** : `parseSettings({})` ne gagne aucune clé.

### Mot de passe Wi-Fi

- Il n'est **jamais** écrit sur le disque du PC, ni dans un journal, ni dans l'historique.
- Il passe de la fenêtre à la carte par la liaison série, puis il est effacé de la mémoire de la fenêtre.

## Partie 4 — Le PC se fait trouver, et le réseau se répare

### Annonce mDNS

Elle n'existe que si le pont des enceintes est activé, comme le port 53131.

- **Service annoncé** : `_jarvis-speaker._tcp`, port 53131, TXT `pc=<pcId>` et `v=1`.
- **Sur quelles interfaces** : seulement les interfaces **privées, réelles et avec une passerelle**. Sont exclues :
  - les plages Tailscale (`100.64.0.0/10`) et Radmin (`26.0.0.0/8`) ;
  - les interfaces dont le nom contient `vEthernet`, `WSL`, `Hyper-V`, `VirtualBox`, `VMware`, `Loopback` ou `Bluetooth`.
- **Fonction pure dans le cœur**, à côté de `sortLocalAddresses`, avec des tests.
- **Coexistence avec Windows** : port 5353 partagé avec le répondeur de Windows. Si l'annonce ne peut pas s'ouvrir, l'enceinte se rabat sur les adresses connues et le diagnostic le montre. Rien ne plante.
- **Adresses envoyées à l'installation** : les mêmes adresses filtrées vont dans `hosts`.

### Diagnostic « Mon enceinte ne répond pas »

Il s'ouvre par un bouton de la page Enceintes, ou tout seul si le `test` échoue aux étapes `pc` ou `bridge`. Ce sont des contrôles en lecture seule, chacun par **une commande PowerShell fixe** (même règle que `windowsSpeechScript` : script constant, résultat en JSON, aucun texte variable dans le script). Pour chaque contrôle, une ligne verte ou rouge avec une phrase simple :
1. le pont est démarré et écoute sur 53131 ;
2. une règle de pare-feu entrante autorise TCP 53131 sur le profil Privé ;
3. une règle autorise UDP 5353 (mDNS) ;
4. le réseau actif est en profil **Privé** (s'il est en Public, c'est la cause probable, et on l'écrit) ;
5. les adresses annoncées (et celles écartées, avec la raison) ;
6. la dernière fois que chaque enceinte a donné signe de vie.

### Bouton « Réparer »

Le texte affiché : « Réparer (Windows va te demander ton accord) ».

- Il lance un script **constant**, versionné dans les ressources (`speaker-firewall.ps1`), élevé par `Start-Process -Verb RunAs`. Son seul argument est le port, vérifié comme nombre.
- Le script ajoute les règles nommées « Jarvis — enceintes (TCP 53131) » et « Jarvis — enceintes (mDNS) », profil Privé seulement, sans doublon.
- **Passer le réseau en Privé** est un second bouton, séparé, avec une phrase d'explication : « seulement si c'est le réseau de ta maison ».
- Jamais rien d'automatique. Le refus de la fenêtre de Windows est dit tel quel.

### Installateur (option recommandée)

L'installateur NSIS est déjà élevé. Il peut ajouter les deux règles de pare-feu au profil Privé (`customInstall`) et les retirer à la désinstallation (`customUnInstall`). Si tu le fais, teste le script NSIS dans le rapport. Claude Code le vérifiera sur Windows.

## Partie 5 — La liste des enceintes

Chaque carte d'enceinte montre :
- le nom ;
- l'état : En ligne, Hors ligne depuis…, Installation en cours, Clé refusée, Ancienne version (une enceinte en 5.0.64, qui n'envoie pas les nouveaux en-têtes) ;
- le signal Wi-Fi, en 4 barres calculées depuis le RSSI (fonction pure) ;
- la version du programme (« à jour », ou « mise à jour disponible ») ;
- l'adresse ;
- la dernière phrase.

Les actions :
- **Faire signe** : l'enceinte se manifeste au prochain signe de vie, donc en moins de 30 secondes, et la fenêtre le dit.
- **Renommer** : côté PC ; le nouveau nom est envoyé dans la réponse du `hello`.
- **Changer le Wi-Fi** : le chemin court par USB.
- **Mettre à jour** : partie 6, sinon par USB.
- **Retirer** : confirmation en deux temps (`ui/confirmButton.tsx`) ; la clé est révoquée et l'enceinte passe en « Clé refusée ».

Le reste de la page :
- **Le bloc `secrets.h`** sort de l'écran principal. Il passe dans un repli « Avancé (développeurs) ». `speakerSecretsBlock` et ses tests restent.
- **Carte des réglages** : ajoute les nouvelles actions à `SETTINGS_FIELD_MAP` (par exemple `action.speaker.install`, `action.speaker.diagnose`), avec les mots de recherche « enceinte, brancher, ajouter, USB, Wi-Fi, pare-feu ». `settingsMap.test.ts` doit rester vert.
- **Scènes d'aperçu** : `?scene=speaker-install`, `?scene=speaker-install-error`, `?scene=speaker-list`, `?scene=speaker-diagnose`.

## Partie 6 — Mise à jour sans fil (seulement si la place le permet)

- **Condition** : la partie 0 montre que deux emplacements de programme plus le modèle de réveil tiennent dans 8 Mo. Exemple à vérifier : `otadata`, `ota_0` et `ota_1` de 0x2D0000 chacun, plus `model` de 0x1E0000.
- **Si ça ne tient pas** : ne fais pas cette partie. Écris pourquoi dans le rapport. La mise à jour se fait alors par USB, avec le chemin court.
- **Nouvelle table de partitions** : le premier passage se fait par une installation USB (celle de la partie 3).
- **Déclenchement** : seulement sur un clic de l'utilisateur dans Jarvis. La réponse du `hello` porte `"update": {version, size, sha256}`.
- **Téléchargement** : quand elle est au repos, l'enceinte télécharge `GET /api/speaker/firmware` avec sa clé, vérifie le SHA-256 et écrit l'autre emplacement.
- **Retour arrière** : avec `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`, la nouvelle version n'est validée qu'après un `hello` réussi ; sinon, l'enceinte revient seule à l'ancienne.
- **Interdit** : jamais pendant un tour de parole, jamais sans clic.

## Partie 7 — Secours sans câble (facultative, seulement si tout le reste est fini et vert)

Si le Wi-Fi est introuvable depuis 10 minutes **et** si l'utilisateur a appuyé 3 secondes sur BOOT :
- l'enceinte ouvre un petit point d'accès « Jarvis-Enceinte-XXXX », protégé par un mot de passe imprimé dans le journal série et dit par un bip codé ;
- sa page change seulement le Wi-Fi, jamais la clé.

Ne la fais pas si elle complique le reste.

## Partie 8 — Les guides

- **`firmware/jarvis-speaker/README.md`** : le chemin simple d'abord.
  - Liste d'achat et câblage : inchangés.
  - Puis « Brancher au PC et cliquer sur Ajouter une enceinte dans Jarvis ».
  - PlatformIO et `secrets.h` passent dans « Pour les développeurs ».
  - La section « Si ça ne marche pas » renvoie au diagnostic de Jarvis et donne le tableau des LED à jour.
- **`docs/enceinte-brancher.md`** : guide utilisateur d'une page, en français simple, avec le schéma du geste BOOT/RESET.

## Ce qui ne change pas (à ne pas casser)

- **Pont coupé (défaut)** : aucun port, **aucune annonce mDNS**, rien ne change.
- **Tests figés** : `chat-unchanged.test.ts`, `ollama-unchanged.test.ts`, `orchestra-session.test.ts`, `machineProfile.test.ts` et `profiles/jarvis.test.ts` restent verts **sans régénérer** les `__golden__`. `parseSettings({})` ne gagne aucune clé.
- **Enceinte déjà installée en 5.0.64** (celle de la chambre) : elle continue de marcher sans réinstallation. Elle apparaît « Ancienne version » avec un bouton « Réinstaller par USB ».
- **Contrat des tours** : celui de Jarvis Réflexe et de la réponse en flux, inchangé (`/api/speaker/turn`, `/wake`, en-têtes). Une carte de confirmation est toujours refusée depuis une enceinte ; aucune mission n'est lancée depuis une enceinte.
- **Accès au pont** : toujours limité aux adresses privées, avec le jeton Bearer et la comparaison en temps constant.
- **CSP** inchangée sauf ce qu'exige Web Serial (rien d'autre, jamais `unsafe-eval`).
- **Aucune dépendance native.** Aucun accès réseau hors du réseau local.
- **Dépôt public** :
  - aucun secret, aucun `.bin`, aucun chemin personnel, aucun nom de Wi-Fi réel ;
  - les exemples de tests sont synthétiques et marqués `synthetique-test`.

## Tests

### Cœur (Vitest)

- `setupFlow.test.ts` : chaque étape, chaque échec et son message, l'annulation, la même version (écriture sautée), le remplacement par MAC.
- `provisioning.test.ts` :
  - construction des lignes `config` ;
  - lecture des lignes `JARVIS>` au milieu d'un journal bruité ;
  - refus des longueurs et des caractères interdits ;
  - mot de passe jamais présent dans ce qui est journalisé.
- Codes Wi-Fi vers phrases françaises.
- Filtre des interfaces (Tailscale, Radmin, vEthernet, WSL, VirtualBox ; carte avec passerelle préférée).
- Contrôle du manifeste (SHA-256, adresses, chevauchement).
- Lecture des en-têtes du `hello` ; RSSI vers barres.

### Bureau

- `speakers.json` :
  - un ancien fichier se lit, et ses champs sont gardés ;
  - une entrée en attente est retirée après un abandon ;
  - le remplacement change la clé et l'ancienne est refusée.
- Le `hello` met à jour l'état ; `identify` est consommé une seule fois ; `greeting` exige la clé.
- Annonce mDNS avec une fausse socket : réponses PTR, SRV, TXT et A seulement sur les bonnes interfaces, et aucune si le pont est coupé.
- Lecture des sorties JSON du diagnostic (exemples figés).
- Script de pare-feu : constant, et port validé.

### Fenêtre

- Le déroulé complet avec un **faux port série** (`fakeSerial.testkit.ts`), qui joue la carte : journal bruité, `hello`, `scan`, `config`, `test` réussi et chaque échec. esptool-js est simulé.
- Rendu des scènes.

### Firmware

- `provision_proto.c` testé sur le PC avec gcc (`firmware/jarvis-speaker/test/`, script `npm run test:firmware`, ignoré proprement si gcc manque).
- `pio run` doit compiler. Si ton environnement ne peut pas installer PlatformIO, dis-le : Claude Code compilera sur le PC.

### Fausse enceinte

`apps/desktop/scripts/fake-speaker.mjs` gagne les en-têtes du signe de vie et `--hello-loop`.

## Essais réels (Claude Code, avec la vraie carte, après la relecture de Claude)

1. Installation complète depuis Jarvis sur Windows, par le port USB **et** par le port UART de la DevKitC-1. Chronométrer (cible : moins de 5 minutes).
2. Mauvais mot de passe ; réseau 5 GHz seul ; nom de réseau caché.
3. Règle de pare-feu retirée, puis « Réparer » ; réseau passé en Public, puis diagnostic.
4. Adresse du PC changée par la box (bail renouvelé) : l'enceinte retrouve le PC seule.
5. Tailscale et Radmin actifs : aucune de leurs adresses n'est annoncée.
6. BOOT 10 s, puis réinstallation ; « Retirer », puis l'enceinte passe en « Clé refusée ».
7. L'enceinte de la chambre (5.0.64) marche encore avant d'être réinstallée, puis « Remplacer » marche.
8. Mise à jour sans fil, avec un retour arrière forcé, si la partie 6 est faite.
9. Une phrase normale après l'installation : la latence de Jarvis Réflexe n'a pas bougé.

## Livraison

- **Branche** `cursor/enceinte-raccordement`, inscrite dans `AGENTS-COORDINATION.md` (fichiers réservés : `firmware/jarvis-speaker/**`, `apps/desktop/src/main/speaker/**`, `packages/core/src/speaker/**`, `SpeakerSettings.tsx` et les nouveaux composants).
- **Base** : la branche qui réunit `cursor/enceinte-reflexe` et `claude/enceinte-flux` si elle existe (voir `AGENTS-COORDINATION.md`). Sinon `origin/main`, en gardant tes changements de `server.ts` petits et isolés dans de nouveaux fichiers (`provisioning.ts`, `discovery.ts`, `diagnose.ts`), pour que la réunion soit facile. Dis lequel dans le rapport.
- **Un commit par partie**, tests verts à chaque commit. Pousse souvent.
- **Dans `CLAUDE.md`** : ajoute seulement ta section « Brancher une enceinte en cinq minutes » et ta ligne dans « Ce qu'il ne faut pas casser ».
- **Avant de pousser** : `npm run typecheck`, `npm test`, `npm run lint` (seuls les échecs dotnet attendus sans SDK .NET).
- **Pas de fusion dans `main`, pas de publication.** Cursor prépare, Claude relit, Claude Code essaie sur la vraie carte et publie.
- **Rapport** `rapports/2026-11-XX-enceinte-raccordement.md` :
  - ce qui est fait, partie par partie ;
  - ce qui ne l'est pas, et pourquoi ;
  - les choix de la partie 0 ;
  - la liste exacte des essais réels pour Claude Code ;
  - l'étape à ajouter à `release.sh`.

  Puis le RAPPORT DE VÉRIFICATION.
