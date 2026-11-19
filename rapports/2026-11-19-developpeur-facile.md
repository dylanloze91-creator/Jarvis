# Jarvis Développeur facile, étape 1 (19 novembre 2026)

Branche `claude/developpeur-facile`, partie de `claude/dev` après les corrections 5.0.80. Cahier : `docs/specs/developpeur-facile.md`. **Jarvis Test seulement. Rien sur `main`, rien de publié, pas encore fusionnée dans `claude/dev`.** Rien n'a été essayé dans la fenêtre avec un vrai modèle : les essais passent par la vraie session de chat, avec un faux moteur et de faux résultats de recherche.

## 1. Ce qui change pour toi

Tu écris ou tu dis « Fais-moi une petite appli pour noter mes heures de chantier », dans la discussion normale :

1. Jarvis répond tout de suite, sans attendre un modèle : « Pas de souci, je m'en occupe. Je regarde d'abord ce qui existe déjà. »
2. Une carte apparaît dans la discussion. Elle commence par « Si j'ai bien compris : une petite appli pour noter mes heures de chantier. »
3. En même temps, Jarvis cherche sur Internet ce qui existe déjà, et le moteur prépare le dossier du projet.
4. La carte raconte le travail : une ligne vivante pour l'étape en cours, avec le temps écoulé, puis une ligne par étape finie. Au bout de 30 secondes sur la même étape, la ligne passe en ambre : « C'est long, je suis toujours dessus : … ».
5. Les fichiers apparaissent sous les lignes, avec le dossier du projet et « Ouvrir le dossier ».
6. À la fin : « C'est prêt. Tout est dans le dossier du projet. », ou la raison de l'échec.

Il n'y a plus de carte « Mission proposée » à valider pour une création : la recherche et la base partent tout de suite. Les cartes de sécurité du moteur restent, au moment où elles arrivent.

## 2. Les cinq écrans

Captures prises dans l'aperçu de l'interface (`rapports/developpeur-facile-captures/`). Les applications citées y sont des exemples inventés ; dans Jarvis, seuls de vrais résultats de recherche s'affichent.

| Écran | Capture |
| --- | --- |
| 1. Tout de suite | `1-tout-de-suite.png` |
| 2. Ce que j'ai trouvé | `2-ce-que-j-ai-trouve.png` |
| 3. Il construit et raconte | `3-il-construit-et-raconte.png` |
| 4. Une question à la fois | `4-une-question-a-la-fois.png` |
| 5. C'est prêt | `5-c-est-pret.png` |

Pour les revoir : `npx vite --config vite.ui.config.ts` dans `apps/desktop`, puis `http://127.0.0.1:43173/?scene=developer-facile-1` (jusqu'à `-5`).

## 3. Le cahier, point par point

| Point | État | Détail |
| --- | --- | --- |
| 0 bis. Tout dans la discussion, pas d'onglet à part | **fait** | La carte vit dans la discussion. Dans Test, la discussion qui fait tout est active dès que le mode Développeur l'est (et que le chef d'orchestre est activé), sans l'interrupteur à part |
| 1. Test seulement, Live inchangé | **fait** | Champ `easyDeveloper` de la table d'édition, absent de Live. `parseSettings({})` ne gagne aucune clé, aucun `__golden__` régénéré |
| 1. Sécurités du moteur | **inchangées** | Le moteur n'est pas modifié : dossier neuf, tri des commandes, cartes pour les dépendances, les suppressions et les fichiers protégés |
| 1. Depuis une enceinte | **fait** | Jarvis répond « Pas de souci. Je ne lance rien depuis l'enceinte : je te montre ça sur le PC. » et ne lance rien. **Écart** : la suite ne s'affiche pas toute seule sur le PC ; il faut redemander au clavier ou à la voix du PC |
| 2.1 Phrase fixe en moins d'une seconde | **fait** | Reconnue par règles avant tout modèle (`detectCreationRequest`), dite à la voix si la demande vient de la voix. Essai : aucun modèle appelé |
| 2.1 Reformulation | **fait, sans modèle** | « Si j'ai bien compris : … » reprend tes mots, nettoyés. Le cahier prévoyait un modèle avec un plafond court et ce repli : je n'ai gardé que le repli, pour ne pas faire attendre la carte ni occuper la carte graphique |
| 2.1 La carte de mission ne bloque plus le départ | **fait pour une création** | Modifier, corriger et documenter un projet existant gardent leur carte de proposition |
| 2.2 Recherche, outils existants | **fait** | Deux recherches par `web_search` (« … gratuit », « … open source »), au journal d'audit ; la recherche « comment construire » est celle que le moteur faisait déjà. Trois recherches en tout |
| 2.2 Trois parties, un choix | **fait** | « Ça existe déjà » (1 à 3 applications, une phrase, le lien), « Pour la construire », trois boutons. « Montre-moi celle qui existe » ouvre le premier lien et arrête la construction ; « Je change ma demande » arrête la construction |
| 2.2 Sans réponse, la construction continue | **fait** | |
| 2.2 Jamais de lien inventé | **fait** | Seuls des résultats réellement rendus par la recherche, un par site. Rien trouvé ou Internet coupé : la carte le dit |
| 2.2 « Pour la construire » | **fait, par règle** | Une phrase sans jargon d'après la base choisie, pas un résumé des pages lues |
| 2.3 Base choisie sans modèle, écrite pendant la recherche | **en partie** | Le dossier est préparé pendant la recherche (le moteur le faisait déjà). Le choix de la base passe encore par les étapes du moteur, dont une avec modèle |
| 2.3 « La base marche, je te l'ai ouverte » | **pas fait** | Jarvis n'ouvre pas la base de lui-même. Le moteur a déjà son propre aperçu pour un jeu web, en fin de mission ; pour le reste, il y a « Ouvrir le dossier ». À faire à l'étape suivante |
| 2.3 Un modèle à la fois | **respecté** | La recherche de ce qui existe et les lignes de travail n'utilisent aucun modèle : elles avancent pendant que le moteur travaille |
| 2.4 Ligne de travail vivante, 30 secondes | **fait** | |
| 2.4 Une ligne par étape, jamais une étape qui n'a pas eu lieu | **fait** | Chaque ligne vient d'une étape réelle du moteur, reconnue par son identifiant. Une étape pas commencée ou sautée n'a pas de ligne |
| 2.4 Les fichiers apparaissent | **en partie** | Ils apparaissent quand l'étape qui les a écrits se termine, pas un par un à la seconde où ils sont créés |
| 2.4 À la voix, seulement les moments importants | **fait** | Début, ce qui a été trouvé, une question, la fin |
| 2.5 Une question à la fois, réponse par défaut, 2 minutes | **fait, avec deux limites** | Le mécanisme est en place et testé. Mais aujourd'hui le moteur ne pose **aucune** question pour un projet neuf : tu n'en verras donc pas encore. Et la réponse par défaut est la même pour toutes (« Fais au plus simple. »), pas une proposition propre à chaque question |
| 2.5 Question à l'enceinte, répondue à la voix | **pas fait** | Une création ne part pas d'une enceinte ; la réponse se tape dans la carte |
| 2.6 Mots simples | **fait dans la carte** | Aucune ligne ne dit « branche », « diff », « plan validé », « critères », « copie isolée ». Les cartes de sécurité du moteur gardent leurs mots d'avant |
| 2.6 Détails repliés | **en partie** | « Détails pour développeur » donne le numéro de la mission et renvoie au panneau Développeur ; le plan et les tests ne sont pas recopiés dans la carte |
| 4. Une couche « moteur » claire | **fait** | La carte ne parle au moteur que par trois appels (démarrer, répondre, arrêter) et par son état. Brancher un autre moteur ne demande pas de refaire l'interface |

## 4. Ce que j'ai écrit

- `packages/core/src/developer/facile/facile.ts` (pur) : règle de détection, phrases fixes, recherches, tri des vrais résultats, lignes de travail, question à la fois, phrase de fin, moments dits à la voix.
- `apps/desktop/src/main/chatMission/facile.ts` : `FacileCoordinator`, qui lance la mission « nouveau projet » du moteur et la recherche, puis tient la carte à jour.
- `session.ts` : la demande de création est vue avant le tri ; la création démarre une fois la discussion enregistrée.
- `components/chat/ChatMissionFacileCard.tsx` : la carte.
- Trois canaux (`chat:facile-choice`, `chat:facile-answer`, `chat:facile-open-folder`). « Ouvrir le dossier » n'ouvre que le dossier du projet en cours : aucun chemin ne vient de la fenêtre.
- Une carte restée « en cours » après la fermeture de Jarvis dit qu'elle s'est arrêtée, à la réouverture de la discussion.

Essais (40) : `facile.test.ts` du cœur (17), `chatMission/facile.test.ts` (16), `facile-session.test.ts` (7). Ils couvrent la liste du cahier : réponse immédiate sans modèle ; recherche avec faux résultats (trouvé, rien, Internet coupé) ; lignes tirées de vraies étapes ; question avec réponse par défaut après le délai ; aucune création depuis une enceinte ; tests figés intacts. « Base posée pendant la recherche » n'a pas d'essai à moi : c'est le comportement du moteur, non modifié.

## 5. Essais à faire avec toi, dans Jarvis Test

Avant : mode Développeur activé, chef d'orchestre activé, un modèle Codeur choisi.

1. Au clavier : « Fais-moi une petite appli pour noter mes heures de chantier ». Attendu : la phrase immédiate, la carte, ce qui existe déjà avec de vrais liens, les lignes de travail, les fichiers, le dossier.
2. La même chose à la voix depuis le PC. Attendu : la phrase dite tout de suite, puis seulement les moments importants.
3. Cliquer « Montre-moi celle qui existe » sur une autre demande. Attendu : le lien s'ouvre, la construction s'arrête.
4. Depuis l'enceinte. Attendu : Jarvis répond qu'il ne lance rien depuis l'enceinte.
5. « Comment créer une application ? » Attendu : une réponse normale, pas de création.

À me dire surtout : si les lignes de travail suivent bien ce que fait le moteur, et si une phrase ordinaire est prise à tort pour une création.

## 6. Ce que je n'ai pas pu vérifier

- **Aucune création réelle n'a tourné** : ni la fenêtre, ni la voix, ni le vrai moteur avec un vrai modèle. Le premier essai avec toi sera le vrai test.
- Le lien entre la carte et le moteur repose sur les identifiants des étapes (`scaffold`, `design`, `edit-1`…), lus dans le code du moteur, pas observés sur une vraie mission.
- La qualité du code produit par les petits modèles ne change pas : c'est hors de cette étape.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npx electron-vite build ; aperçu de l'interface lancé pour les cinq captures)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : OK (cœur 234 fichiers, 2678 tests ; bureau 176 fichiers, 914 tests, 8 ignorés par leur propre condition ; aucun __golden__ régénéré, les tests figés passent tels quels)
Secrets   : OK (aucune clé, aucune phrase de l'utilisateur ; les phrases et les applications des essais sont inventées)
Fichiers modifiés : core developer/facile/ (nouveau), chatMissions/envelope.ts, chatMissionsSettings.ts, edition.ts, developer/index.ts ; bureau chatMission/facile.ts (nouveau), hub.ts, ipc.ts, session.ts, index.ts, shared/ipc.ts, preload ; fenêtre ChatMissionFacileCard.tsx (nouveau), ChatMissionBlock.tsx, useChat.ts, App.tsx, preview/ ; script de capture ; CLAUDE.md, AGENTS-COORDINATION.md, ce rapport
Prêt à fusionner : NON (dans claude/dev seulement, après les essais avec toi)
À corriger : ouvrir la base dès qu'elle tourne ; réponse par défaut propre à chaque question ; suite sur le PC après une demande à l'enceinte
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```
