# Informations sur l'écran de l'enceinte, côté PC (17 novembre 2026)

Branche `claude/ecran-infos`, partie de `main` (5.0.78), faite par Claude Code sur le PC Windows, sans l'utilisateur. Mission 7 de la feuille de route, pour la **Live 5.0.79** (exception validée le 17 novembre). **Rien n'est fusionné, publié ni flashé. Jarvis Test installé n'a pas été touché.** La version reste 5.0.78.

## Ce qui est fait

1. **Cœur** (`packages/core/src/speaker/screen.ts`, fonctions pures) :
   - `speakerScreenHeader({ title, line?, seconds? })` rend la valeur de l'en-tête `X-Jarvis-Ecran`, toujours sous la forme `titre|ligne|secondes` ;
   - le texte est mis sur une ligne (retours à la ligne et caractères de contrôle retirés), coupé à 47 octets pour le titre et 95 pour la ligne sans casser un accent ni un émoji, puis encodé pour une URL (`|`, `%` et `+` compris) ;
   - la durée va de 1 à 300 s, 20 par défaut ;
   - sans titre lisible, la fonction rend `null` : rien n'est envoyé ;
   - `speakerScreenClear()` rend `-`.
2. **Pont** (`apps/desktop/src/main/speaker/server.ts`) : `showOnSpeaker(cible, info)`.
   - La cible est le nom d'une enceinte (sans casse ni accent) ou `toutes`.
   - Une file par enceinte, 3 en attente au plus : la plus ancienne saute.
   - L'information part une seule fois, sur la prochaine réponse à cette enceinte (`hello` ou `turn`).
   - Elle est jetée si sa durée passe avant l'envoi.
   - Rien n'est écrit sur le disque. Pont coupé ou enceinte retirée : la file est oubliée.
3. **Deux sources seulement** :
   - **le bilan de santé** : quand un contrôle passe au rouge, « Jarvis » et la phrase du bilan partent à toutes les enceintes pendant 60 s, une fois par incident (`HealthScreenWatch`, dans le cœur) ;
   - **l'outil `afficher_sur_enceinte`** (`safe`) : titre, ligne, enceinte et durée facultatives. Il n'est proposé que si le pont tourne et qu'une enceinte est reliée (`isAvailable`).

## Mes choix

- **L'information est prise au moment où les en-têtes de la réponse sont écrits**, pas à l'arrivée de la phrase. « Affiche … sur l'enceinte » dit à l'enceinte elle-même part donc avec la réponse de cette phrase, sans attendre le prochain `hello`.
- **Sur `turn`, l'en-tête part quel que soit le code** (WAV, 204, erreur) : le programme de l'enceinte le lit sur toutes les réponses.
- **L'outil affiche 60 s par défaut, pas 20.** L'enceinte ne contacte le PC que toutes les 30 s : une information de 20 s serait souvent jetée avant d'être envoyée. La fonction du cœur garde 20 s par défaut, comme la carte.
- **Avec le chef d'orchestre, l'outil est dans l'équipe PC.** Une règle express (« affiche / écris / montre … sur l'enceinte ») y envoie la demande sans modèle. Cette règle n'existe que si l'outil est proposé : sans enceinte reliée, le chemin est celui d'avant. « Mets … sur l'enceinte » reste de la musique.
- **La réponse de l'outil dit « envoyé », jamais « affiché »** : le PC ne peut pas vérifier l'écran.
- **Le bilan ne tourne pas plus souvent qu'avant** (démarrage, réglages, « fais ton bilan »). Je n'ai pas ajouté de contrôle périodique : ce serait une nouveauté. Un souci qui apparaît en cours de journée ne s'affichera donc qu'au prochain bilan.
- **Une enceinte en cours d'installation** (pas encore confirmée) ne reçoit rien.

## Défaut trouvé dans le programme de l'enceinte (corrigé, non flashé)

En testant avec les mêmes cas que la carte, j'ai vu que `display_info_parse` retirait toujours la dernière lettre accentuée d'un titre ou d'une ligne, même entière : « Terminé » se serait affiché « Termin ».

- Correction sur `claude/enceinte-ecran` (`1311e60`) : seule une suite incomplète en fin de tampon est retirée.
- Test ajouté dans `host-tests/display_test.c`, rouge avant, vert après. `host-tests/run.sh` : OK (WSL).
- Non recompilé avec PlatformIO, non flashé.

## Aussi dans la branche

- `eslint.config.js` ignore `release-test/` et `.gitignore` ignore `release-test/` et `apps/desktop/build-test/`. Ces dossiers, laissés par la construction de Jarvis Test, faisaient échouer le lint de `main` sur ce PC (70 erreurs), donc aussi `release.sh`. La ligne d'ESLint est la même que sur `claude/dev`.

## Tests ajoutés

- `packages/core/src/speaker/screen.test.ts` : les cas de `display_info_parse` (lecture comme la carte), l'encodage, la coupe, les bornes, la règle express.
- `packages/core/src/health/screen.test.ts` : une fois par incident, orange et vert muets, nouvel incident après réparation.
- `apps/desktop/src/main/speaker/server.test.ts` (fausse enceinte, vrai port) : en-tête présent sur `hello` et sur `turn` (WAV et 204), une seule fois ; jeté une fois sa durée passée ; 3 en attente au plus ; cible par nom ou `toutes` ; information demandée pendant la phrase ; jamais sur un 401.
- `apps/desktop/src/main/tools/catalog-speaker-screen.test.ts` : sans enceinte reliée, catalogue identique (profils complet et modeste) ; avec une enceinte, un seul outil en fin de catalogue ; comportement de l'outil.

## À faire avec l'utilisateur

1. Relecture par Claude.
2. Compiler et flasher `claude/enceinte-ecran` (avec la correction de l'accent), écran branché.
3. Dans Live en dev ou après fusion : dire ou taper « Affiche Terminé sur l'enceinte de la chambre », et vérifier l'écran dans les 30 s.
4. Couper Ollama, lancer « fais ton bilan » : l'écran doit afficher « Jarvis » et la phrase du bilan pendant 60 s, une seule fois.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npx electron-vite build)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint, avec release-test ignoré)
Tests     : OK (cœur 214 fichiers, 2507 tests ; bureau 159 fichiers, 828 tests, 8 ignorés par leur propre condition ; aucun __golden__ régénéré)
Secrets   : OK (aucune clé, aucun nom de réseau ; l'information ne part jamais sans jeton)
Fichiers modifiés : core speaker/screen.ts, health/screen.ts, index, agent/orchestra.ts, agent/orchestraTeams.ts ; bureau speaker/server.ts, tools/speakerScreen.ts, tools/index.ts, session.ts (2 lignes), index.ts ; tests ; eslint.config.js, .gitignore ; CLAUDE.md, coordination, ce rapport
Prêt à fusionner : NON (relecture, puis essai sur la carte avec l'utilisateur)
À corriger : rien de connu ; le bilan ne tourne pas tout seul en cours de journée (choix noté ci-dessus)
Testé en vrai (à la voix, sur le PC) : PAS FAIT (écran non flashé, utilisateur absent)
```
