# Cahier des charges — Deux Jarvis sur le même PC : Live et Test

Rédigé par Claude pour Cursor, le 12 novembre 2026. À lire d'abord : `FEUILLE-DE-ROUTE.md` (sur `origin/claude/feuille-de-route-depot` tant qu'il n'est pas dans `main`), puis dans `CLAUDE.md` « Updater / GitHub », 5.0.63 (téléphone), 5.0.64 (enceinte), et le lot A (coffre des clés, `vault/`).

## Ce que veut l'utilisateur

- **Jarvis Live** : celui qu'il utilise tous les jours. Il ne reçoit que des corrections et des finitions, essayées avant d'être publiées.
- **Jarvis Test** : celui où l'on ajoute les nouveautés. Il l'ouvre de temps en temps pour voir si ça marche ou si ça casse.

Une nouveauté ne passe dans Live qu'après avoir fait ses preuves dans Test. Les deux sont installés **sur le même PC** et ne doivent jamais se gêner.

## Le résultat visé

- Deux applis dans le menu Démarrer : « Jarvis » et « Jarvis Test ». Chacune a son installateur, son dossier d'installation, son dossier de réglages (`userData`) et ses mises à jour.
- **Jarvis Test se voit au premier coup d'œil** : un bandeau ou une pastille orange « TEST » dans la fenêtre, une icône marquée, et « Jarvis Test » dans le titre et dans l'icône près de l'horloge.
- **Live garde ce qui ne se partage pas** :
  - le mot de réveil « Jarvis » ;
  - le pont des enceintes (port 53131) ;
  - le serveur du téléphone (53130) ;
  - le raccourci Ctrl+Espace.

  Dans Test, ces fonctions sont **coupées par défaut**, avec la phrase « Réservé à Jarvis Live ». Si l'utilisateur les active quand même, Test vérifie d'abord que le port ou le raccourci est libre. S'il est pris, il le dit clairement et ne prend rien de force.
- **Les modèles Ollama sont partagés** : rien n'est retéléchargé.
- **Premier lancement de Test** : il propose « Copier mes réglages de Jarvis Live ». Il copie les réglages, la personnalisation, le questionnaire, la mémoire (index et souvenirs) et les projets du mode Développeur. **Jamais** l'historique des discussions, le journal d'audit ni les données d'apprentissage. Ensuite, les deux vivent séparément. Un « Recopier depuis Live » reste disponible dans Réglages → Application, avec une confirmation en deux temps.
- **Les secrets** (coffre du lot A, jeton Google, jeton Spotify) : vérifie en partie 0 si le coffre de Live est lisible par Test. Avec `safeStorage`, ça dépend de la clé de chaque appli. S'il ne l'est pas, Test demande de reconnecter ce qui en a besoin, avec un guide court. On ne contourne pas le chiffrement.

## Partie 0 — Reconnaissance (rapport `rapports/2026-11-XX-deux-jarvis-choix.md`)

Vérifie à la source, avec la version et le lien :

1. **electron-builder** : deux configurations (`appId`, `productName`, nom de l'installateur, dossier NSIS, raccourcis, icône) à partir du même code, par exemple avec une variable `JARVIS_EDITION=live|test` au moment de la construction.
2. **Electron** : le bon moment pour `app.setPath('userData', …)` (avant tout `getPath`, avant `ready`) et `app.setAppUserModelId`. L'effet sur `requestSingleInstanceLock`, qui doit donner deux verrous séparés, et sur `safeStorage`.
3. **electron-updater**, canaux :
   - Live suit seulement les versions normales et ignore les préversions ;
   - Test suit son propre canal (fichier `test.yml` ou équivalent, publication GitHub en « pre-release »).

   La décision D1 (jamais de suffixe `-beta` sur Live) reste. Propose une numérotation simple pour Test (par exemple `5.1.N`, séparée de Live), et explique comment les deux ne se mélangent jamais.
4. **Spotify** : l'adresse de retour enregistrée chez Spotify est fixe (`127.0.0.1:53124/callback`). Test peut-il utiliser la même adresse quand Live ne s'en sert pas, ou lui faut-il la sienne (ajoutée par l'utilisateur dans son tableau Spotify, avec un guide) ? Même question pour Google (53125, avec un port libre en repli).
5. **Raccourci par défaut de Test** : Ctrl+Alt+Espace, ou un autre libre sous Windows.

## Partie 1 — L'édition

- `apps/desktop/src/main/edition.ts` (et `packages/core/src/edition.ts` pour ce qui est pur) : `edition()` rend `live` ou `test`. Elle est fixée à la construction et lisible au démarrage, avant tout.
- Une **seule** table pour ce qui change entre les deux : nom, dossier de réglages, raccourci par défaut, base des ports, fonctions réservées à Live, canal de mise à jour, couleur du badge. Ne disperse pas des `if (test)` dans tout le code.
- Live doit rester **exactement** comme aujourd'hui : même `appId`, même `userData`, mêmes ports, même raccourci, même canal. Ajoute un test qui le prouve, et garde les tests figés verts sans régénération.

## Partie 2 — Les ports et les fonctions réservées

- Le pont des enceintes, le serveur du téléphone, le mot de réveil et le raccourci global consultent la table de l'édition.
- Dans Test, ils sont coupés par défaut. Leurs réglages affichent « Réservé à Jarvis Live » et un bouton pour les activer quand même, qui vérifie d'abord que la place est libre.
- **Pas de port en dur dispersé** : une base par édition, et chaque service prend son décalage.

## Partie 3 — Premier lancement de Test et recopie

- Un écran simple au premier lancement de Test : « Copier mes réglages de Jarvis Live ? » (Oui / Partir de zéro).
- La copie lit le dossier de Live **en lecture seule**, copie la liste ci-dessus et note dans le journal ce qui a été copié.
- Un test vérifie que **Live n'est jamais modifié** par Test : aucune écriture dans le dossier de Live, jamais.

## Partie 4 — Construction et publication

- Des scripts `npm run package:win` (Live, inchangé) et `npm run package:win:test` (Test).
- Un brouillon de `release-test.sh` (à côté de `release.sh`, **que tu ne modifies pas**) : il construit Test et le publie en préversion GitHub sur son canal. C'est Claude Code qui le vérifiera et le lancera.
- Dans `CLAUDE.md` (ta section seulement), le chemin d'une nouveauté :
  1. branche ;
  2. relue par Claude ;
  3. fusion dans une branche `dev` ;
  4. Jarvis Test ;
  5. essayée par l'utilisateur ;
  6. fusion dans `main` ;
  7. Jarvis Live.

  Une correction de Live va dans `main`, puis est reportée dans `dev`.

## Tests

- La table de l'édition : Live égale aujourd'hui, champ par champ.
- `userData` de Test est différent de celui de Live, et Live est inchangé.
- Fonctions réservées coupées dans Test, et pont des enceintes jamais démarré en Test par défaut.
- Copie depuis Live : liste exacte, aucune écriture chez Live, historique jamais copié.
- Canal de mise à jour par édition.
- Construction : la configuration de Test a un autre `appId` et un autre `productName`.
- Inchangés : `chat-unchanged`, `ollama-unchanged`, `orchestra-session`, `machineProfile` et `profiles/jarvis`, sans régénération. `parseSettings({})` ne gagne aucune clé.

## Livraison

- Branche `cursor/deux-jarvis` depuis `origin/main`, inscrite dans `AGENTS-COORDINATION.md`.
- Claude Code prépare en ce moment la Live 5.0.77 (`claude/live-5077`) et touche à `speaker/repair.ts`, `serialAccess.ts`, `CLAUDE.md` et `package.json`. Touche `main/index.ts` le moins possible : la logique va dans `edition.ts` et dans de nouveaux fichiers. Le jour où la 5.0.77 est dans `main`, rebase ou fusion, sans `--force`.
- Un commit par partie, tests verts. Lance `typecheck`, `test` et `lint`.
- Rapport avec les choix de la partie 0, puis la liste des essais pour Claude Code :
  - installer Test à côté de Live ;
  - lancer les deux en même temps ;
  - vérifier que les enceintes et « Jarvis » restent à Live ;
  - vérifier la copie des réglages ;
  - vérifier une mise à jour de chaque côté.

  Puis le RAPPORT DE VÉRIFICATION.
- Pas de fusion, pas de publication.
