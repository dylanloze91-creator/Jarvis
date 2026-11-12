# Deux Jarvis — livraison Cursor

12 novembre 2026. Branche `cursor/deux-jarvis`. Version toujours **5.0.76**. Pas de fusion, pas de publication.

Les choix détaillés (avec versions et liens) sont dans `rapports/2026-11-12-deux-jarvis-choix.md`.

## Ce que Live garde

Même application, même `appId` (`com.thedexios.jarvis`), même dossier de réglages (aucun `setPath`), mêmes ports (53124, 53125, 53130, 53131), même raccourci Ctrl+Espace avec le même repli, même canal de mise à jour (`latest.yml`, pas de préversion). `npm run package:win` n’a pas changé. `release.sh` n’a pas changé.

## Ce que Test change

- Autre application : `com.thedexios.jarvis.test`, nom « Jarvis Test », dossier `Jarvis Test`, pastille orange TEST.
- Enceintes sur le port 53231, téléphone sur 53230. Jamais 53130 ni 53131.
- Spotify et Google gardent 53124 et 53125 (adresses déjà enregistrées).
- Mot de réveil, enceintes, téléphone et raccourci sont coupés, avec « Réservé à Jarvis Live » et un bouton qui vérifie d’abord que la place est libre.
- Raccourci Ctrl+Alt+Espace, sans repli vers Ctrl+Espace.
- Premier lancement : « Copier mes réglages de Jarvis Live ? ». Lecture seule. Pas d’historique, pas de journal d’audit, pas d’apprentissage. Pas les connexions Spotify ni Google : on les reconnecte dans Test. Seul le coffre des clés peut suivre, s’il se déchiffre.
- Mises à jour : canal `test`, versions prévues `5.1.N-test.M`, fichier `test.yml`, préversion. Le brouillon `release-test.sh` refuse toute autre version.
- Commande : `npm run package:win:test --workspace @jarvis/desktop` (les scripts à la racine sont figés par `profiles/jarvis.test.ts`, donc le script n’y a pas été ajouté).

## Essais pour Claude Code

1. Installer Jarvis Test à côté de Jarvis Live (deux entrées dans le menu Démarrer).
2. Lancer les deux en même temps : deux fenêtres, Test a la pastille TEST.
3. Vérifier que les enceintes et le mot « Jarvis » restent à Live. Test affiche « Réservé à Jarvis Live ».
4. Au premier lancement de Test, accepter la copie des réglages, puis contrôler que Live n’a pas changé. Recopier depuis Réglages → Application, confirmation en deux temps.
5. Vérifier une mise à jour de chaque côté : Live ne propose pas une préversion `5.1.N-test.M` ; Test ne propose pas une version Live.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : ÉCHEC (npm run build s'arrête sur l'empreinte Piper Siwis, téléchargement Hugging Face, sans rapport avec cette branche ; electron-vite build du code, lui, réussit)
Types     : OK
Style     : OK
Tests     : ÉCHEC (bureau : 784 réussis, 1 échec, 6 ignorés ; cœur : vert)
Secrets   : OK (0 vraie valeur ; noms et valeurs factices seulement)
Fichiers modifiés : édition, recopie, ports, réglages réservés, construction Test, CLAUDE.md, rapports
Prêt à fusionner : NON
À corriger : l'échec « Construire manuel » (windowsDesktopMissionPath.test.ts, « typecheck n’a pas été lancé »), déjà connu depuis la 5.0.73 et exclu de release.sh ; l'empreinte du modèle Piper Siwis au téléchargement
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```

Pas testé sur le PC Windows. À faire : les cinq essais ci-dessus.

Le cœur (`@jarvis/core`) est vert, y compris `chat` figé via les suites déjà en place, `ollama-unchanged`, `profiles/jarvis`. `parseSettings({})` n’a pas gagné de clé. Aucune dépendance native. Les cinq échecs « dotnet introuvable » ne se sont pas produits : ces tests simulent le SDK. Le seul échec est le test fragile déjà exclu de la publication.

## Correction après la revue

Revue `docs/revues/2026-11-12-deux-jarvis.md` (branche `claude/revues`). Point bloquant : fait.

`spotify-token.json` et `google-token.bin` ne sont plus recopiés de Live vers Test, même quand ils sont lisibles. Seul `coffre.bin` peut l’être, et seulement s’il se déchiffre. Le test `ne recopie jamais les jetons Spotify ni Google, même s’ils sont lisibles` le prouve : les deux fichiers restent chez Live, absents de Test, et leur contenu n’entre pas dans le journal.

Dans Test, Spotify et Google se reconnectent normalement, avec le même identifiant client. Phrase : « Spotify et Google ne sont pas recopiés. Reconnecte-les dans Jarvis Test, avec le même identifiant client : chacun a sa propre autorisation. » Si le coffre est illisible : « Les clés API de Jarvis Live n’ont pas pu être lues : entre-les à nouveau dans Réglages. »

Liste revue :

- copié : réglages, personnalisation, questionnaire, mémoire, projets Développeur, et `coffre.bin` seulement s’il se déchiffre ;
- jamais : historique, journal d’audit, apprentissage, `spotify-token.json`, `google-token.bin`.

Le reste n’a pas bougé (table d’édition, Live sans `setPath`, ports, raccourci, `release-test.sh`). Pas de fusion, pas de publication. La fusion avec la 5.0.77 et les essais sur le PC reviennent à Claude Code.

```
RAPPORT DE VÉRIFICATION
Lancement : non relancé (la commande demandée était typecheck, test, lint ; l’échec Piper Siwis de la passe précédente n’est pas retouché)
Types     : OK
Style     : OK
Tests     : ÉCHEC (bureau : 784 réussis, 1 échec, 6 ignorés ; cœur : vert ; le test des jetons est vert)
Secrets   : OK (0 vraie valeur)
Fichiers modifiés : recopie (coffre seulement), phrases, rapports
Prêt à fusionner : NON
À corriger : l’échec déjà connu « Construire manuel » (windowsDesktopMissionPath.test.ts), exclu de release.sh depuis la 5.0.73, corrigé dans claude/live-5077 ; l’empreinte Piper au téléchargement
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```
