# Jarvis Test 5.1.0-test.1 — préparation (nuit du 16 au 17 novembre 2026)

Branche `claude/dev`, faite par Claude Code sur le PC Windows pendant la nuit, sans l'utilisateur. **Rien n'est publié. Rien n'est fusionné dans `main`.** L'installateur est construit, mais cette nuit il n'a été ni installé ni lancé (voir « À savoir » pour l'installation de la veille).

## Ce qui est dedans

`claude/dev` part de `main` (5.0.78, avec la feuille de route `claude/feuille-autonomie` fusionnée cette nuit). Les fusions, dans l'ordre demandé :

1. `cursor/deux-jarvis` : un conflit dans `AGENTS-COORDINATION.md`, lignes des deux côtés gardées.
2. `claude/lot-b-construction` (lot B et carnet) : conflit de `session.ts`, résolu **exactement comme dans `claude/test-preparation`** (`rapports/2026-11-13-preparation-jarvis-test.md`). `routeTurn` reçoit `previousTeam` (Live), puis `gap` (carnet). `askRouter` et `askBrain` reçoivent `notice` et rendent `{ team, text }`. Le fichier obtenu est identique, octet pour octet, à celui essayé la veille sur la branche `dev`. Le test du brouillon qui fait passer les deux côtés dans un même tour est repris (`orchestra-session.test.ts`).
3. `claude/jeu-conversations` (journal du tour) : ce travail part de `main`, pas du lot B. D'où 5 conflits :
   - `ipc.ts` : les deux côtés ajoutaient le même champ `place`, de même forme. Le type `CarnetPlace` du lot B est gardé, et son commentaire nomme aussi le journal.
   - `session.ts` : les règles du quotidien du lot B sont gardées, avec `turnStartedAt` du journal juste avant.
   - Deux fichiers de test : même contenu, la version mise en forme est gardée.
   - `AGENTS-COORDINATION.md`.

## Ce que j'ai changé, et pourquoi

- **Notes et routines en écriture sûre** (`packages/core/src/quotidien/fichiers.ts`). Le cœur ne peut pas importer `safeFile.ts`, qui vit dans le bureau. `NotesBook` et `RoutineBook` reçoivent donc un `StateFileIO`, et Jarvis leur donne `safeTextStateIO`, construit sur `readStateFile` et `writeStateFile` de la 5.0.78. Sans `io` (tests du cœur), ils gardent le comportement du lot B.
  - Avant : un `notes.json` rempli de zéros se lisait comme une liste vide, et la note suivante l'écrasait. C'est le même piège que `speakers.json` le 13 novembre.
  - Maintenant : le fichier abîmé est mis de côté, jamais effacé, et le `.bak` est repris. Le bilan de santé le signale, comme pour les autres fichiers d'état.
  - Test : `apps/desktop/src/main/quotidien/safeBooks.test.ts`.
- **Journal du tour sur la table d'édition** (revue `docs/revues/2026-11-16-jeu-conversations.md`, point 1). `editionTest()` vaut maintenant `edition().id === 'test'` : `main/edition.ts` passe par la table de `packages/core/src/edition.ts`. La détection propre au journal (`editionCuite`) est retirée.
- **Une réponse toute faite du quotidien est notée sans modèle.** Ce problème vient de la fusion, et la revue ne pouvait pas le voir. Le briefing, les notes, les routines et l'imprimante répondent sans modèle, mais le journal les notait avec le fournisseur et le modèle du chat. `reponses.jsonl` aurait donc appris à un modèle une réponse écrite par le code de Jarvis.
  - Correction : `journaliserTour(…, { fixedReply })`, avec `aucun` comme fournisseur.
  - Test : `turn-journal.test.ts`, « une réponse fixe du quotidien… ».
  - Le point 2 de la revue (chat **sans** orchestre, réponses forcées) n'est pas traité : la revue le laisse pour plus tard.
- **Jarvis Test cherche Live au bon endroit.** Live écrit dans `%APPDATA%\@jarvis\desktop` : Electron prend le nom du paquet. Test cherchait `%APPDATA%\Jarvis`, qui n'existe pas sur ce PC. « Copier mes réglages de Jarvis Live » n'aurait donc rien trouvé. `main/liveDir.ts` cherche `@jarvis\desktop`, puis `Jarvis`. Test : `liveDir.test.ts`. Le script de la carte a le même défaut d'étiquette (il compte bien ces conversations, mais les appelle « développement »).
- **Construction de Test** (`scripts/packageTestConfig.mjs`), deux défauts trouvés à la première construction :
  - elle écrivait `latest.yml`, le fichier que suit Live. Elle passe maintenant `-c.publish.channel=test`, ce qui donne `test.yml` et `channel: test` dans `app-update.yml` ;
  - elle partageait avec Live le dossier des mises à jour téléchargées (`@jarvisdesktop-updater`). Le paquet est renommé `jarvis-test` dans l'installateur seulement, ce qui donne le dossier `jarvis-test-updater`. Le réglage `publish.updaterCacheDirName` est ignoré par electron-builder, d'où ce choix. Les données de Test n'en dépendent pas : `userData` est fixé à « Jarvis Test ».
- **`editionCopy.test.ts` vert sous Windows.** Le faux disque construisait ses clés avec `path.join`, qui donne des `\`, alors que le module joint avec `/`. Les 4 tests échouaient sous Windows ; le code était juste.
- **Lint** : `**/release-test/**` est ajouté aux exclusions d'ESLint. Après une construction de Test, `npm run lint` relisait le code tiers de `win-unpacked` (70 erreurs), et `release.sh` de Live se serait arrêté.
- **Version** `5.1.0-test.1` : `package.json` racine, `apps/desktop/package.json` et `package-lock.json`. Le programme de l'enceinte garde 5.0.78.

## À savoir

- **Une branche `dev` existe aussi sur GitHub.** C'est mon premier essai, fait la veille au soir avant la consigne de nuit, sans `jeu-conversations`. Tout son travail est repris sur `claude/dev`. Je ne l'ai pas supprimée : à toi de dire si on l'efface.
- **Jarvis Test est déjà installé sur le PC**, depuis la veille au soir (`%LOCALAPPDATA%\Programs\jarvis-test`), construit à partir de `dev`. Il n'a jamais été lancé. Cette nuit, je ne l'ai pas désinstallé et je n'ai rien installé. Pour les essais, installe l'installateur de cette nuit (`apps/desktop/release-test/Jarvis-Test-Setup-5.1.0-test.1.exe`, SHA-256 `A6C2A918E0F9B652…`) : il remplace l'autre.
- L'installateur a été construit avant le commit du lint (`a54673a`). Ce commit ne change que `eslint.config.js` : l'application est la même.
- Les clés API de Live ne passeront sans doute pas dans Test. Le coffre est chiffré par une clé propre à chaque application, et Test le dira. Spotify et Google se reconnectent dans Test.

## Essais à faire avec moi

> Énoncés corrigés le 19 novembre, après les essais du 18 (`rapports/2026-11-18-jarvis-test-essais.md`) : essais 1 à 4.

1. **Installer** le dernier `Jarvis-Test-Setup-5.1.0-test.N.exe`. Si Jarvis Test tourne (icône près de l'horloge), l'installateur le ferme lui-même depuis le 19 novembre ; avec un installateur plus ancien, le quitter d'abord par son icône, « Quitter ». Après l'installation, vérifier le numéro dans Réglages → Application. Live ne change pas, au même endroit.
2. **Premier lancement de Test**, Live ouvert. Pastille orange TEST et question « Copier mes réglages de Jarvis Live ? ». Accepter, puis vérifier que le modèle et la personnalisation y sont : ça vérifie le dossier `@jarvis\desktop`. Live ne doit pas avoir changé. **La question ne se pose qu'une fois** : si elle a déjà reçu une réponse sur ce PC, elle ne revient pas, et seuls la pastille, le modèle et la personnalisation se vérifient.
3. **Live garde ses fonctions.** Ctrl+Espace et « Jarvis » à la voix ne réveillent que Live. Test : Ctrl+Alt+Espace, **après avoir cliqué « Activer quand même » sur le raccourci dans les réglages de Test** (sans cela, Test n'a aucun raccourci : c'est voulu). Les enceintes, le téléphone et le mot de réveil de Test affichent « Réservé à Jarvis Live ».
4. **Notes** dans Test : activer les notes, dire « Note : acheter deux litres de lait », puis « Qu'est-ce qu'il y a sur ma liste ? » (reconnue depuis le 19 novembre ; avant, seule « Ma liste » l'était). La liste est relue tout de suite, sans modèle. Un fichier `notes.json` et son `.bak` apparaissent dans `%APPDATA%\Jarvis Test`.
5. **Journal du tour** dans Test : poser une question, puis vérifier que la conversation enregistrée porte `turnLog`, et qu'une note y est marquée `provider: aucun`. Dans Live : pas de `turnLog`.
6. **Correction d'équipe, dans Live** : « Ouvre le Bloc-notes », puis « non ». La pastille ne doit pas reprendre l'équipe du premier tour.
7. **Carnet** dans Test : dire « non, c'est faux » après une réponse. Le raté est noté (Réglages, « ratés de la semaine »).
8. Briefing, routines, imprimante : coupés par défaut. À essayer seulement si tu les actives.
9. **Mises à jour** : Live ne propose jamais `5.1.0-test.N`. Ce sera vérifiable après la première publication de Test par `release-test.sh`, seulement quand tu le décides.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (electron-vite build ; installateur Jarvis-Test-Setup-5.1.0-test.1.exe, test.yml, app-update.yml « channel: test », dossier jarvis-test-updater)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint, après l'exclusion de release-test ; 70 erreurs avant, toutes dans release-test/win-unpacked)
Tests     : OK (cœur 224 fichiers, 2564 tests ; bureau 168 fichiers, 842 tests, 8 ignorés par leur propre condition ; aucun __golden__ régénéré)
Secrets   : OK (aucune clé ni nom de réseau ajouté ; aucune phrase de l'utilisateur dans le dépôt)
Fichiers modifiés : session.ts et ipc.ts (fusions), turnJournal.ts, quotidien/fichiers.ts, safeFile.ts, index.ts, liveCopy.ts, liveDir.ts, packageTestConfig.mjs, eslint.config.js, version ; tests safeBooks, liveDir, turn-journal, editionCopy, packageTestConfig ; coordination ; ce rapport
Prêt à fusionner : NON (essais avec l'utilisateur d'abord, puis release-test.sh sur sa décision)
À corriger : point 2 de la revue du journal (chat sans orchestre) plus tard ; étiquette « développement » du script de la carte
Testé en vrai (à la voix, sur le PC) : PAS FAIT (essais ci-dessus, avec l'utilisateur)
```
