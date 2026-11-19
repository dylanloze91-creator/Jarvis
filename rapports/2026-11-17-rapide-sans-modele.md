# Jarvis plus rapide, sans nouveau modèle (17 novembre 2026)

Mission 2 bis de la feuille de route, cahier `docs/specs/rapide-sans-modele.md`. Branche `claude/rapide-sans-modele`, partie de `claude/dev` (5.1.0-test.1), faite par Claude Code sur le PC Windows. **Jarvis Test seulement. Rien n'est fusionné dans `claude/dev`, rien n'est publié. Jarvis Live, `claude/live-5079`, Jarvis Test installé et ses conversations n'ont pas été touchés.** Aucun modèle n'a été ajouté, changé ni entraîné.

## 1. En bref

| Outil | Ce qu'il fait gagner (mesuré au banc) | Décision |
| --- | --- | --- |
| Chronomètre, `vitesse.ps1`, banc | rien : ils mesurent | gardés |
| Modèles gardés chauds | premier tour après le démarrage : 8,2 s → 3,0 s (le chargement de 5,3 s est fait pendant le démarrage) | gardé |
| Ligne d'heure sortie du message système | lecture du prompt d'une question à outil : 2,0 s → 0,6 s (PC), 1,8 s → 0,3 s (fichiers) ; sur tout le banc, lecture du modèle de la carte : 37 s → 25 s (−33 %) | gardé, avec une règle de sûreté (section 4) |
| Ligne d'heure placée **après** la demande | même gain, mais une question à outil ratée 2 fois sur 7 | **retiré** |
| Mémoire courte des outils | même recherche redemandée : 1,0 à 1,5 s de moins ; même cours de bourse : 0,5 s → 2 ms | gardé |
| Descriptions d'outils raccourcies, historique limité | rien à gagner une fois le début du prompt gardé en mémoire | **pas faits** (section 4) |
| Outil des règles express | prêt, liste vide : les règles attendent `carte.md` | gardé |

Le chronomètre montre surtout **où le temps part vraiment** : 55 % dans l'écriture de la réponse (13 à 15 jetons par seconde), et 36 % dans la lecture du prompt, dont les trois quarts par les deux équipes qui tournent sur le processeur. Les outils de cette mission ne touchent pas à l'écriture. La plus grosse économie possible est un réglage à toi, que je n'ai pas changé (section 6) : sur le modèle de la carte, une demande à l'équipe Mémoire passe de 62 s à 5,6 s, une question de code de 48 s à 3,4 s.

## 2. Comment c'est mesuré

- **Le chronomètre.** Dans Jarvis Test, chaque ligne du journal du tour porte maintenant le détail des étapes, en millisecondes : `tri`, `chargement`, `lecture` (avec les jetons lus), `premierMot`, `ecriture` (avec les jetons écrits), `outils` (un par outil) et `voix`. Les anciens journaux restent lisibles. Rien n'est écrit dans Jarvis Live.
- **`scripts\vitesse.ps1`** lit les journaux de Jarvis Test et écrit `C:\dev\jarvis-data\vitesse\vitesse.md` : médiane et pire cas par étape, par équipe, par chemin, par source et par modèle, et la part du temps de chaque étape. Des chiffres seulement.
- **Le banc** (`npm run banc:vitesse --workspace @jarvis/desktop -- `, étiquette dans `JARVIS_BANC_LABEL`) passe 29 demandes types dans la vraie session de chat, avec tes réglages de Jarvis Test (lus, jamais écrits), le vrai catalogue d'outils et le vrai Ollama. Il part à froid (tous les modèles déchargés). Seules la fenêtre et la voix manquent. Tout se passe en mémoire : tes conversations, ta mémoire et ton carnet ne reçoivent rien. Les demandes sont écrites par moi et ne servent qu'au banc.
- **Un outil à la fois** : `JARVIS_BANC_SANS=chauds,heure,memoire` coupe un outil pour un passage. `npm run vitesse:comparer --workspace @jarvis/core -- avant.json apres.json` écrit le tableau.
- **Contrôle des réponses** : `JARVIS_BANC_REPONSES=1` affiche les réponses aux demandes types (elles ne sont jamais enregistrées). C'est ce contrôle qui a fait retirer un placement de la ligne d'heure.

**À savoir pour lire les tableaux.** La durée d'un tour dépend surtout de la longueur de la réponse, qui change d'un passage à l'autre (une même question a reçu 182 puis 762 jetons). Les lignes « tour entier » et « écriture » bougent donc toutes seules. Pour juger un outil, il faut lire la ligne de **son** étape.

## 3. Où part le temps (mesure de départ)

29 demandes, 472 s en tout.

| Étape | Part du temps |
| --- | --- |
| écriture de la réponse | 57 % |
| lecture du prompt | 31 % |
| outils | 5 % |
| tri (choix de l'équipe) | 4 % |
| chargement des modèles | 3 % |

- **Écriture** : `qwen2.5:7b` écrit 13 à 15 jetons par seconde. Il n'est qu'à 79 % sur la carte (4 073 Mo sur 5 158) : environ 1,7 Go de la carte est pris par d'autres programmes ouverts.
- **Lecture** : sur la carte, environ 1 000 jetons par seconde. Sur le processeur, 30 à 140 : une demande à l'équipe Mémoire lit pendant 41 s, une question de code pendant 32 s.
- **Tri** : quand le cerveau trie, 0,3 à 0,5 s par demande. Les règles (horloge, calcul, bourse, express) trient en quelques millisecondes.
- **Chargement** : 5,3 s pour le cerveau à froid, 4,2 et 4,8 s pour les deux modèles du processeur.
- **Outils** : 1,0 à 2,2 s pour une recherche sur Internet, 0,5 s pour un cours de bourse, 4,6 s pour la liste des processus.

## 4. Outil par outil

### 4.1 Modèles gardés chauds — gardé

- Au démarrage de Jarvis Test, après l'affichage de la fenêtre, le modèle qui trie et celui de l'équipe la plus utilisée (d'après le journal du tour ; Conversation sinon) sont chargés sans rien générer. Chez toi c'est le même modèle : un seul chargement, 4,5 s.
- Toutes les 8 minutes, les modèles du chef d'orchestre **encore chargés** sont prolongés de 30 minutes. Un modèle déchargé par Jarvis Imager, par Jarvis Développeur ou par Ollama n'est jamais rechargé par cette boucle. Rien n'est fait pendant une image, une mission ou un entraînement.
- La requête de chargement porte les mêmes options que les vraies demandes (`num_ctx`, `num_gpu`). Sans elles, Ollama rechargerait le modèle à la première demande.

| | avant | après |
| --- | --- | --- |
| premier tour après le démarrage | 8,2 s (dont 5,3 s de chargement) | 3,0 s |
| tri, pire cas | 6,3 s | 0,6 s |
| tours qui paient un chargement de plus d'une seconde | 4 | 2 |

Les deux chargements qui restent sont le premier appel à chaque équipe du processeur (4,2 s et 4,8 s). **Non mesuré au banc** : la prolongation, parce qu'il faudrait attendre plus de 30 minutes sans rien demander. Elle évite ce même chargement après chaque longue pause.

**Le va-et-vient.** Ta répartition utilise quatre modèles différents (`qwen2.5:7b`, `qwen2.5:3b`, `qwen3.5:4b`, `jarvis-coder`). J'en ai vu trois chargés en même temps, jamais quatre. Le cerveau et les équipes de la carte partagent le même modèle : pas de va-et-vient entre eux. La proposition de la section 6 ramène le tout à deux modèles.

### 4.2 Prompt plus court et réutilisable

**Ce que l'expérience a montré.** Ollama garde le début d'un prompt déjà lu, et il en garde plusieurs à la fois : six prompts différents en alternance sont tous retrouvés (56 ms au lieu de 1,5 s). Le cerveau ne casse donc pas le cache des équipes. En revanche, la ligne d'heure change chaque minute, et tout ce qui la suit est relu : les outils de l'équipe et tout l'historique.

| Prompt de 3 046 jetons (outils et historique) | lecture |
| --- | --- |
| ligne d'heure dans le message système, minute suivante | 3,0 s |
| ligne d'heure dans la demande, minute suivante | 0,5 s |
| ligne d'heure dans la demande, tour suivant | 0,14 s |

**Ce qui est gardé.** Dans Jarvis Test, la ligne d'heure des équipes est placée dans la demande du tour, juste avant tes mots, dans la copie envoyée au modèle seulement. Ce qu'elle dit ne change pas. Le message affiché et enregistré ne change pas. Le tour de recherche sur Internet ne répète plus la date dans le message système.

| Six à huit passages par cas | avant | après |
| --- | --- | --- |
| lecture, question au PC | 2,0 s | 0,6 s |
| lecture, question sur les fichiers | 1,8 s | 0,3 s |
| lecture du modèle de la carte, sur tout le banc | 37 s | 25 s (−33 %) |
| premier mot, médiane du modèle de la carte | 3,7 s | 3,2 s |
| outil appelé quand il le faut | 18 sur 18 | 24 sur 24 |

**Ce qui a été retiré, et pourquoi.**

- **La ligne placée après la demande** : même gain, mais « Quelle fenêtre est active sur mon PC ? » a reçu deux fois sur sept une réponse inventée, sans appel de l'outil (zéro fois sur huit avant). Retiré.
- **La ligne dans la demande quand on parle de temps** : pour « il est déjà tard là, non ? », l'heure n'était plus donnée qu'une fois sur deux. Dès qu'une demande contient un mot de temps (heure, jour, tard, demain, ce soir, aujourd'hui…), la ligne reste donc dans le message système, comme avant. La liste est large exprès : un mot de trop ne coûte qu'un peu de vitesse.

**Ce qui n'a pas été fait.**

- **Raccourcir les descriptions d'outils** : une équipe reçoit 530 à 1 270 jetons d'outils, la plus longue description fait 329 caractères. Une fois le début du prompt gardé, ces jetons ne sont plus relus. Rien à gagner.
- **Retirer des outils d'une équipe** : il faut savoir lesquels ne servent jamais. C'est `carte.md` qui le dira.
- **Limiter l'historique** : avec le cache, l'historique n'est plus relu ; le couper obligerait justement à le relire. Mais le banc montre un vrai risque : à la quatrième recherche d'une même discussion, le prompt atteint 6 400 à 7 100 jetons (limite : 8 192) et la réponse s'allonge (jusqu'à 762 jetons, 85 s). À décider avec `vitesse.md` : raccourcir les anciens résultats d'outils.

**Limite trouvée.** `qwen3.5:4b` (équipe Mémoire, processeur) relit tout son prompt à chaque appel, avec ou sans ce changement : 23 s à la deuxième demande dans les deux cas. `jarvis-coder`, lui, profite du cache (32 s puis 2,2 s).

### 4.3 Mémoire courte des résultats d'outils — gardée

- Un résultat **réussi** d'un outil de **lecture** est gardé quelques minutes : recherche et lecture de page 5 min, actualité et météo 3 min, cours de bourse 2 min, écoute d'une vidéo 30 min. Les durées sont dans `packages/core/src/tools/resultMemory.ts`.
- Jamais pour un outil qui agit, ni pour un outil qui demande un accord. Un échec n'est pas gardé. Les réglages changés vident la mémoire. Rien n'est écrit sur le disque.
- Le journal d'audit dit « réponse gardée, vieille de 3 min » ; le journal du tour note `garde`.

| Même demande une seconde fois | avant | après |
| --- | --- | --- |
| recherche sur Internet (outil) | 1,0 à 1,5 s | 0 ms |
| premier mot, météo redemandée | 3,2 s | 2,1 s |
| premier mot, recherche redemandée | 5,5 s | 4,0 s |
| cours de bourse redemandé (tour entier) | 0,5 s | 2 ms |

### 4.4 Outil des règles express — prêt, liste vide

`packages/core/src/agent/expressRules.ts` : une règle se décrit par des mots qui la déclenchent, des mots qui l'empêchent, et au moins trois phrases qu'elle doit prendre et trois qu'elle ne doit pas prendre. Une règle sans ses essais, dont un essai échoue, ou qui contredit une règle en place fait échouer les tests. Deux règles d'équipes différentes sur la même phrase ne décident rien : le cerveau tranche. La liste est vide, donc rien ne change aujourd'hui. Chaque règle fera gagner le tri du cerveau, 0,3 à 0,5 s par demande.

## 5. Ce qui attend `carte.md` et `vitesse.md`

- Les règles express elles-mêmes.
- Les outils à retirer de chaque équipe.
- Le poids réel de l'historique (jetons lus par tour dans ton usage).
- La mémoire apprise ajoutée au message système : elle change avec chaque question et peut faire relire les outils. Le banc ne la voit pas (sa mémoire est vide). `vitesse.md` le montrera : si la lecture reste haute dans ton usage, c'est la prochaine chose à déplacer.
- Les réponses directes (une phrase faite, sans modèle). Candidate la plus nette : la météo, 7 à 23 s aujourd'hui, dont 3,5 à 20 s d'écriture, alors que l'outil a déjà les chiffres.

## 6. Propositions, non appliquées

1. **Mettre les équipes Mémoire et Code sur le modèle de la carte** (Réglages → Chef d'orchestre). Mesuré au banc, sans toucher à tes réglages :

   | | aujourd'hui (processeur) | sur `qwen2.5:7b` (carte) |
   | --- | --- | --- |
   | Mémoire, première demande | 62 s | 5,6 s |
   | Mémoire, deuxième demande | 33 s | 4,2 s |
   | Code, première question | 48 s | 3,4 s |
   | Code, deuxième question | 3 à 14 s | 2,4 s |

   À toi de voir pour le code : la réponse viendrait du modèle général, plus de `jarvis-coder`.
2. **Libérer la carte graphique.** Beaucoup de programmes ouverts s'en servent (lanceurs de jeux, messageries, trancheur 3D). Avec 1,7 Go de plus, `qwen2.5:7b` tiendrait entier sur la carte et écrirait plus vite. Non mesuré.
3. **Trois demandes du banc sont parties à tort sur Internet** dans sa première version : une salutation avec « aujourd'hui », et deux questions sur le PC avec « en ce moment ». Ce sont des règles express déjà en place. Je ne les ai pas touchées : à corriger avec la carte de l'utilisation.
4. **« Quels processus utilisent le plus de mémoire ? »** : l'outil met 4,6 s et la réponse parle d'une « erreur technique », dans tous les passages, avant comme après. À vérifier dans la vraie appli.

## 7. Essais à faire dans Jarvis Test

Avec cette branche lancée, Jarvis Test installé fermé (dans PowerShell : `$env:JARVIS_EDITION='test'; npm run dev`), ou après fusion dans `claude/dev`.

1. Démarrer, attendre dix secondes, taper « Explique-moi en deux phrases ce qu'est un trou noir ». Attendu : les premiers mots en une à deux secondes, pas en six ou sept.
2. Taper « Donne-moi les informations sur mon PC », puis une minute après « Quelle fenêtre est active sur mon PC ? ». Attendu : le vrai nom de la fenêtre (l'outil est appelé), et un début de réponse plus rapide la seconde fois.
3. Dire ou taper « Dis-moi, il est déjà tard là, non ? ». Attendu : la bonne heure dans la réponse.
4. Taper « Le cours de l'action Airbus » deux fois de suite. Attendu : la seconde réponse est immédiate, avec le même cours ; trois minutes plus tard, le cours est redemandé.
5. Faire dire une réponse à voix haute, puis lancer `scripts\vitesse.ps1` et m'envoyer `vitesse.md`. Attendu : une ligne « premier son » dans le tableau.

## 8. Ce que je n'ai pas pu vérifier

- **Rien n'a été essayé dans la fenêtre de Jarvis Test.** Le banc passe par la vraie session et le vrai Ollama, mais sans fenêtre ni voix.
- **Le chronomètre « voix »** (premier son de la fenêtre et de l'enceinte) est testé avec de faux sons seulement.
- **La prolongation des modèles** n'a pas été regardée sur 30 minutes.
- Les mesures viennent d'un seul PC, avec les programmes ouverts ce jour-là. Chaque passage complet a été fait une fois ; les cas décisifs (lecture, appels d'outils) six à huit fois.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npx electron-vite build ; banc de vitesse passé sur le vrai Ollama, 29 demandes, aucune en erreur)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : OK (cœur 229 fichiers, 2621 tests ; bureau 171 fichiers, 861 tests, 8 ignorés par leur propre condition ; aucun __golden__ régénéré ; chat-unchanged, ollama-unchanged, orchestra-session, machineProfile inchangés et verts)
Secrets   : OK (aucune clé, aucun nom de réseau ; les rapports du banc ne contiennent que des durées, des comptes et des noms d'équipe, de modèle et d'outil ; aucune phrase de l'utilisateur)
Fichiers modifiés : cœur vitesse/ (chrono, resume, banc, chauds, promptTail), tools/resultMemory.ts, tools/manager.ts, agent/expressRules.ts, agent/orchestra.ts (une ligne), agent/agent.ts (une option), edition.ts (trois champs de Test), types.ts, speech/types.ts ; bureau session.ts, turnJournal.ts, index.ts, vitesse/ (voix, chauds, usage, banc), images/ImagesService.ts (isBusy), preload, ipc, voix de la fenêtre (premier son) ; scripts/vitesse.ps1 ; tests ; CLAUDE.md, coordination, ce rapport
Prêt à fusionner : NON (dans claude/dev seulement, après les essais de 5.1.0-test.1 et ceux de la section 7)
À corriger : rien de connu
Testé en vrai (à la voix, sur le PC) : PAS FAIT (banc sans fenêtre ni voix ; utilisateur absent)
```
