# Carnet des ratés

12 novembre 2026. Branche `cursor/carnet-des-rates`. Version toujours **5.0.76**. `release.sh` n’a pas changé. Pas de fusion dans `main`, pas de publication.

Base : `origin/cursor/deux-jarvis` (`bc1014bd`, « Les jetons Spotify et Google ne sont plus recopiés de Live »). Cette branche n’est pas dans `main` (`932d048`).

## Ce que le carnet note

Seulement par des règles, jamais par un modèle :

| Type | Quand |
| --- | --- |
| correction | Juste après une réponse, si la phrase n’est pas une demande ponctuelle (« non, c’est faux », « pas ça », « corrige », « je t’ai dit »). « Non, mais… » n’est pas un raté. |
| repetition | La même demande, ou presque (70 % des mots), dans les 3 minutes. « Encore une blague » n’est pas un raté. |
| interruption | « Stop », « tais-toi », le bouton Arrêter, ou une parole pendant la voix, dans les 5 secondes après le début de la réponse. « Stop » dit à Spotify n’est pas un raté. |
| outil_echec | Un outil en erreur, un délai dépassé, `verification_failed`, ou un refus que l’utilisateur n’a pas choisi. Un refus sur la carte ne compte pas. |
| lenteur | Fenêtre ou téléphone : plus de 10 s avant le premier mot. Enceinte : plus de 6 s avant le premier son. Un téléchargement demandé ne compte pas. |
| chemin | Le cerveau a répondu quelque chose d’illisible et Jarvis est revenu au chemin d’avant, ou l’équipe choisie n’avait pas l’outil qu’il fallait. |
| signale | « Ça n’a pas marché », « c’était nul », « tu t’es trompé », ou 👎 sous une réponse. |

« Ça n’a pas marché » (et les deux autres phrases) est une règle express : Jarvis répond « C'est noté. » sans appeler de modèle, et note le tour d’avant. Ça marche depuis la fenêtre, l’enceinte et le téléphone.

Le carnet ne change pas les autres réponses, ni ce qui est envoyé au modèle. Actif dans Jarvis Test, coupé dans Jarvis Live, jusqu’à l’interrupteur.

## Où on le voit

- Tableau de bord : carte « Les ratés de la semaine ». Dix groupes au plus, puis « Tout voir ». On peut choisir une catégorie, écrire ce qu’on attendait, ou « Ce n’était pas un raté ».
- Réglages → Application → « Carnet des ratés » : l’interrupteur et les deux seuils de lenteur.
- Le dimanche, au premier lancement : une phrase dans la discussion. Elle n’est pas lue à voix haute.
- « Préparer pour Claude » écrit `carnet-semaine.md` dans les documents et l’ouvre. Rien n’est envoyé tout seul.
- Sur le PC : `userData/carnet/rates.jsonl` (5 000 lignes au plus, secrets masqués). Format version 1 : `packages/core/src/carnet/FORMAT.md`. Jamais dans le dépôt.

## Essais pour Claude Code dans Jarvis Test

1. Poser une question, puis dire « Non, c’est faux ». La carte doit montrer une correction. « Non, mais cherche la météo » ne doit rien noter.
2. Redemander exactement la même chose dans les 3 minutes : une répétition. Dire « encore une blague » après « raconte une blague » : rien.
3. Pendant que Jarvis parle, dire « stop » dans les 5 premières secondes : une interruption. Dire « stop Spotify » : rien.
4. Lancer « télécharge le modèle » et laisser traîner : pas de lenteur. Une question simple qui met plus de 10 s avant le premier mot : une lenteur.
5. À l’enceinte : « Jarvis, ça n’a pas marché ». Jarvis doit dire « C'est noté. » tout de suite, et la carte montre le tour d’avant. Pareil depuis le téléphone.
6. Cliquer 👎 sous une réponse : un signal.
7. Sur un groupe : choisir « Un bogue », ou « Ce n’était pas un raté » (la ligne part, la règle compte comme fausse alerte).
8. Un dimanche, ouvrir Jarvis Test : la phrase est dans la discussion, l’enceinte ne la dit pas.
9. « Préparer pour Claude » : `carnet-semaine.md` s’ouvre dans les documents. Aucun envoi.
10. Ouvrir Jarvis Live : le carnet est coupé. L’interrupteur dans Réglages → Application l’allume.

## RAPPORT DE VÉRIFICATION

Lancement : OK
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : ÉCHEC (cœur 2434/2434 ; bureau 791/798 réussis, 6 ignorés, 1 échec)
Secrets   : OK (0 vraie valeur ; les `sk-` des tests sont des leurres, masqués dans le fichier)
Fichiers modifiés : `packages/core/src/carnet/`, `apps/desktop/src/main/carnet/`, `apps/desktop/src/main/session.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/phone/server.ts`, `apps/desktop/src/main/speaker/server.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/src/carnet/CarnetWeekCard.tsx`, `apps/desktop/src/renderer/src/dashboard/Dashboard.tsx`, `apps/desktop/src/renderer/src/components/SettingsPanel.tsx`, `apps/desktop/src/renderer/src/components/Messages.tsx`, `apps/desktop/src/renderer/src/components/UnifiedJarvisChat.tsx`, `apps/desktop/src/renderer/src/preview/bridge.ts`, `apps/desktop/src/main/phone/server.test.ts`, `apps/desktop/src/main/speaker/server.test.ts`, `.gitignore`, `CLAUDE.md`, `AGENTS-COORDINATION.md`, ce rapport
Prêt à fusionner : NON
À corriger : `windowsDesktopMissionPath.test.ts`, test « Construire manuel : la carte reste obligatoire » (« typecheck n’a pas été lancé »). Le code du développeur est le même que sur `origin/cursor/deux-jarvis`. Ce n’est pas un des 5 échecs .NET prévus. Les `__golden__`, `release.sh`, `parseSettings` et la version n’ont pas changé.
Testé en vrai (à la voix, sur le PC) : PAS FAIT

À dire à Jarvis Test, micro ouvert :

1. « Quelle heure est-il ? », puis « Non, c’est faux ». Attendu : Jarvis répond à la correction, et la carte « Les ratés de la semaine » montre cette correction.
2. « Jarvis, ça n’a pas marché ». Attendu : Jarvis dit tout de suite « C'est noté. », sans réfléchir longtemps, et la carte reprend la question d’avant.
3. « Encore une blague ». Attendu : Jarvis raconte (ou essaie), et la carte ne compte pas ça comme un raté.
