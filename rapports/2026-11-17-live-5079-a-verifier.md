# Live 5.0.79 : essais à faire ce soir (17 novembre 2026)

Branche `claude/live-5079`, partie de `main` (5.0.78), préparée par Claude Code sur le PC Windows, sans l'utilisateur. **Rien n'est fusionné dans `main`, rien n'est publié, rien n'est flashé.** Jarvis Live installé et Jarvis Test installé n'ont pas été touchés.

## 1. Ce que contient la 5.0.79

Deux fusions et le numéro de version, rien d'autre :

- **`claude/ecran-infos`** : le PC envoie une information à l'écran de l'enceinte (en-tête `X-Jarvis-Ecran`). Deux sources : le bilan de santé qui passe au rouge, et l'outil `afficher_sur_enceinte`. Rapport : `rapports/2026-11-17-ecran-infos.md`.
- **`claude/enceinte-ecran`** : le programme de l'enceinte avec l'écran (mascotte, heure, messages de souci, informations du PC), avec la correction de la lettre accentuée en fin de texte. Rapport : `rapports/2026-11-16-enceinte-ecran.md`.
- Version **5.0.79** : `package.json` (racine et bureau), `package-lock.json`, et l'étiquette du programme de l'enceinte (`JARVIS_FW_VERSION`).

Les deux fusions se sont faites sans conflit.

## 2. Avant de commencer

1. **Brancher l'écran, carte débranchée** : GND → GND, VCC → **3V3** (jamais 5V), SDA → IO8, SCL → IO9. Le programme attend un écran SH1106 de 1,3 pouce. Pour un autre modèle, me le dire avant le flash : c'est une ligne à changer (`DISPLAY_TYPE`).
2. **Flasher l'enceinte** par USB, avec toi : `pio run -t upload` dans `firmware/jarvis-speaker`. Le Wi-Fi et la clé sont gardés dans la carte, à part du programme : ils devraient rester. Sinon, on la réinstalle par Réglages → Enceintes.
3. **Lancer la 5.0.79 sans l'installer** : fermer Jarvis Live (icône près de l'horloge → Quitter), puis `npm run dev` depuis cette branche. Elle utilise les mêmes données que la Live : mêmes réglages, mêmes enceintes.

## 3. Les essais

### A. L'écran seul (après le flash)

| # | Essai | Attendu |
| --- | --- | --- |
| E1 | Démarrer l'enceinte, écran branché | un message court au démarrage, puis la mascotte. Dans le journal de la carte : pas de « aucun écran trouvé » |
| E2 | Dire « Jarvis », puis une question | la mascotte écoute, réfléchit, puis parle (la bouche suit le son) |
| E3 | Laisser l'enceinte tranquille 2 minutes | l'heure et la date de Paris, lumière baissée ; l'affichage se décale un peu chaque minute |
| E4 | Quitter Jarvis sur le PC, puis dire « Jarvis » | « PC injoignable » ; la mascotte revient quand Jarvis est relancé |
| E5 | Le réveil, le micro et le son avec l'écran branché | comme avant : « Jarvis » entendu 3 fois sur 3, pas de son haché |
| E6 | Débrancher l'écran (carte éteinte), redémarrer | l'enceinte marche comme avant, sans écran |

### B. Les informations envoyées par le PC

| # | Essai | Attendu |
| --- | --- | --- |
| E7 | Taper dans Jarvis : « Affiche Terminé sur l'enceinte de la chambre » | Jarvis répond « envoyé » (jamais « affiché ») ; dans les 30 s, l'écran montre « Terminé », **avec le é**, pendant 60 s, puis la mascotte revient |
| E8 | Dire la même phrase à l'enceinte | l'information arrive avec la réponse, sans attendre 30 s |
| E9 | « Affiche Dîner, à table ! sur l'enceinte » avec un titre et une ligne | le titre en haut, la ligne dessous, accents justes |
| E10 | Un texte très long (plus de 100 lettres) | coupé proprement, sans signe bizarre à la fin |
| E11 | Couper Ollama, puis « fais ton bilan » | l'écran montre « Jarvis » et la phrase du bilan pendant 60 s, une seule fois ; un second « fais ton bilan » n'affiche rien de plus |
| E12 | Relancer Ollama, « fais ton bilan », recouper Ollama, « fais ton bilan » | la phrase s'affiche de nouveau : c'est un nouvel incident |
| E13 | « Affiche Test sur l'enceinte de la cuisine » (nom qui n'existe pas) | Jarvis dit que cette enceinte n'existe pas et nomme celles qui sont reliées ; rien à l'écran |
| E14 | Pendant qu'une information est affichée, dire « Jarvis » | la mascotte écoute tout de suite : l'activité passe avant l'information |

### C. Rien d'autre ne doit avoir changé

| # | Essai | Attendu |
| --- | --- | --- |
| E15 | Couper le pont des enceintes (Réglages → Enceintes), puis « Affiche Test sur l'enceinte » | l'outil n'est plus proposé : Jarvis répond comme avant la 5.0.79, sans « envoyé » |
| E16 | À l'enceinte : « quelle heure est-il ? », « mets de la musique », « stop » | comme en 5.0.78 |
| E17 | « Mets du jazz sur l'enceinte » | c'est de la musique (Spotify), pas un affichage |

## 4. Si tout est bon

Sur ta décision seulement : fusion de `claude/live-5079` dans `main`, puis `bash release.sh` depuis `main`. `release.sh` recompile le programme de l'enceinte et le met dans l'installateur. Les enceintes déjà installées ne se mettent pas à jour seules : chacune se flashe par USB.

## 5. Ce que je n'ai pas pu vérifier

- L'écran lui-même : aucun essai sur la carte. Le programme compile et ses tests sur PC sont verts, mais le câblage, le modèle d'écran et la lisibilité ne se voient qu'en vrai.
- Le bilan de santé ne tourne pas tout seul en cours de journée (démarrage, réglages, « fais ton bilan ») : un souci qui apparaît dans la journée ne s'affiche qu'au bilan suivant. C'est un choix, noté dans `rapports/2026-11-17-ecran-infos.md`.
- Le binaire compilé aujourd'hui ne sert qu'à vérifier la compilation. Il n'est pas dans le dépôt.

## 6. Essais du 17 novembre au soir (faits par Claude Code, utilisateur absent)

L'enceinte « chambre » est flashée en 5.0.79 et se présente au PC. Jarvis 5.0.79 tourne en `npm run dev` à la place de la Live. **Personne n'a regardé l'écran ni parlé à l'enceinte** : tout ce qui suit est vérifié côté PC. Les phrases tapées passent par la vraie fenêtre ; les phrases « dites » sont des fichiers de voix de synthèse envoyés au pont avec la clé de l'enceinte ; l'information d'écran est lue dans l'en-tête `X-Jarvis-Ecran` que le PC renvoie.

### Le flash

- Premier flash : réussi, mais l'enceinte ne se connectait plus. L'ancien programme (5.0.75) portait le Wi-Fi et la clé dans son `secrets.h`, pas dans la mémoire de la carte. Second flash avec ce `secrets.h` (pris dans le dépôt du matériel, retiré ensuite, binaire compilé supprimé) : l'enceinte se présente en 5.0.79.
- Le journal de la carte ne sort pas sur le port USB (0 octet lu) : la ligne « écran trouvé » n'a pas pu être lue.

### Résultats

| # | Résultat | Détail |
| --- | --- | --- |
| E1 | **pas fait** | il faut regarder l'écran ; journal de la carte illisible par l'USB |
| E2 | **pas fait** | il faut parler et regarder la mascotte |
| E3 | **pas fait** | il faut regarder l'écran |
| E4 | **pas fait** | il faut parler et regarder l'écran |
| E5 | **pas fait** | il faut parler à l'enceinte |
| E6 | **pas fait** | il faut débrancher l'écran |
| E7 | **bon côté PC après correction** | réponse « Envoyé à 1 enceinte : « Terminé » », en-tête `Terminé||60` avec le é. Avant correction, le modèle répondait « a été affiché ». Écran non regardé |
| E8 | **bon côté PC après correction** | l'information revient avec la réponse à la phrase (`Terminée||60`). Avant correction, le modèle répondait « Affichage terminé » sans appeler l'outil : rien n'était envoyé |
| E9 | **bon côté PC** | en-tête `Dîner|à table !|60`, accents justes. Écran non regardé |
| E10 | **bon côté PC** | titre coupé à un mot (47 octets au plus), ligne coupée à 95 octets, aucun caractère cassé. Écran non regardé |
| E11 | **bon côté PC** | Ollama coupé : `Jarvis|Ollama ne répond pas : les modèles de ce PC sont injoignables.|60`, une seule fois ; le second bilan n'envoie rien |
| E12 | **bon côté PC** | Ollama relancé puis recoupé : la phrase repart |
| E13 | **bon après correction** | « Je n'ai pas d'enceinte nommée « cuisine ». Enceintes reliées : chambre. Rien n'a été affiché. » Avant correction : 3 échecs sur 3 (le modèle oubliait le titre, puis disait que l'enceinte affichait « Test ») |
| E14 | **pas fait** | il faut parler et regarder l'écran |
| E15 | **bon** | pont coupé : l'outil n'est plus proposé, aucune réponse « envoyé » ; pont rétabli ensuite |
| E16 | **bon côté PC** | « quelle heure est-il » : l'heure, sans modèle ; « stop » : 204, rien de dit. « Mets de la musique » : Jarvis demande l'appareil (Phantom, Chambre ou PC), puis le modèle ajoute une phrase de trop (« je vais démarrer la musique ») ; rien n'a été lancé. Ce chemin n'a pas changé depuis la 5.0.78 |
| E17 | **bon** | « Mets du jazz sur l'enceinte » part à l'équipe Musique (Spotify), aucun affichage |

### Corrections faites pendant les essais (sur `claude/live-5079`, testées)

1. **Demande simple lue par règles, sans modèle** (`parseSpeakerScreenRequest`, `packages/core/src/speaker/screen.ts` ; `speakerScreenReply`, `session.ts`) : « Affiche X sur l'enceinte [de la Y] », « Affiche A, B sur l'enceinte », « Affiche sur l'enceinte : X », « le titre A et la ligne B ». L'outil est appelé directement (journal d'audit), sa phrase est la réponse. Une autre tournure va au modèle comme avant.
2. **Réponse du modèle remplacée par celle de l'outil** (`agent.ts`) : quand le tour n'a appelé que `afficher_sur_enceinte`, la réponse est la phrase de l'outil, mot pour mot, sans relancer le modèle (il disait « affiché »).
3. **Titre oublié** (`tools/speakerScreen.ts`) : si le modèle met le texte dans `ligne` sans `titre`, la ligne sert de titre.

Sans enceinte reliée, rien ne change : l'outil est absent et ces chemins ne s'ouvrent pas. Aucun `__golden__` régénéré.

### Reste à faire avec toi

E1 à E6 et E14 (écran, voix, réveil), et un coup d'œil à l'écran pour E7, E9 et E10 (le é, les deux lignes, la coupe). À la voix, la réponse à « affiche … » dure 11 s (la phrase de l'outil est longue) : à raccourcir si ça gêne.

```
RAPPORT DE VÉRIFICATION (après les essais et les corrections)
Lancement : OK (npm run dev, Jarvis 5.0.79 ; enceinte flashée et vue en 5.0.79)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : OK (cœur 215 fichiers, 2514 tests ; bureau 159 fichiers, 829 tests, 8 ignorés par leur propre condition ; aucun __golden__ régénéré)
Secrets   : OK (secrets.h retiré du dépôt après le flash, binaire compilé supprimé ; clé jamais affichée)
Fichiers modifiés : packages/core/src/speaker/screen.ts, screenRequest.test.ts, agent/agent.ts, agent/agent.test.ts ; apps/desktop/src/main/session.ts, tools/speakerScreen.ts, tools/catalog-speaker-screen.test.ts ; ce rapport
Prêt à fusionner : NON (E1 à E6 et E14 restent à faire avec l'utilisateur)
À corriger : rien de connu côté PC
Testé en vrai (à la voix, sur le PC) : EN PARTIE (fenêtre réelle et pont réel, voix de synthèse ; ni l'écran ni la vraie voix)
```

## RAPPORT DE VÉRIFICATION (préparation, avant les essais)

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npx electron-vite build ; pio run dans firmware/jarvis-speaker : SUCCESS en 227 s, RAM 27,1 %, flash 53,6 %, firmware.bin 1,69 Mo, srmodels.bin 284 Ko, aucun avertissement)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : OK (cœur 214 fichiers, 2507 tests ; bureau 159 fichiers, 828 tests, 8 ignorés par leur propre condition ; host-tests/run.sh dans WSL : code 0 ; aucun __golden__ régénéré)
Secrets   : OK (aucune clé, aucun nom de réseau ; compilé sans secrets.h ; le binaire n'est pas commité)
Fichiers modifiés : package.json (racine et bureau), package-lock.json, firmware/jarvis-speaker/include/config.h (étiquette 5.0.79), CLAUDE.md, AGENTS-COORDINATION.md, ce rapport ; le reste vient des deux fusions
Prêt à fusionner : NON (essais sur la carte avec l'utilisateur d'abord)
À corriger : rien de connu
Testé en vrai (à la voix, sur le PC) : PAS FAIT (rien de flashé, utilisateur absent)
```
