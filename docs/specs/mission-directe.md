# Cahier des charges — La carte de mission s'affiche à coup sûr (5.0.69)

Rédigé par Claude pour Cursor, le 4 novembre 2026. Lire `CLAUDE.md`, en particulier 5.0.60 (chef d'orchestre), 5.0.68 (« une seule discussion qui fait tout ») et 5.0.1 (gabarits). Cahier précédent : `docs/specs/chat-unifie.md`.

## Constat (essai réel de l'utilisateur, 5.0.68)

Tous les réglages sont bons : Développeur activé, chef d'orchestre activé, « Lancer les missions depuis la discussion » coché. Demande : un script pour lancer ses impressions 3D depuis MainsailOS. Le tri a bien envoyé le tour à l'équipe Code (pastille « Code · qwen2.5-coder:7b · choisi par le cerveau »).

Mais **aucune carte** : `qwen2.5-coder:7b` a **écrit la mission en texte** au lieu d'appeler `proposer_mission` (« Objectif : … Projet : … Type : Nouveau-projet. Est-ce que cela te convient ? »). En plus, l'objectif qu'il a écrit est **inventé** (« se connecte via SSH et lance une commande de dépôt de tranches (M3U) » : ni SSH ni M3U n'existent dans la demande, et M3U n'est pas une commande d'impression). L'utilisateur ne peut rien lancer.

Leçon : un petit modèle ne doit pas être le seul chemin vers la carte, et il ne doit pas écrire l'objectif.

## Principe

Comme le calcul exact, l'horloge et les règles express du chef d'orchestre : **ce qui se décide par une règle sûre ne passe pas par un modèle.** La carte est construite par Jarvis **à partir des mots de l'utilisateur**. Le modèle ne reste que pour les cas flous.

## À livrer

### 1. Chemin direct, sans modèle (`packages/core/src/developer/chatMissions/detect.ts`)

`directMissionRequest(text): { type, objectif, langage? } | null`, pure, testée phrase par phrase.

- **Oui** quand la phrase demande clairement **des fichiers** : un verbe de création ou de modification (crée, créer, fais, fabrique, écris-moi, code-moi, développe, programme, ajoute, modifie, change, corrige, répare, documente…) **et** un objet de code (script, programme, appli, application, logiciel, jeu, site, page web, outil, fonction, bouton, bug, fichier, projet, module…). Formes parlées comprises (« Jarvis, tu peux me faire un script qui… », « j'aimerais un programme qui… », « il me faudrait un script pour… »).
- **Non** (retour `null`, chemin actuel par le modèle) : `looksLikeCodeExplanationOnly`, une question (« comment on fait un script… ? », « c'est quoi… »), « montre-moi un exemple », une phrase sans objet de code, une demande de conseil (« tu me conseilles quel langage ? »).
- **Type** par règles : corrige / répare / bug / erreur → `corriger` ; documente / doc / README → `documenter` ; ajoute / modifie / change **avec** un projet connu nommé (Jarvis, un nom du registre des projets) → `modifier` ; sinon (crée, fais, écris, un nouveau…) → `nouveau-projet`.
- **Objectif = la phrase de l'utilisateur**, nettoyée seulement : mot de réveil en tête ou en fin (`stripTrailingWakeWord`, `wakeWordAddress`), formules de politesse et d'amorce (« tu peux me », « est-ce que tu pourrais », « s'il te plaît »), espaces. **Rien n'est ajouté ni reformulé par un modèle.** Au moins 8 caractères (`proposerMissionSchema`), sinon `null`.
- **Langage demandé** (`langage`) : relevé s'il est nommé (python, .py, bash, powershell, rust, go, java, c++, php…). Voir le point 3.

Dans `session.ts`, branche orchestre : si `chatMissionsOn` (inchangé : Développeur + chef d'orchestre + réglage + équipe `code`) **et** `directMissionRequest` rend une demande **et** aucune mission n'est en cours (`missionBusy`) → **aucun appel au modèle de l'équipe Code**. Jarvis enregistre la proposition (`chatMissionHub.recordProposal`), émet exactement les mêmes événements que le chemin de l'outil (message `chatMission: { kind: 'proposal' }`, `mission_proposal`, `voiceHint`), précédés d'un texte fixe court : « Je te propose une mission pour ça. Vérifie l'objectif avant de lancer. » Pastille : « Code · mission directe » (`how` dédié, comme `calcul` / `express`). Mission en cours → texte fixe existant qui le dit, pas de nouvelle carte.

Le reste de la carte ne change pas : projet à choisir, modèle Codeur, `assessMission` / `MissionGateCard`, boutons Lancer / Modifier l'objectif / Non. « Modifier l'objectif » permet à l'utilisateur de préciser avant de lancer.

### 2. Filet si le modèle écrit la mission en texte

Chemin par le modèle (cas flous) : si le tour se termine **sans** appel `proposer_mission` alors que `chatMissionsOn`, et que la réponse ressemble à une mission écrite (au moins deux lignes parmi « Objectif : », « Projet : », « Type : », ou « mission » + « Est-ce que cela te convient ») → Jarvis ajoute la carte construite **depuis la phrase de l'utilisateur** (règles du point 1 ; type `nouveau-projet` par défaut), jamais depuis le texte du modèle, avec la ligne « Objectif repris de ta demande. » Le texte du modèle reste affiché tel quel (pas de réécriture d'un message déjà diffusé).

### 3. Langage non pris en charge : le dire sur la carte

Jarvis Développeur ne fabrique que des projets Node (JavaScript / TypeScript) et .NET (Python reporté, D6). Si `langage` est nommé et n'est ni JavaScript, TypeScript, Node, C# ni .NET : la carte affiche, en clair, « Jarvis Développeur ne sait pas encore écrire de Python. La mission créera un programme JavaScript (Node) qui fait la même chose. » (nom du langage repris). « Lancer » reste possible (l'utilisateur décide) ; l'objectif transmis à la mission garde la phrase de l'utilisateur et ajoute « (en JavaScript / Node, Python non pris en charge) » pour que l'ARCHITECTE choisisse `node-cli`. Jamais de mission qui prétend écrire du Python.

### 4. Consigne de l'équipe Code (seulement quand `chatMissionsOn`)

`CODE_MISSION_TOOL_PROMPT` gagne une phrase : « N'écris jamais une mission en texte (Objectif, Projet, Type) : appelle proposer_mission, ou réponds normalement. » Le prompt de l'équipe Code hors missions ne change pas.

### 5. Plus de saut vers la page Développeur depuis la discussion

Constat (même soir) : l'utilisateur tape une correction (« Non, c'est faux. … envoyer un fichier G-code … ») et la fenêtre **bascule sur la page Développeur** au lieu d'envoyer le message. Cause : `UnifiedJarvisChat.tsx` (`submit`) appelle encore l'ancien aiguillage `isDeveloperVoiceIntent` (`packages/core/src/developer/voiceAssistantRoute.ts`), antérieur à 5.0.68. « G-code » y passe pour le verbe « code » (le trait d'union fait une frontière de mot) et « fichier » pour un sujet de développement.

- Quand `chatMissionsEnabled(settings)` est vrai, **plus aucun aiguillage côté fenêtre** : tout part dans la discussion, c'est le chef d'orchestre et le point 1 qui décident.
- Même réglage coupé : **jamais** d'aiguillage pour une correction ou une préférence (`classifyUtterance` ≠ `one-off` : « Non, … », « C'est faux … », « Corrige … » adressés à Jarvis, « Retiens que … »), sinon la correction n'est jamais enregistrée par l'apprentissage (`noteToRecord` dans `turnContext`).
- `isDeveloperVoiceIntent` : « code » précédé d'un trait d'union ou d'une lettre (G-code, gcode, QR code, code postal) n'est pas le verbe « coder ». Les mots accentués en tête (`écris`, `crée`, `améliore`) ne sont jamais reconnus par `\b` sans le drapeau `u` : corriger (frontières explicites `(?<![\p{L}\p{N}])` / `(?![\p{L}\p{N}])` avec `u`), tests à l'appui.
- Tests : `voiceAssistantRoute.test.ts` (G-code, correction, accents) et un test de rendu de `UnifiedJarvisChat` (réglage actif : `chat.send` appelé, `onOpenDeveloper` jamais ; correction réglage coupé : `chat.send`).

## Ce qui ne change pas

- `developer.chatMissions` absent ou faux, Développeur coupé, chef d'orchestre coupé : **rien ne change** (`chat-unchanged.test.ts`, `ollama-unchanged.test.ts`, `orchestra-session.test.ts`, `chat-missions-proposer.test.ts` verts **sans régénération**).
- Rien ne démarre sans « Lancer ». Enceinte : jamais lancée (`SPEAKER_MISSION_PROPOSAL`). Téléphone : même carte.
- Aucun modèle n'invente l'objectif sur le chemin direct.

## Tests

- `detect.test.ts` : au moins 30 phrases réelles de forme (synthétiques, marquées `synthetique-test`), dont : « Jarvis, écris-moi un script Python pour lancer mes impressions 3D depuis Mainsail » → `nouveau-projet`, langage `python`, objectif sans « Jarvis » ; « corrige le bug du bouton exporter dans Jarvis » → `corriger` ; « ajoute un bouton pause dans mon Pong » (projet du registre) → `modifier` ; « fais-moi un jeu de serpent » → `nouveau-projet` ; « c'est quoi une boucle for » → `null` ; « comment on fait un script Python ? » → `null` ; « montre-moi un exemple de fonction » → `null` ; « tu me conseilles quel langage pour un robot ? » → `null` ; « merci » → `null`.
- `chat-missions-direct.test.ts` (vraie `ChatSession`, faux modèle qui **échouerait** s'il était appelé) : demande claire → carte sans appel au modèle Code, objectif = phrase nettoyée, pastille « mission directe » ; mission en cours → pas de carte ; réglage coupé → chemin d'avant ; cas flou → modèle appelé ; modèle qui écrit « Objectif : … Type : … » sans outil → carte ajoutée depuis la phrase de l'utilisateur ; langage Python → ligne d'avertissement sur la carte et objectif transmis avec la mention Node.

## Livraison

- Branche `cursor/mission-directe-5069` depuis `origin/main`, inscrite dans `AGENTS-COORDINATION.md`. Dans `CLAUDE.md` : ajouter seulement ta section « 5.0.69 — la carte de mission à coup sûr » et ta ligne dans « Ce qu'il ne faut pas casser ».
- Avant de pousser : `npm run typecheck`, `npm test`, `npm run lint` (seuls les échecs dotnet attendus sans SDK .NET).
- Pas de fusion dans `main`, pas de publication : Claude relit d'abord. Rapport `rapports/2026-11-0X-mission-directe-5069.md` puis le RAPPORT DE VÉRIFICATION.
