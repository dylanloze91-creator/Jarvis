# Jarvis Développeur facile, étape 2 (20 novembre 2026, le soir)

Écrit par Claude (le chat), depuis le cloud, à la demande de l'utilisateur (« oui go »).
Branche `claude/developpeur-facile-etape2`, partie de `claude/developpeur-facile`.
**Jarvis Test seulement**, comme l'étape 1.
Point de départ : l'essai réel de Claude Code le matin (`rapports/2026-11-19-developpeur-facile.md`, § 7, « Ce qui coince » points 2 à 5).

## Ce qui change

| # | Ce qui coinçait | Maintenant |
| --- | --- | --- |
| 2 | « Une appli pour noter mes heures » donnait un programme qu'on lance en tapant une commande | Une **appli, un programme, un logiciel, un outil**, un minuteur, un convertisseur… partent de la base **« page avec écrans »** (`vite-react`). La base « programme à commande » reste seulement si la demande parle de ligne de commande, de CLI, de script ou de terminal. Une appli Windows reste une appli Windows. Si le modèle choisit quand même « programme à commande » pour une appli, Jarvis le ramène à la base avec écran (`steerFactory`) |
| 3 | « C'est prêt » ne disait pas comment s'en servir | Pour une appli : « C'est prêt. Clique sur « Ouvrir l'appli » pour l'essayer… », avec un **bouton « Ouvrir l'appli »** sur la carte. Le clic prépare l'appli (`npm run build` dans son dossier ; le clic vaut accord, et c'est noté au journal), puis l'ouvre dans la fenêtre d'aperçu de Jarvis, servie en local comme le jeu. Préparation ratée : la raison est dite. Pour un programme à commande : où trouver le mode d'emploi ; pour une appli Windows : comment la construire |
| 4 | Noms de projet « pour-noter-mes », « qui-additionne-mes » | « Heures chantier », « Heures chantier semaine », « Minuteur pauses », « Convertisseur mètres pieds ». Les petits mots, les possessifs, « pour » + verbe et « qui » + verbe en tête sont retirés. « CLI qui renomme » (essai existant) ne change pas |
| 5 | « Crée-moi un minuteur de pause café » partait à l'équipe PC | Un **petit outil** (minuteur, chronomètre, compteur, convertisseur, générateur, quiz…) est une création avec un verbe qui fabrique (crée, développe, code, programme, construis, fabrique). Sans ce verbe, ou avec une durée (« un minuteur de 5 minutes »), la demande reste ce qu'elle était |

**Pas fait** :
- la carte trop haute dans la petite fenêtre (point 6) : il faut le voir à l'écran ;
- le mode Développeur coupé (point 7) ;
- la recherche « bonne façon de faire » du moteur notée indisponible (point 8) ;
- le bouton « Ça n'a pas marché » affiché trop tôt (point 9) ;
- Ornith qui plante à l'écriture (point 1, côté moteur et modèle).

## Essais

Lanceur compatible avec Vitest, monté dans le cloud avec `zod` 3.25 (API v4) et les types de Node déjà présents sur la machine. Ce n'est pas le vrai Vitest.

- **Cœur, tous les fichiers d'essai (234)** : 2 545 réussis avec l'étape 2, contre 2 542 avant ; les 3 de plus sont les nouveaux essais. Les échecs sont identiques avant et après (limites du lanceur). **Aucune régression.**
- **Nouveaux essais**, tous réussis :
  - cœur, `facile.test.ts` : petit outil compris ou non, phrase de fin selon la base, base et nom sur 8 demandes, base ramenée par `steerFactory` ;
  - bureau, `chatMission/facile.test.ts` (21/21) : bouton qui ouvre, préparation ratée dite, pas de bouton pour un programme à commande, rien ne s'ouvre avant « prêt ».
- **Bureau, missions et projets** : résultats identiques avant et après, fichier par fichier. `fallbackMission` (1/5) et `history` (3/6) échouent pareil des deux côtés dans le cloud : ils ont besoin de vrais git et npm.
- **Types** : aucune erreur dans les fichiers du processus principal touchés. La carte (React) n'a pas pu être contrôlée ici : les types de React manquent.

**Pas lancés ici** : `npm run typecheck`, `npm test` et `npm run lint` officiels, l'interface, une vraie création.

## À faire par Claude Code (Jarvis Test)

1. Contrôles officiels sur cette branche, `fallbackMission.test.ts` et `missionWorkflow.test.ts` compris (le choix de la base a changé pour « programme » et « outil »). Vérifier que la carte se compile.
2. Fusionner dans `claude/developpeur-facile`, puis dans `claude/dev` avec l'étape 1.
3. Essai réel :
   - « Fais-moi une petite appli pour noter mes heures de chantier », Codeur `qwen3.5:4b` : dossier `heures-chantier`, base avec écran, « C'est prêt » puis « Ouvrir l'appli » ;
   - « Crée-moi un minuteur de pause café » : une création ;
   - « Fais-moi un minuteur de 10 minutes » : pas une création.
4. Une capture de la carte à la fin, pour l'utilisateur.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : PAS FAIT (npm bloqué dans le cloud)
Types     : OK pour le cœur et les fichiers du processus principal touchés (tsc, zod 3.25/v4) ; carte React non contrôlée (types React absents)
Style     : PAS FAIT (eslint absent)
Tests     : OK avec un lanceur compatible : cœur 2545/2615 (échecs identiques avant/après), bureau missions et projets identiques avant/après, 7 nouveaux essais réussis
Secrets   : OK (aucune clé, aucune phrase de l'utilisateur ; demandes d'essai inventées ou reprises des essais de Claude Code)
Fichiers modifiés : core developer/facile/facile.ts, developer/engine/fallbacks.ts ; bureau chatMission/facile.ts, chatMission/ipc.ts, developer/controller.ts, developer/project/projectPreview.ts, shared/ipc.ts, preload/index.ts, preview/bridge.ts, ChatMissionBlock.tsx, ChatMissionFacileCard.tsx ; essais facile.test.ts (cœur et bureau) ; AGENTS-COORDINATION.md, ce rapport
Prêt à fusionner : OUI dans claude/developpeur-facile puis claude/dev, après les contrôles officiels ; jamais dans la Live sans décision de l'utilisateur
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```
