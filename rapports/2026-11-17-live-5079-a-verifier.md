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

## RAPPORT DE VÉRIFICATION

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
