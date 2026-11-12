# Choix — deux Jarvis sur le même PC (Live et Test)

12 novembre 2026. Branche `cursor/deux-jarvis`, partie 0 du cahier `docs/specs/deux-jarvis.md`. Rien n'est publié. La version de l'application reste **5.0.76**. `release.sh` n'est pas modifié.

Ce rapport dit ce que les documentations officielles imposent, quelles idées du cahier ne tiennent pas, et la solution la plus simple retenue pour les parties 1 à 4.

## Versions lues

| Pièce | Version dans le dépôt | Où |
| --- | --- | --- |
| Electron | 44.4.5 (`electronVersion` dans `apps/desktop/electron-builder.yml`, dépendance `^44.4.5`) | [API `app`](https://www.electronjs.org/docs/latest/api/app), [API `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) |
| electron-builder | 26.15.3 (`^26.15.3`) | [documentation v26](https://www.electron.build/v26/docs/), [configuration](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/configuration.ts) |
| electron-updater | 6.8.9 (`^6.8.9`) | fichier publié [GitHubProvider.js 6.8.9](https://unpkg.com/electron-updater@6.8.9/out/providers/GitHubProvider.js) |
| Spotify | règles en vigueur (contrôle renforcé le 9 avril 2025, migration attendue en novembre 2025) | [Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri) |
| Google | client « Application de bureau », boucle locale | [OAuth 2.0 for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app) |
| Windows | raccourcis du système | [Raccourcis clavier Windows](https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |

L'API synchrone `safeStorage.encryptString` / `decryptString` est encore celle du code (`vault/store.ts`, `google/tokenStore.ts`). Elle est dépréciée à partir d'Electron 45 et retirée en 46. On ne change pas d'API : Jarvis est en 44.4.5.

## 1. electron-builder — deux constructions, le même code

Le fichier actuel `apps/desktop/electron-builder.yml` fixe déjà l'identité de Live :

- `appId: com.thedexios.jarvis`
- `productName: Jarvis`
- installateur `Jarvis-Setup-${version}.exe`
- NSIS une fois cliqué, raccourci « Jarvis », icône `resources/icon.png`
- publication GitHub `releaseType: release` (fichier `latest.yml`)

electron-builder accepte une autre configuration au moment de la construction (`--config` ou overrides `-c.clé=valeur`) sans second projet. Le script `package:win` actuel ne change pas. `package:win:test` ajoutera seulement des overrides :

- `appId` `com.thedexios.jarvis.test` (le GUID NSIS est dérivé de l'`appId` : deux désinstallations, deux dossiers)
- `productName` « Jarvis Test » (dossier d'installation et nom Electron distincts)
- `artifactName` `Jarvis-Test-Setup-${version}.exe`, sortie `release-test/` (ne mélange pas les fichiers de Live dans `release/`)
- raccourci NSIS « Jarvis Test »
- icône marquée, générée à part (le script d'icônes actuel, sans dépendance native, ne réécrit pas `icon.png` quand on demande l'icône de Test)
- `extraMetadata.jarvisEdition=test` et `productName` écrits dans le `package.json` **de l'application construite**, pas dans celui du dépôt
- `publish.releaseType: prerelease` seulement dans le brouillon `release-test.sh`

`npm run package:win` continue d'appeler `electron-builder --win --publish never` avec le yml actuel.

## 2. Electron — dossier, verrou, coffre

### Dossier de réglages

`app.getPath('userData')` est `appData` + le nom de l'application. Electron prend `productName` s'il existe, sinon `name` ([`app.getName`](https://www.electronjs.org/docs/latest/api/app#appgetname)).

Aujourd'hui, l'installateur a `productName: Jarvis`. Le Jarvis du quotidien est donc `%APPDATA%\Jarvis`. En développement, le `package.json` n'a pas de `productName` (`name` = `@jarvis/desktop`) et `app.setName('Jarvis')` est appelé **après** `requestSingleInstanceLock()`, qui a déjà lu `userData`. On ne déplace pas cet appel pour Live : le dossier de développement reste celui d'aujourd'hui.

`app.setPath` doit être appelé avant `ready` et avant le premier `getPath('userData')`. Si le dossier n'existe pas, `setPath` lève une erreur : il faut le créer avant. Les cookies et le cache suivent `sessionData`, qui pointe par défaut vers `userData` mais doit être fixé **avant** `ready` si on le change ([`setPath`](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path)).

**Live : aucun `setPath`.** Test, tout premier import du processus principal : créer `%APPDATA%\Jarvis Test` (ou l'équivalent Linux), puis `setPath('userData')` et `setPath('sessionData')` vers ce dossier, avant le verrou. Test n'écrit donc pas dans le dossier de Live, y compris le cache.

### Deux verrous

Le verrou de `requestSingleInstanceLock()` est pris **dans** le dossier `userData` (fichier Singleton). Deux dossiers différents, deux verrous. Confirmé par l'équipe Electron : [issue 23691](https://github.com/electron/electron/issues/23691), [issue 18728](https://github.com/electron/electron/issues/18728). Le code actuel prend le verrou au chargement de `main/index.ts`, avant `bootstrap()`. Le `setPath` de Test doit donc être le premier import, pas une ligne au milieu de `bootstrap()`.

`setAppUserModelId` reste appelé au même endroit qu'aujourd'hui. Live garde `com.thedexios.jarvis`. Test utilise `com.thedexios.jarvis.test`, pour que la barre des tâches ne mélange pas les deux fenêtres.

### Coffre (`safeStorage`)

Documentation Electron, Windows : les clés viennent de **DPAPI**. Seul le même compte Windows peut déchiffrer. **Une autre application du même compte le peut aussi.** Ce n'est pas une clé par application.

- macOS : trousseau **par application** (signature). Test ne lit pas le coffre de Live.
- Linux : trousseau du bureau, souvent lié au nom de l'application. Sans trousseau, `basic_text` (mot de passe fixe, peu protecteur).

Le PC de l'utilisateur est Windows. **Le coffre Live y est lisible par Test**, sans contourner le chiffrement : on essaie `decryptString` sur `coffre.bin` et `google-token.bin`. Si ça réussit, on recopie les octets **encore chiffrés** dans le dossier de Test. Le clair ne va ni dans un journal, ni dans `settings.json`. Si le déchiffrement échoue (autre système, coffre illisible), on ne copie pas ces fichiers et Test demande de reconnecter, avec un guide court.

Le jeton Spotify (`spotify-token.json`) n'est **pas** dans `safeStorage` : c'est un JSON en clair, mode `0600` (PKCE, déjà le cas). Le copier n'est pas un contournement de chiffrement. On le copie en lecture seule avec les autres secrets seulement quand le fichier est lisible. S'il manque, le guide dit de reconnecter Spotify.

On ne réimplémente pas DPAPI, on n'écrit pas les clés en clair, on ne « répare » pas un coffre illisible.

Guide si le coffre n'est pas lisible : « Les clés de Jarvis Live restent chiffrées pour lui. Ici, reconnecte seulement ce dont tu as besoin : Spotify, Google, et les clés API dans Réglages. »

## 3. Mises à jour — le cahier et electron-updater 6.8.9

Décision D1 inchangée : Live n'a **jamais** de suffixe `-beta` (ni `-test`). `allowPrerelease` est déjà `false` dans `updater.ts`. Avec ça, electron-updater 6.8.9 interroge `/releases/latest`, qui **ignore les préversions**. Live ne verra pas Test.

Ce que le code 6.8.9 fait vraiment (fichier cité plus haut) :

- le canal d'une préversion est le **premier morceau semver** du tag (`5.1.0-test.1` → canal `test`, fichier `test.yml`) ;
- un canal perso (`test`) ne prend que les tags de ce canal ;
- les canaux `alpha` et `beta`, eux, acceptent aussi les versions stables ;
- si `test.yml` est absent, la bibliothèque **retombe sur `latest.yml`**.

**Idée du cahier qui ne suffit pas :** numéroter Test `5.1.N` sans suffixe, même publié en préversion GitHub. Pour semver, `5.1.0` est une version stable. electron-builder écrirait `latest.yml`. Si cette publication n'est pas marquée préversion, Live (5.0.x) la prendrait comme mise à jour. Si elle est marquée préversion mais sans `-test`, Test avec `allowPrerelease` et sans canal explicite peut prendre la première entrée du flux, y compris une version de Live.

**Choix retenu :**

- Live : inchangé. Canal `latest`, `allowPrerelease: false`, fichier `latest.yml`, versions `5.0.x` sans suffixe.
- Test : versions `5.1.N-test.M` (exemple `5.1.0-test.1`), publication GitHub **prerelease**, fichier `test.yml` seulement (pas de `latest.yml` dans cette publication, pour éviter le repli).
- `autoUpdater.channel = 'test'` et `allowPrerelease = true` seulement pour Test.
- Le bouton « Vérifier » de Live continue d'appeler `githubLatestYmlUrl()` (`/releases/latest/download/latest.yml`). Test lit le flux public `releases.atom`, garde le tag `-test` le plus haut, puis télécharge `test.yml` de ce tag. `compareSemver` actuel **ignore** le suffixe (`5.1.0-test.2` égale `5.1.0-test.1`) : on ne le change pas. Test compare le suffixe à part.
- Cette mission **ne change pas** la version 5.0.76 et **ne publie pas**. Le brouillon `release-test.sh` refusera de publier tant que la version n'est pas de la forme `5.1.N-test.M`. Claude Code le relira avant tout lancement.

Les deux ne se mélangent pas : autre `appId`, autre dossier, autre installateur, Live sourd aux préversions, Test sourd aux tags qui ne finissent pas par `-test.N`.

## 4. Spotify

L'adresse du code est fixe : `http://127.0.0.1:53124/callback` (`SpotifyProvider.ts`). Spotify exige une correspondance exacte avec le tableau de bord, **sauf** pour une adresse de boucle enregistrée **sans numéro de port** : dans ce cas seulement, le port peut varier ([documentation](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)).

On ne sait pas si le tableau de l'utilisateur a le port ou non. Le code et les tests figent le port 53124. **Inventer un port pour Test casserait la connexion** tant que cette adresse n'est pas ajoutée au tableau.

Le port n'est ouvert que le temps de la connexion, pas en permanence.

**Choix :** Test utilise **la même** adresse que Live. Si le port est déjà pris (Live est en train de connecter Spotify), Test le dit et n'en prend pas un autre. Pas de second URI, pas de guide Spotify à moins que l'utilisateur veuille plus tard une adresse dédiée.

## 5. Google

Le client est déjà un « Application de bureau » (`settings.ts`). Google accepte `http://127.0.0.1:<port>` **quel que soit le port** pour ce type de client ([documentation](https://developers.google.com/identity/protocols/oauth2/native-app)). Le code préfère 53125 et, si le port est pris ou refusé (`EADDRINUSE`, `EACCES`), en prend un libre (`oauth.ts`). Les tests le vérifient.

**Choix :** Test garde le même 53125 et le même repli. Pas d'adresse à ajouter dans Google Cloud. Ce port n'est ouvert que pendant la connexion.

## 6. Raccourci de Test

`Ctrl+Espace` reste à Live (`Control+Space`). Le repli actuel, si le raccourci choisi est refusé, est aussi `Control+Space`. Test ne doit **pas** faire ce repli : il prendrait la porte de Live.

`Ctrl+Alt+Espace` (`Control+Alt+Space`) n'est pas un raccourci du système Windows. `Win+Espace` change la langue ; on ne le prend pas.

**Choix :** raccourci de Test `Control+Alt+Space`, enregistré seulement si l'utilisateur active cette fonction, et seulement s'il est libre. S'il est pris, message clair, pas de repli vers `Control+Space`.

## 7. Une seule table

Elle vit dans `packages/core` (pure, testée) et est lue au démarrage. Pas de `if (test)` dispersés : le code demande à la table le nom, le dossier, le raccourci, le port, le canal, le badge.

| | Live | Test |
| --- | --- | --- |
| id | `live` | `test` |
| nom | Jarvis | Jarvis Test |
| appId | `com.thedexios.jarvis` | `com.thedexios.jarvis.test` |
| dossier | celui d'aujourd'hui, **sans** `setPath` | `Jarvis Test`, fixé avant le verrou |
| raccourci | `Control+Space`, repli identique | `Control+Alt+Space`, pas de repli |
| base des ports | 53124 | 53224 |
| téléphone | base + 6 = **53130** | base + 6 = 53230 |
| enceintes | base + 7 = **53131** | base + 7 = 53231 |
| Spotify | **53124** (les deux : adresse enregistrée) | 53124 |
| Google | **53125** (les deux : préféré, puis port libre) | 53125 |
| fonctions réservées | comme aujourd'hui (enceintes et téléphone coupés tant que le réglage l'est) | mot de réveil, enceintes, téléphone et raccourci **coupés**, phrase « Réservé à Jarvis Live » |
| canal | `latest`, pas de préversion | `test`, préversions `-test` seulement |
| badge | aucun | pastille orange `TEST` |

Les ports Spotify et Google ne suivent pas le décalage : les changer cassait la connexion (Spotify) ou ne servait à rien (Google accepte déjà un autre port). Ils sont quand même **dans la table**, pas écrits en dur à côté. Téléphone et enceintes, eux, suivent la base : Test ne lie jamais 53130 ni 53131. Les enceintes déjà réglées continuent de parler à Live. Si l'utilisateur active quand même le pont de Test, on vérifie que **son** port (53231) est libre ; s'il est pris, on le dit et on n'écoute pas.

Le mot de réveil « Jarvis » n'est pas un port. Dans Test il ne démarre pas tant que l'utilisateur n'a pas appuyé sur le bouton. On ne coupe pas l'écoute de Live.

L'édition vient de `JARVIS_EDITION=test` (développement et tests) ou, dans l'installateur, de `jarvisEdition` écrit à la construction. Sans rien : `live`.

## 8. Recopie (partie 3) — liste exacte

Lecture seule du dossier de Live. Aucune ouverture en écriture. Le journal de **Test** note ce qui a été copié.

Copié :

- `settings.json` (réglages). Dans la copie de Test seulement, le raccourci est remis à `Control+Alt+Space` pour ne pas enregistrer celui de Live.
- `personalization.json`
- `questionnaire.json`
- `knowledge-index.json` **sans** les blocs d'apprentissage (champ `learning`, source `learning:…`)
- `memory/` (souvenirs : profile, preferences, projects, conversations de mémoire)
- `developer/projects/` (registre, mémoire des projets, missions de ces projets)
- `developer/code-model.json` (modèle de code choisi, pas un entraînement)

Jamais :

- `conversations/` (historique des discussions)
- `audit-log.json`
- `learning/`, `wake-learning/`, `developer/knowledge/learned`
- `phone.json`, `speakers.json` (ça rallumerait téléphone et enceintes)
- le dossier de Live, en écriture, dans tous les cas

Secrets : voir la section 2. Premier écran de Test seulement : « Copier mes réglages de Jarvis Live ? » Oui / Partir de zéro. Ensuite, Réglages → Application → « Recopier depuis Live », confirmation en deux temps (le bouton déjà utilisé pour les actions lourdes).

`parseSettings({})` ne gagne aucune clé. L'accord « activer quand même » est un fichier à part dans le dossier de Test (`edition.json`), comme `phone.json`, pas un champ de réglage.

## 9. Ce qui ne change pas

- Live : même application, mêmes réglages, mêmes ports, même raccourci, même canal de mise à jour.
- Version 5.0.76. Pas de fusion dans `main`. Pas de publication.
- `release.sh` intact. Brouillon `release-test.sh` à côté, non lancé ici.
- Pas de dépendance native. Pas de régénération des `__golden__`.
- Fichiers laissés à Claude Code (`claude/live-5077`) : `speaker/repair.ts`, `serialAccess.ts`, la version dans `package.json`. `main/index.ts` : un import en tête et le moins possible ensuite.
- Modèles Ollama : ils restent dans Ollama, pas dans `userData`. Rien n'est retéléchargé.
