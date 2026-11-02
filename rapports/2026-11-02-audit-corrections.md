# Corrections de l'audit UX 5064 (revue du 2 novembre)

Date : 2026-11-02. Branche : `cursor/audit-corrections`, créée à partir de `origin/claude/audit-ux-5064` (`97f3180`), pas de `main`. Rien n'est fusionné dans `main`, rien n'est publié, le numéro de version n'est pas monté.

Demande : corriger les points 1, 2, 3, 6 et 7 de la revue `docs/revues/2026-11-02-audit-ux-5064.md` (branche `claude/enceinte-spec`), chacun avec un test, sans toucher aux points 4 et 5. Règles tenues : aucun fichier `__golden__` touché ni régénéré, prompt et catalogue du chat inchangés (`chat-unchanged.test.ts`, `ollama-unchanged.test.ts`, `engine/profiles/jarvis.test.ts` verts sans régénération), aucune dépendance ajoutée, aucun fichier des autres agents en cours (`main/speaker/`, `core/speaker/`, `firmware/`, `training/`, `labTrainPrep.ts`, `labCompare.ts`, `robot/voix/`) modifié.

Commits (un par étape, poussés après chaque étape) :

- `ec1ea0c` Coordination : ligne `cursor/audit-corrections` en cours.
- `a28866f` Point 1 (réglages).
- `4598be2` Points 2 et 3 (météo, Ollama).
- `c51cf7b` Points 6 et 7 (mémoire, écoute).
- Ce commit : rapport, ligne CLAUDE.md, coordination à `terminé`.

## Point 1 — « Enregistrer » pouvait défaire un réglage fait ailleurs

**Ce qui était faux.** `SettingsPanel.tsx` gardait le brouillon non enregistré pour la session (`keptDraft`) mais « Enregistrer » le comparait aux réglages **courants** (`settingsPatch(settings, wanted)`). Scénario : on change le raccourci dans Réglages, on quitte le panneau sans enregistrer, puis le mode Développeur est activé (enregistré tout de suite), ou une politique de confirmation change, ou l'apprentissage local écrit `localLearning.activeOllamaModel`. Au retour, « Enregistrer » voyait `developer`, `toolPolicies` ou `localLearning` différents entre le vieux brouillon et les réglages courants, et renvoyait l'**ancienne** valeur sans rien dire.

**Ce qui change.**

- `apps/desktop/src/renderer/src/lib/settingsPatch.ts` : nouveau type `SettingsDraft { base, draft }` (le brouillon et l'instantané des réglages dont il est parti) et `absorbSavedSettings(state, saved)` : quand les réglages enregistrés changent pendant que le brouillon est ouvert, chaque clé **non touchée** par l'utilisateur prend la nouvelle valeur, les clés touchées gardent la sienne, et la base devient les réglages enregistrés. `settingsPatch(base, draft)` ne contient donc que les clés changées par l'utilisateur.
- `apps/desktop/src/renderer/src/components/SettingsPanel.tsx` : `baseRef` = instantané pris à la création du brouillon ; `keptDraft` garde maintenant `{ base, draft }` ; l'effet sur `settings` passe par `absorbSavedSettings` (il remplace l'ancien cas particulier `developer` + `microphoneId`, qui est couvert) ; `save()` appelle `settingsPatch(baseRef.current, wanted)`.

**Test ajouté.** `apps/desktop/src/renderer/src/lib/settingsPatch.test.ts`, bloc « brouillon gardé puis réglage changé ailleurs » : le scénario exact de la revue (raccourci changé dans le brouillon ; Développeur activé, politique « fichiers » assouplie et modèle d'apprentissage écrits ailleurs ; « Enregistrer » n'envoie que `hotkey`, et les trois réglages faits ailleurs survivent), la démonstration que l'ancien calcul renvoyait `developer`, et une clé modifiée des deux côtés qui garde la valeur de l'utilisateur. Le panneau React lui-même n'a pas de test d'interaction (pas de jsdom dans le dépôt, et la règle interdit d'ajouter un outil) : la logique a été sortie dans le module pur pour être testée.

## Point 2 — fausses villes pour la météo

**Ce qui était faux.** `extractCity` (`packages/core/src/agent/currentInfo.ts`) mettait une majuscule au premier mot en minuscules qui suivait n'importe quelle préposition (`à`, `a`, `sur`, `pour`, `de`, `dans`, `vers`) : « pour sortir demain » → « Sortir », « dans une heure » → « Une », « besoin de savoir la météo » → « Savoir », « météo pour mon jardin » → « Mon ». Ces mots partaient ensuite en géolocalisation (`agent.ts`, `currentSearch.ts`).

**Ce qui change** (`packages/core/src/agent/currentInfo.ts`) :

- Un mot en minuscules n'est pris pour une ville qu'après **« à » ou « sur »** (`LOWERCASE_CITY_AFTER_LOCATIVE`). Pas après « a » sans accent (c'est le verbe : « il a fait », « il y a du vent »), ni après « pour », « de », « dans », « vers ».
- Liste de mots exclus `LOWERCASE_CITY_EXCLUDED` : déterminants, possessifs, pronoms, temps (« midi », « demain », « partir », « peu »…), lieux communs (« maison », « place », « balcon », « extérieur »…), verbes et adverbes fréquents (« sortir », « savoir », « aller », « courir »…). « à l'extérieur » : l'élision est retirée avant le contrôle.
- Une ville écrite **avec sa majuscule** est acceptée après toutes les prépositions, comme avant (« pour Noël à Paris » → Paris ; « à mon avis à Paris » → Paris).

**Tests ajoutés.** `packages/core/src/agent/currentInfo.test.ts`, bloc « revue 5.0.64, point 2 » : les quatre phrases de la revue plus douze autres (« à quelle heure », « à midi », « à la maison », « sur place », « sur mon balcon », « à l'extérieur », « à partir de demain », « à peu près », « il a fait », « il y a du vent », « pour aller courir », « vers midi ») → aucune ville ; « à lyon », « sur marseille », « à saint-étienne » → reconnues ; « pour lyon », « de lyon » en minuscules → rien ; majuscules intactes ; et `detectCurrentInfoIntent('Quel temps fera-t-il pour sortir demain ?')` → météo sans ville, `newsQuery` « météo ».

## Point 3 — texte perdu dans `ollama.ts` (mode « appels relus »)

**Ce qui était faux.** Avec `recoverToolCalls` et **sans outil proposé** (`plainTextOnly`), dès que `<tool_call` apparaissait dans le texte, tout ce qui suivait était retenu (`recoverHold`), puis le chemin `plainTextOnly` finissait le flux sans jamais le réémettre : « Voici comment écrire une balise <tool_call>… Fin. » arrivait coupé. En plus, la détection se faisait sur `fullText.includes('<tool_call')` après coup : une balise coupée entre deux morceaux (« <tool_ » puis « call> ») laissait passer « <tool_ » à l'écran, et la réémission finale repartait de la balise, donc en double.

**Ce qui change** (`packages/core/src/providers/ollama.ts`, seulement en mode `recover` ; le chat sans option garde le chemin d'avant au caractère près) :

- Compteur `emitted` (caractères de `fullText` déjà rendus) et `releaseRecoverable()` : rend le texte jusqu'à un éventuel `<tool_call`, puis retient ; un bout de fin qui **pourrait** commencer la balise (`partialTagLength` : « < », « <t », … « <tool_cal ») attend le morceau suivant. Le texte libéré par la fenêtre de reniflage (`emitSniffed`) passe par le même chemin.
- Fin de flux : en `plainTextOnly`, le texte retenu est rendu (`fullText.slice(emitted)`) avant `done` ; avec des outils mais sans appel relu, le texte retenu est rendu aussi (après le contrôle « texte brut » qui, lui, ne change pas).

**Tests ajoutés.** `packages/core/src/providers/ollama-recover.test.ts`, bloc « revue 5.0.64, point 3 » (le faux Ollama découpe en morceaux de 7 caractères, donc `<tool_call` est toujours coupé en deux) : texte entier rendu sans outil ; balise coupée ni affichée en partie ni rendue deux fois avec l'appel relu ; « a < b », « <tool> » rendus tels quels ; appel illisible après un `<tool_call` → le texte d'avant reste rendu et l'erreur dit « texte brut ». Les 3 tests de `ollama-unchanged.test.ts` restent verts sans régénération.

## Point 6 — `isBlockedFolder` : chemins WSL et UNC

**Ce qui était faux.** L'audit (point 16) avait remplacé le contrôle « un segment interdit n'importe où » par « le premier segment seulement », pour accepter `C:\dev\Jarvis` et `bin/`. Conséquence : `/mnt/c/Windows` (WSL), `\\wsl$\Ubuntu\etc`, `\\serveur\partage\Windows` (UNC) et `\\?\C:\Windows` (chemin long) n'étaient plus bloqués.

**Ce qui change** (`apps/desktop/src/main/knowledge.ts`) : contrôle **par segment** pour les noms Windows (`Windows`, `Program Files`, `Program Files (x86)`, `ProgramData`, `System32`, `SysWOW64`, `$Recycle.Bin`, `System Volume Information`), où qu'ils soient dans le chemin ; noms POSIX (`etc`, `usr`, `bin`, `dev`, `root`…) à la **racine d'un système de fichiers** : `/`, et la racine d'une distribution WSL (`\\wsl$\<distro>\`, `\\wsl.localhost\<distro>\`), car `dev`, `bin`, `lib` sont des noms courants de dossiers d'utilisateur (`C:\dev\Jarvis` reste accepté, comme voulu par l'audit). Préfixes `\\?\` et `\\?\UNC\` retirés avant le contrôle ; `/mnt/c` seul, `\\wsl$\Ubuntu` seul, `\\serveur\c$` seul (partage administratif = tout un disque) et `\\serveur` seul sont refusés comme `C:\`.

**Tests ajoutés.** `apps/desktop/src/main/knowledge.test.ts`, deux cas « revue 5.0.64, point 6 » : 18 chemins bloqués (`/mnt/c/Windows`, `/mnt/c/Windows/System32/drivers`, `\\wsl$\Ubuntu\etc`, `\\wsl.localhost\Ubuntu\root`, `\\serveur\partage\Windows`, `\\serveur\c$`, `\\?\C:\Windows`, `\\?\UNC\serveur\partage\Program Files`, `//wsl$/Ubuntu/etc`…) et 8 chemins d'utilisateur acceptés (`/mnt/c/dev/Jarvis`, `\\wsl$\Ubuntu\home\dylan\dev`, `\\serveur\c$\dev\Jarvis`, `\\?\C:\dev\Jarvis`, `C:\dev\Jarvis\docs`…). Le test de l'audit (`C:\dev\Jarvis\docs`, `bin`, `ProgramData`, `/usr/share`) reste vert.

## Point 7 — `addressee.ts` : « au » et le possessif

**Ce qui était faux.** « au » était à la fois dans `INTERJECTIONS` (pour « Au fait Jarvis ») et dans `MENTION_MARKERS` (« je pense au Jarvis de Paul »). Et la règle de l'audit « virgule après le mot = on lui parle » faisait partir « Mon assistant Jarvis, il est génial » comme une commande (« il est génial » envoyé au modèle).

**Ce qui change** (`packages/core/src/speech/addressee.ts`) :

- « au » et « fait » retirés des interjections ; « au fait » devient un mot d'appel **composé** (`COMPOUND_INTERJECTIONS`, lu par `afterInterjections`). « au » seul reste un marqueur de mention.
- `POSSESSIVES` (mon, ma, mes, ton, ta, tes, son, sa, ses, notre, nos, votre, vos, leur, leurs) : tous ajoutés aux marqueurs de mention (avant : « mon », « ton », « son », « notre », « votre », « leur » seulement), et nouvelle règle `clauseStartsWithPossessive` : si la proposition qui porte le mot de réveil (depuis la dernière ponctuation, petits mots d'appel sautés) **commence par un possessif**, c'est une mention, avant la règle de la virgule. « Ouvre mon dossier Jarvis » (le possessif n'ouvre pas la proposition) lui parle toujours.

**Tests ajoutés.** `packages/core/src/speech/addressee.test.ts`, bloc « revue 5.0.64, point 7 » : 8 mentions (« Mon assistant Jarvis, il est génial », « Ma copine adore Jarvis, elle… », « Notre Jarvis, il bugue », « Bon, mon assistant Jarvis, il a planté », « Je pense au Jarvis de mon frère, il… », « fier de son Jarvis, c'est… »), 6 adresses conservées (« Au fait Jarvis, … », « Au fait, Jarvis, … », « Ouvre mon dossier Jarvis », « Montre-moi mon agenda, Jarvis », « Bon, Jarvis, … », « Et toi Jarvis, … »), et « au » seul = mention. Les 9 cas de l'audit (`audit-5064.test.ts`) et les 17 de `conversationSession.test.ts` restent verts.

## Points 4 et 5 — laissés à Claude Code, volontairement

Non touchés, comme demandé : ils ne se vérifient que sur Windows.

- **4.** `apps/desktop/src/main/tools/platform/exec.ts` (`run`) : `taskkill /T` lancé après `SIGTERM` ne trouve plus le parent ; lancer `taskkill /T /F` d'abord, retomber sur `SIGKILL` si `taskkill` échoue.
- **5.** `apps/desktop/src/main/tools/applications.ts` (`closeWindows`) : `WaitForExit(3000)` par processus dépasse 15 s pour Discord, Teams, Spotify, VS Code ; délai global partagé ; `HasExited` peut lever une erreur d'accès (processus administrateur) : l'attraper.

## Contrôles (sur `c51cf7b`, machine Linux sans SDK .NET, Node 22.23.4)

- `npm run build` : vert, code 0, aucun `error` dans la sortie (`setup:voice`, icônes, `electron-vite build`).
- `npm run typecheck` : vert, 0 erreur.
- `npm run lint` : vert, 0 erreur, 0 avertissement.
- `npm test` : cœur 157 fichiers, **2 084 passés / 2 084**. Bureau : **561 passés, 6 ignorés, 5 échecs / 572**, les 5 échecs étant les tests `dotnet` attendus (`spawnSync dotnet ENOENT`) :
  - `apps/desktop/src/main/developer/project/dotnetProject.test.ts` : « Nouveau projet » WinForms ;
  - `apps/desktop/src/main/developer/project/windowsDesktopMissionPath.test.ts` : appli .exe ; chronomètre Core ; « fais-moi une appli Windows » ; « un programme sur le bureau ».
  - Aucun autre échec. `developer/runner.test.ts` (rouge sur la machine de l'audit) passe ici (9 tests).
- Total : **2 645 réussis / 2 656** (2 084 + 561 ; 5 échecs .NET attendus, 6 ignorés).
- `chat-unchanged.test.ts` (6), `ollama-unchanged.test.ts` (3), `engine/profiles/jarvis.test.ts` (9) : verts, aucun fichier `__golden__` régénéré (`git status` : rien sous `__golden__/`).
- Secrets : les deux recherches de la routine ne trouvent que des noms de variables, des libellés et les valeurs factices des tests (`sk-live-…`, `GOCSPX-googlesecret…`, `vosk-model-small-fr-0.22` pris pour `sk-…`) ; rien dans le diff de cette branche ; aucun `.env` ni `*-token.json` dans `git status`.
- Lab / `lab:generate` : non lancés.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : OK (2645/2656 réussis, 5 échecs .NET attendus, 6 ignorés)
Secrets   : OK (0 trouvé)
Fichiers modifiés : AGENTS-COORDINATION.md, CLAUDE.md, rapports/2026-11-02-audit-corrections.md,
  apps/desktop/src/renderer/src/lib/settingsPatch.ts (+ test), apps/desktop/src/renderer/src/components/SettingsPanel.tsx,
  packages/core/src/agent/currentInfo.ts (+ test), packages/core/src/providers/ollama.ts (+ ollama-recover.test.ts),
  apps/desktop/src/main/knowledge.ts (+ test), packages/core/src/speech/addressee.ts (+ test)
Prêt à fusionner : OUI (pour les points 1, 2, 3, 6, 7 ; les points 4 et 5 de la revue restent à faire par Claude Code sur Windows avant de fusionner l'audit)
À corriger : points 4 et 5 de la revue (Windows, Claude Code) ; « Reste à faire » du rapport de l'audit inchangé
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```

À tester toi-même sur le PC Windows, avec le chat et la voix :

1. **Réglages.** Ouvre Réglages, change le raccourci (par exemple `Alt+J`), ferme le panneau avec Échap sans enregistrer. Active le mode Développeur (Réglages → Développeur, enregistré tout de suite), ou change une politique de confirmation. Rouvre Réglages : « Modifications non enregistrées » est affiché ; clique « Enregistrer ». Attendu : le raccourci est `Alt+J` **et** le Développeur reste activé (avant : il repassait à coupé sans prévenir).
2. **Météo.** Dis « Jarvis, quel temps fera-t-il pour sortir demain ? » puis « Jarvis, quelle est la météo pour mon jardin ? ». Attendu : une météo générale (ou une question sur ta ville), jamais une météo pour une ville appelée « Sortir » ou « Mon ». Puis « Jarvis, météo à lyon » : attendu, la météo de Lyon.
3. **Écoute.** En parlant à quelqu'un dans la pièce : « Mon assistant Jarvis, il est génial ». Attendu : rien n'est envoyé, Jarvis reste en veille. Puis « Au fait Jarvis, quelle heure est-il ? ». Attendu : il répond l'heure.
4. **Mémoire.** Dans le chat : « indexe le dossier \\wsl$\Ubuntu\etc » (ou `/mnt/c/Windows` si tu as WSL). Attendu : « Ce dossier système ne peut pas être indexé. » Puis « indexe le dossier C:\dev\Jarvis\docs » : attendu, la carte de confirmation habituelle.
5. **Mode « appels relus »** (Jarvis Développeur ou chef d'orchestre activé) : demande au modèle « explique-moi comment écrire une balise tool_call, avec un exemple ». Attendu : la réponse arrive entière, jusqu'à la fin, et aucune balise `<tool_` n'apparaît à moitié.
