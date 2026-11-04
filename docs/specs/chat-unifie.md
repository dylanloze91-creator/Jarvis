# Cahier des charges — Une seule discussion qui fait tout (5.0.68)

Rédigé par Claude pour Cursor, le 4 novembre 2026. Lire `CLAUDE.md` en entier, en particulier 0.4.23 à 0.5.5 et 5.0.0/5.0.1 (Jarvis Développeur), 5.0.60 (chef d'orchestre), 5.0.62 (vérification du destinataire), 5.0.63 (téléphone), 5.0.64 (enceintes), caractère de Jarvis, validation des équipes.

## Demande de l'utilisateur

« J'aimerais que l'interface chatbot de Jarvis soit liée à Développeur et que ce ne soit pas deux choses dissociées. J'ouvre une conversation avec Jarvis, et dès qu'il voit que ça part sur du code, on va sur du développement. Il peut écrire du code directement accessible depuis mon ordinateur. Un chatbox qui fait tout. Les modèles sont différents, mais la discussion reste la même. »

C'est la décision **D7** (entrée des missions depuis le chat), tranchée par l'utilisateur : **oui**. Elle prépare aussi l'équipe **Tâches** (voir Phase 2).

## Principe

La discussion reste la seule porte. Quand une demande demande de **produire ou modifier des fichiers de code**, Jarvis propose une **mission** de Jarvis Développeur **dans la discussion**, l'utilisateur la lance d'un clic, et la mission se déroule **sous ses yeux dans la même discussion** : plan, étapes, cartes de confirmation, rapport, « Appliquer ». Le panneau Développeur reste pour les réglages avancés et l'historique, mais on ne doit plus avoir besoin d'y aller.

**Aucun moteur nouveau** : on réutilise `MissionWorkflow`, `CodeTaskWorkflow`, les copies isolées, le tri des commandes, la revue du diff, les cartes, le journal. On branche seulement leur entrée et leur affichage sur la discussion.

## Phase 1 (à livrer) — missions de code depuis la discussion

1. **Réglage** `developer.chatMissions` (facultatif, **sans défaut Zod**). Absent ou faux : rien ne change (`chat-unchanged.test.ts`, `orchestra-session.test.ts` verts sans régénération). Actif seulement si le mode Développeur est activé et le chef d'orchestre aussi. Interrupteur dans Réglages → Développeur : « Lancer les missions depuis la discussion ».
2. **Détection.** Quand le chef d'orchestre envoie un tour à l'équipe **Code** (express ou cerveau), l'équipe Code reçoit un seul outil de plus, `proposer_mission` (`{ type: modifier|corriger|nouveau-projet|documenter, objectif, projet? }`, `safe`, jamais exécuté sans clic) : elle s'en sert quand la demande veut des fichiers (« crée-moi », « ajoute », « corrige le bug de », « fais-moi un programme »). Une question d'explication ou un petit extrait (« c'est quoi une boucle for », « montre-moi un exemple ») reste une réponse écrite normale. Consigne courte, exemples dans les tests (pas de long mode d'emploi pour un petit modèle).
3. **Carte « Mission proposée »** dans la discussion (nouvel élément de discussion, pas une confirmation d'outil) : type, objectif reformulé, projet visé, modèle de code qui travaillera, estimation de difficulté (`assessMission` : une mission trop grosse montre la carte « Mission non lancée » avec la version ciblée, comme aujourd'hui), boutons **Lancer** / **Modifier l'objectif** / **Non**. Rien ne démarre sans « Lancer ».
4. **Projet visé.** Choix parmi : Jarvis (`developer.repoPath`), les projets du registre, ou « Nouveau projet » (Project Factory, dossier `developer.projectsRoot`). Si la demande ne le dit pas clairement, la carte montre la liste et l'utilisateur choisit ; jamais deviné en silence.
5. **Suivi en direct dans la discussion** : un bloc de mission qui se met à jour (une ligne par étape et par spécialiste : questions, conception, plan, copie isolée, tests, corrections, revue), en français simple, repliable ; les questions du REASONER s'affichent comme des messages auxquels l'utilisateur répond dans la discussion ; les **cartes de confirmation** de la tâche (développeur) apparaissent dans la discussion, mêmes règles qu'aujourd'hui (tri des commandes, revue du diff, cœur et hors plan toujours confirmés).
6. **Rapport final dans la discussion** : ce qui a été fait, fichiers modifiés, tests avant/après, et les boutons **Appliquer à mon projet** (fusion confirmée, comme le rapport actuel), **Ouvrir le dossier** (l'Explorateur sur la copie isolée ou le projet ; lancé par le processus principal, chemin connu de la mission, jamais un chemin venu du modèle), **Garder** / **Jeter**. Pour un nouveau projet : « Ouvrir le dossier » et « Lancer » s'il a une commande de lancement connue.
7. **La discussion garde la priorité** (décision 5) : pendant une mission, l'utilisateur peut continuer à parler à Jarvis ; un tour de discussion met la mission en pause et libère le modèle de code, comme aujourd'hui. Une seule mission à la fois ; une nouvelle proposition pendant une mission en cours le dit et propose d'attendre.
8. **Téléphone** : la carte de mission, le suivi et les confirmations s'affichent sur la page du téléphone (mêmes règles que les cartes actuelles). **Enceintes** : une proposition de mission est dite (« Je peux lancer une mission pour ça, valide-la sur le PC ou le téléphone. ») et jamais lancée depuis l'enceinte.
9. **Historique** : la mission est rattachée à la conversation (identifiant de mission dans le message) ; rouvrir la conversation remontre le bloc de mission et son rapport depuis `userData/developer/projects/<projet>/missions/`.
10. **Voix** : à l'oral, Jarvis dit seulement une phrase (« Je te propose une mission pour ça, elle est à l'écran. ») ; rien de la mission n'est lu à voix haute.

## Phase 2 (plus tard, à ne pas faire maintenant) — équipe Tâches

10e équipe du chef d'orchestre, `taches` : un travail en plusieurs étapes qui n'est pas forcément du code (ranger des fichiers, préparer un résumé à partir de recherches, organiser l'agenda). Même forme : plan montré, lancé d'un clic, étapes suivies dans la discussion, outils des autres équipes, confirmations habituelles ; pour du code, elle passe par la mission de la Phase 1. L'examen du trieur a déjà des phrases réelles étiquetées « taches ». À spécifier après la Phase 1.

## Règles

- Jarvis Développeur reste coupé par défaut ; ses outils `dev_*` ne passent jamais dans le catalogue du chat (seul `proposer_mission` est ajouté, à l'équipe Code, avec le réglage actif).
- Jamais de push, jamais de publication, jamais d'écriture dans la copie de l'utilisateur sans « Appliquer » et sa carte.
- Aucun modèle choisi par Jarvis : la mission utilise `developer.roleModels` / `developer.codeModel` ; sans modèle de code, la carte le dit et renvoie au réglage.
- Un seul modèle chargé à la fois sur la carte graphique (règles actuelles).

## Livraison

- Branche `cursor/chat-unifie-5068` depuis `origin/main`, inscrite dans `AGENTS-COORDINATION.md`. Commits petits, un par point.
- Tests : proposition par l'équipe Code (demande de fichiers → carte ; question d'explication → réponse écrite), rien ne démarre sans clic, mission trop grosse → carte « non lancée », choix du projet, suivi et confirmations dans la discussion (vraie `ChatSession` + contrôleur de test `controllerHarness.testkit.ts`), discussion prioritaire, téléphone, enceinte (jamais lancée), réglage absent = comportement identique.
- `npm run typecheck`, `npm test`, `npm run lint` verts (5 échecs dotnet attendus seulement sans SDK).
- `CLAUDE.md` : section « 5.0.68 — une seule discussion qui fait tout » et lignes dans « Ce qu'il ne faut pas casser » ; décision D7 notée comme tranchée.
- Pas de fusion dans `main`, pas de publication. Rapport `rapports/2026-11-0X-chat-unifie.md` + RAPPORT DE VÉRIFICATION, avec des captures des scènes d'aperçu (`?scene=...`) de la carte, du suivi et du rapport.
