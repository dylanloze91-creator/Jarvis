# Revue — `cursor/enceinte-raccordement` (11 novembre 2026, Claude)

Branche relue : `origin/cursor/enceinte-raccordement` à `e533350` (10 commits sur `origin/main` 6ad0fa5, 74 fichiers). Cahier : `docs/specs/enceinte-raccordement-facile.md`.

**Verdict : pas prêt pour l'essai sur la carte.** La base est bonne et bien découpée : protocole série en C pur testé, réglages en NVS, entrée en attente et remplacement par MAC dans `speakers.json`, manifeste vérifié, filtre des interfaces, annonce `multicast-dns` coupée avec le pont, phrase d'accueil, mot de passe masqué dans les journaux. Mais cinq points bloquent, et le rapport annonce « Fait » pour les parties 4 et 5 alors qu'elles ne le sont qu'à moitié.

## Bloquant

### 1. Régression possible du micro de Jarvis (`main/speaker/serialAccess.ts`, `window.ts`)

`bindSerialAccess` appelle `session.setPermissionCheckHandler(...)` sur la session de la fenêtre, qui est `defaultSession`. Or `index.ts` a déjà posé un gestionnaire sur cette session (micro : `allowPermissionCheck(permission, mediaType)`), **avant** `createOverlayWindow`. Electron n'en garde qu'un : celui de l'enceinte **remplace** celui du micro et refuse tout ce qui n'est pas `serial`. Toutes les vérifications `media` sont donc refusées (`permissions.query` du micro, entre autres).

À faire : un seul gestionnaire, qui garde la règle du micro et ajoute `serial` pour la seule fenêtre de Jarvis. Par exemple, `index.ts` passe à `bindSerialAccess` la fonction existante et la combine. Même chose pour `setDevicePermissionHandler`, qui doit aussi vérifier la fenêtre (aujourd'hui : `serial` accordé à toute origine). Ajoute un test : avec la liaison série en place, une vérification `media` (micro) suit toujours `allowPermissionCheck`.

### 2. La programmation ne peut pas marcher telle quelle (`renderer/src/speaker/esptoolFlash.ts`)

D'après le code d'esptool-js 0.7.1 (`src/webserial.ts`) :
- **Port déjà ouvert.** `Transport.connect()` fait `device.open(...)`. Or `identify()` appelle `reopen(port)`, qui ouvre le port **avant** `loader.main()`. Le second `open` lève `InvalidStateError`, l'erreur est avalée, et la fenêtre affiche « Maintiens BOOT… » à chaque fois.
- **Écriture verrouillée.** `runSpeakerSetup` commence par `hello` sur la liaison texte. `webSerialLink.write` prend `port.writable.getWriter()` et ne relâche **jamais** ce verrou. Ensuite, `Transport.write` fait `getWriter()` sur un flux verrouillé et lève une erreur.
- **Données perdues.** `webSerialLink.read` ouvre un lecteur, attend 40 ms au plus, puis fait `reader.cancel()`. Annuler le flux jette ce qui arrivait. Des lignes `JARVIS>` peuvent disparaître, et le flux est recréé à chaque lecture.
- **Port USB natif.** Après `hard_reset`, l'ESP32-S3 en USB-Serial-JTAG se déconnecte et revient : l'ancien objet `SerialPort` ne se rouvre pas. Il faut retrouver le port (`navigator.serial.getPorts()`, même VID/PID) avant le `hello` d'après installation. La prise UART (CH343) n'a pas ce problème.

À faire : **un seul propriétaire du port à la fois.**
- Liaison texte : un lecteur unique et permanent qui remplit un tampon, et un écrivain relâché après chaque écriture. Une méthode `release()` ferme proprement les deux (lecteur annulé seulement à l'arrêt).
- Avant esptool : `release()`, puis port **fermé**, puis `Transport.connect()` l'ouvre lui-même. Après `hard_reset` : `transport.disconnect()`, puis port retrouvé (UART : le même ; USB natif : par `getPorts()`), puis la liaison texte rouvre.
- Tests avec un faux port qui reproduit les règles de Web Serial (open deux fois = erreur, flux verrouillé = erreur sur `getWriter`, `cancel` = données jetées). Les tests actuels utilisent un faux programmeur et ne voient rien de tout ça.

### 3. Délais trop courts et liste Wi-Fi absente (`installDriver.ts`, `SpeakerInstall.tsx`)

- `test` attend **2 s par étape**. Or la carte se laisse jusqu'à 20 s pour le Wi-Fi (`net_test_wifi(20000)`), 3 s par recherche mDNS, et la phrase d'accueil passe par Piper. L'installation finira presque toujours en « timeout ». Mets des délais par étape alignés sur ceux de la carte, plus une marge : Wi-Fi 25 s, PC 12 s, pont 8 s, voix 20 s.
- `scan` attend 2 s alors qu'un scan bloquant prend 2 à 4 s. Surtout, le résultat est **ignoré** (`await io.scan()` sans rien en faire), et l'écran demande de **taper** le nom du Wi-Fi. Le cahier demande l'inverse : choisir dans la liste des réseaux que la carte voit. Ordre attendu : carte reconnue → (programme) → `scan` → **écran Wi-Fi avec la liste** (plus « Autre réseau… ») → réglages → test. Ça veut dire que l'écran Wi-Fi vient **après** la reconnaissance de la carte, pas avant.
- Firmware `link.c`, réponse du `scan` : le nom du réseau est mis dans le JSON sans échappement. Un nom avec `"` ou `\` casse la ligne. Échappe-le ou écarte-le.

### 4. Diagnostic et réparation non branchés (partie 4)

- `speaker-firewall.ps1` et `speaker-private.ps1` sont livrés, mais **rien ne les lance**. Il n'y a ni lecture de l'état (règles, profil réseau), ni bouton « Réparer ». L'écran dit pourtant « “Réparer” demande ton accord ». `diag.ts` ne fait que des phrases à partir de valeurs que personne ne mesure. C'était le point le plus utile pour l'utilisateur : c'est ce qui a bloqué la chambre.
- `speaker-firewall.ps1` : la règle « mDNS » est créée avec `-LocalPort $Port` en UDP, donc **UDP 53131**, pas **UDP 5353**. Corrige-la (port mDNS fixe, 5353).
- `speaker-private.ps1` passe en Privé **toutes** les connexions actives, y compris Tailscale, Radmin ou un VPN. Il ne doit toucher que l'interface de la maison (celle des adresses gardées), avec son index passé en argument et vérifié comme nombre.
- À brancher :
  - les contrôles en lecture seule, par un script PowerShell constant qui rend du JSON (règles TCP 53131 et UDP 5353, profil du réseau de la maison) ;
  - le panneau du diagnostic dans Enceintes, et son ouverture toute seule quand le test échoue à `pc` ou `bridge` ;
  - le bouton « Réparer » (élévation par `Start-Process -Verb RunAs`, refus de Windows dit tel quel) ;
  - le second bouton « Passer ce réseau en Privé », avec sa phrase d'explication.

  Tests : lecture du JSON (exemples figés), arguments validés, aucun lancement sans clic.

### 5. Liste des enceintes incomplète (partie 5)

Manquent : « Faire signe » (aucun `identify` dans la réponse du `hello`, ni côté PC ni côté carte), « Renommer », « Changer le Wi-Fi » (chemin court par USB, sans réécrire le programme) et le choix « Remplacer l'enceinte … » à l'écran (`replacePrompt` existe mais n'est pas affiché). Le signal, la version et « Ancienne version » sont faits.

## Moins grave (à faire si le reste est fini)

- L'annonce mDNS n'est ouverte qu'au démarrage du pont. Un changement de réseau (Wi-Fi coupé puis revenu, nouvelle carte réseau) ne la refait pas. Rafraîchis-la quand la liste des interfaces change (contrôle toutes les 60 s, par exemple).
- `ensurePair` utilise `00:00:00:00:00:00` si le `hello` n'a pas donné de MAC : refuse plutôt, sinon deux cartes seraient prises pour la même.
- Rapport : écrire « fait à moitié » quand c'est le cas. Les parties 4 et 5 étaient annoncées « Fait ».

## Ce qui est bien et ne doit pas bouger

`provision_proto.c` et ses tests, `prov_redact` (le mot de passe et la clé ne sortent pas dans le journal série), les clés NVS, `last_ok` écrit seulement quand il change, BOOT 10 s, `setupFlow` (sauf l'ordre du Wi-Fi), `manifest.ts`, `interfaces.ts`, `beginInstall` / `commitInstall` / `abandonInstall`, `/api/speaker/greeting` avec la clé, l'absence de `.bin` dans git, et les tests figés verts.

## Fusion avec `claude/enceinte-micro-diagnostic`

Essai de fusion fait (`git merge-tree`) : seul `AGENTS-COORDINATION.md` est en conflit ; `main.c`, `config.h` et `led.c` se fusionnent seuls. Garde quand même en tête que cette branche (filtre du micro, `MIC_SHIFT 14`, pile LED 4096) passera dans `main` avant toi.

---

## Deuxième relecture (11 novembre, soir) — `3e55eed`

Les cinq points sont corrigés et branchés jusqu'à l'écran : un seul propriétaire du port (lecteur permanent, port fermé avant esptool, port retrouvé après la remise à zéro), délais par étape, liste Wi-Fi vue par la carte, diagnostic et boutons, Faire signe, Renommer, Changer le Wi-Fi, Remplacer. Bon travail.

Trois retouches restent avant ou pendant l'essai sur la carte, à faire sous Windows (Claude Code) :

1. **Politique d'exécution PowerShell** (`main/speaker/repair.ts`). `readStatusScript` et `elevateScript` lancent `powershell.exe -File …ps1` **sans** `-ExecutionPolicy Bypass`. Sur un Windows réglé par défaut (Restricted), les trois scripts sont refusés : le diagnostic dira « Je n'arrive pas à lire le réseau » et « Réparer » échouera. Ajoute `-ExecutionPolicy Bypass` à la lecture et dans la liste d'arguments élevée, comme `synth.ts` le fait déjà.
2. **Permission du micro** (`serialAccess.ts`). Electron appelle le gestionnaire avec `(webContents, permission, requestingOrigin, details)`. Le troisième argument est l'**origine**, pas `mediaType`, et `details.mediaType` n'est plus lu. Le micro marche encore par chance (`origine !== 'video'`), mais une vérification de la caméra passe maintenant. Lis `details.mediaType` comme avant, et corrige le faux de session du test pour qu'il suive la vraie signature.
3. **Diagnostic trop strict** (`speaker-net-status.ps1`). Il ne reconnaît que les règles nommées « Jarvis — enceintes … ». Une règle faite à la main (le cas de l'utilisateur) ou la règle par programme que Windows crée pour Jarvis.exe passe pour absente. Le diagnostic doit dire « ouvert » s'il existe **n'importe quelle** règle entrante active qui autorise TCP 53131 (ou Jarvis.exe) sur le profil du réseau de la maison, et de même pour UDP 5353.

Petit point : `psQuote` refuse les lettres accentuées (`\w` sans le drapeau `u`). Un chemin d'installation sous un nom d'utilisateur accentué ferait échouer « Réparer ». Utilise `[\p{L}\p{N}_.\\: ()\-/]` avec le drapeau `u`.
