# Lot B — au quotidien

12 novembre 2026. Branche `cursor/lot-b-quotidien`. Version **5.0.76** (inchangée).

Base : `origin/cursor/carnet-des-rates`, une fois la correction du carnet poussée. `origin/main` est encore en 5.0.76 : la 5.0.77 (bourse) n'y est pas. Elle n'a pas été fusionnée, ni dans cette branche, ni dans `cursor/carnet-des-rates`.

Pas de fusion. Pas de publication. Non testé sur le PC.

## Où on le voit

Tout est coupé tant que l'utilisateur ne l'active pas. Rien ne change dans Live avant ça.

| Partie | Réglage | Phrases |
| --- | --- | --- |
| Briefing | Réglages → Moi → Briefing du matin | « Jarvis, mon briefing », « quoi de neuf ce matin ? », « bonjour » une fois dans la plage |
| Notes | Réglages → Moi → Notes et liste | « note : 3 paquets de liteaux pour lundi », « qu'est-ce que j'ai noté ? », « c'est bon pour les liteaux » |
| Routines | Réglages → Services → Routines | « crée une routine Travail : … », puis « C'est bon », puis « lance la routine Travail » |
| Imprimante | Réglages → Services → Imprimante 3D | « où en est l'impression », « annule l'impression », « imprime le fichier X.gcode » |

Le panneau Notes de l'accueil n'apparaît que si les notes sont activées.

## Ce qui a été fait

### B1. Briefing

Gabarits seulement, aucun modèle. Date, météo Open-Meteo (pluie mm/h, heures, rafales, mini / maxi, alerte si les seuils sont dépassés), agenda du jour si Google est branché, notes en attente. Une source absente est dite, jamais inventée. « Bonjour » l'après-midi, ou « bonjour ouvre le dossier », ne lance pas le briefing. Sur une enceinte, quatre phrases au plus. Le jour déjà offert est dans `userData/quotidien/briefing-jour.json`, pas dans les réglages.

### B2. Notes et liste

Outils `note_ajouter`, `notes_lister`, `note_cocher`, `note_effacer`. Fichier `userData/notes.json` (écriture temporaire puis `rename`). Quantité, unité et jour relevés quand ils sont dits. L'effacement demande une confirmation sur le PC ou le téléphone. Une enceinte ne l'efface pas. Ajout, lecture et coche marchent depuis le téléphone et l'enceinte.

### B3. Routines

Une routine est un nom et des étapes prises dans les outils déjà là : ouvrir une appli, playlist Spotify (l'appareil peut être dans la phrase, « sur … »), concentration, briefing. `run_command` est refusé, rien n'est enregistré. La création montre une carte de résumé. « C'est bon » enregistre aussi un brouillon en attente. Au lancement, chaque étape passe par le Tool Manager avec ses confirmations. Une étape ratée est dite. La suivante continue, sauf si la phrase disait « puis ». L'équipe Tâches n'entre au catalogue que si au moins une routine existe.

### B4. Imprimante

Client dans `packages/core/src/quotidien/moonraker.ts`, sans Electron. Faux serveur : `fakeMoonraker.testkit.ts`. Adresse contrôlée par `checkRoverBaseUrl` : une adresse Internet est refusée et aucun appel ne part. La clé API, si l'utilisateur en met une, est un champ secret (`apiKey`) : le coffre la retire du fichier de réglages.

Points d'accès, documentation Moonraker :

- état : <https://moonraker.readthedocs.io/en/latest/web_api/#query-printer-object-status> (`GET /printer/objects/query?print_stats&heater_bed&extruder&virtual_sdcard`)
- fichiers : <https://moonraker.readthedocs.io/en/latest/web_api/#list-files> (`GET /server/files/list?root=gcodes`)
- envoi : <https://moonraker.readthedocs.io/en/latest/web_api/#upload-file> (`POST /server/files/upload`, `print=true`)
- lancer, pause, reprendre, annuler : <https://moonraker.readthedocs.io/en/latest/web_api/#printer-administration> (`POST /printer/print/start|pause|resume|cancel`)

Lancer et envoyer demandent une confirmation forcée, avec le nom du fichier et « Vérifie que le plateau est vide ». Le résultat est relu avant de dire « lancée », « en pause » ou « annulée ». Annuler ne demande pas de clic. Une enceinte peut demander l'état et annuler. Elle ne lance pas. Tant que Jarvis est ouvert et que l'imprimante est activée, un suivi toutes les 60 s dit une seule fois « L'impression de X est terminée (2 h 14) » dans la discussion. La phrase est dite à voix haute si l'écoute est déjà en train de lire les réponses.

## Essais pour Claude Code dans Jarvis Test

Activer d'abord le réglage, sinon la phrase part au modèle comme avant.

1. Briefing. Réglages → Moi → cocher Briefing du matin. Dire « Jarvis, mon briefing ». Jarvis donne la date, dit si la météo ou l'agenda manque, et ne parle pas d'une ville. L'après-midi, « bonjour » reste une salutation.
2. Notes. Cocher Notes et liste. Dire « note : 3 paquets de liteaux pour lundi », puis « qu'est-ce que j'ai noté ? », puis « c'est bon pour les liteaux ». Le panneau Notes de l'accueil montre la ligne, puis plus rien. Depuis une enceinte, « efface la note des liteaux » répond que l'effacement se fait sur le PC ou le téléphone, et la note reste.
3. Routines. Cocher Routines. Dire « crée une routine Travail : ouvre Chrome, mets ma playlist Focus, bloque les réseaux sociaux 2 heures ». La carte s'affiche. Refuser : rien n'est enregistré. Recommencer, dire « C'est bon », puis « Jarvis, lance la routine Travail ». Chaque étape demande sa confirmation habituelle. Une étape « run_command » est refusée.
4. Imprimante. Mettre une adresse locale (par exemple `http://imprimante.local:7125`), cocher Imprimante 3D, bouton Tester. « Où en est l'impression » lit l'état. « Annule l'impression » part sans carte. « Imprime le fichier synthetique-test.gcode » montre le nom et le rappel du plateau. Depuis une enceinte, la même phrase de lancement est refusée.

Les exemples du dépôt sont marqués synthetique-test. Aucune ville réelle, aucun chemin personnel, aucun secret.

## Ce qui n'a pas changé

`release.sh` n'a pas été modifié. Le prompt de chat et le catalogue sans ces réglages non plus. `__golden__` n'a pas été régénéré. `parseSettings({})` n'a pas de clé `briefing`, `notes`, `routines` ni `printer`.

L'échec déjà connu « Construire manuel : la carte reste obligatoire » (`windowsDesktopMissionPath.test.ts`) est toujours là. Il n'a pas été affaibli. La revue du carnet dit qu'il est corrigé dans `claude/live-5077`.

## RAPPORT DE VÉRIFICATION

- **Lancement** : `npm run build --workspace @jarvis/core` passe. Le paquet desktop est typechecké (`tsc` node et web). L'emballage Windows n'a pas été lancé.
- **Types** : `npm run build --workspace @jarvis/core`, puis `tsc` desktop node et web, sans erreur.
- **Style** : `npm run lint` passe, sans avertissement.
- **Tests** : `npm test`. Cœur vert. Bureau : 800 tests passés, 6 ignorés, 1 échec connu (« Construire manuel »). `chat-unchanged`, `ollama-unchanged`, `orchestra-session` et `profiles/jarvis` n'ont pas été régénérés.
- **Secrets** : la clé Moonraker est un champ `apiKey`, masqué par le coffre. Les tests utilisent `synthetique-test-cle`. Aucun secret dans le dépôt.
- **Fichiers** : pas de chemin personnel, pas de ville réelle.
- **Prêt à fusionner** : NON. La branche n'est pas dans `main`. L'échec « Construire manuel » reste, et le lot n'a pas été essayé sur le PC.
- **Testé en vrai** : PAS FAIT. Non testé sur le PC.

Branches : `cursor/carnet-des-rates` (correction du carnet, déjà poussée), `cursor/lot-b-quotidien` (ce lot). Version 5.0.76. Non testé sur le PC.

## Correction de la revue

Quand l'imprimante est éteinte ou ne répond pas, la règle express dit « L'imprimante ne répond pas. » et le tour ne va pas au modèle. Si c'est « annule l'impression » qui échoue, elle ajoute « Coupe-la à la main si besoin. »

## RAPPORT DE VÉRIFICATION

- **Lancement** : pas de nouvel écran. Le typecheck desktop (node et web) couvre `printerReply`.
- **Types** : `npm run typecheck` passe.
- **Style** : `npm run lint` passe.
- **Tests** : `npm test`. Cœur vert. Bureau : 801 tests passés, 6 ignorés, 1 échec connu (« Construire manuel », non modifié). Le faux Moonraker arrêté : la phrase est dite, aucun modèle n'est appelé.
- **Secrets** : aucun. Pas de chemin personnel, pas de ville réelle.
- **Fichiers** : `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/quotidien/printerReply.ts`, le faux serveur, le rapport.
- **Prêt à fusionner** : NON.
- **Testé en vrai** : PAS FAIT. Non testé sur le PC.

Version 5.0.76. Branche `cursor/lot-b-quotidien`. Non testé sur le PC.
