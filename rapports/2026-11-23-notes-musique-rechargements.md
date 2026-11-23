# Notes et musique sans modèle ; rechargements des modèles — 23 novembre 2026

Suite de la tâche 1 sexies (`rapports/2026-11-23-ameliorer-essai.md`, défauts 2 et 3, et le constat « le temps part dans le chargement des modèles »). Branche `claude/idees-openjarvis` (partie de `claude/dev`), Jarvis Test seulement. Rien sur `main`, rien de publié.

Toutes les phrases d'essai sont écrites pour ce travail ; aucune ne vient des conversations de l'utilisateur.

## 1. Récupération et contrôles

`claude/idees-openjarvis` mise à jour (commit `9eb30e3` de Claude, le chat : arrêt net du script `ameliorer` quand aucune conversation n'est lue ; règle `mon-pc` qui exclut vidéo, YouTube et chanson). Contrôles officiels avant mes changements : `npm run typecheck` et `npm run lint` verts, cœur 2 707 sur 2 707. Bureau : un échec, `fallbackMission.test.ts` (mission Pong), pendant que je reconstruisais le cœur à côté ; repassé ensuite (section 6).

## 2. Défaut 2 : « Note dans ma liste de … »

**Cause, plus grave que prévu** : avec le chef d'orchestre, **aucune équipe n'a les outils des notes** (`note_ajouter`… ne sont que dans le catalogue du chat sans orchestre). La liste ne marche que par la règle sans modèle `noteIntent`, qui ne connaissait que « note : … », « ajoute à ma liste … » et « rajoute à ma liste … ». Toute autre forme partait à une équipe qui ne pouvait rien noter, et qui répondait quand même « Bien noté ».

Corrections :

- **`noteIntent`** (`packages/core/src/quotidien/notes.ts`) prend aussi :
  - « note / inscris / écris / mets / ajoute / rajoute / marque **dans / sur / à** ma liste (de courses) ou mes notes … » ;
  - « ajoute / mets … **à / sur / dans** ma liste ».

  Le contenu est nettoyé (« de racheter des piles » → « racheter des piles », « que je dois… » → « je dois… », « s'il te plaît » retiré ; « de la farine » gardé tel quel). Elle écarte une liste de lecture ou de diffusion, une playlist, et « ce morceau / cette chanson… à ma liste ». Effet de bord utile : « ajoute à ma liste de courses du lait » donnait le contenu « de courses du lait » ; il donne « du lait ».
- **Garde avant le modèle** (`session.ts`, `looksLikeNoteRequest`) : une phrase qui parle d'écrire dans la liste ou les notes, mais que la règle n'a pas su lire, ne part jamais à un modèle sans outil de notes (chef d'orchestre actif, ou liste coupée). Réponses fixes :
  - liste coupée : « Je n'ai rien noté : la liste n'est pas activée. Tu peux l'activer dans Réglages, Moi, Notes. » ;
  - contenu illisible : « Je n'ai rien noté : je n'ai pas compris quoi écrire. Dis par exemple « ajoute du pain à ma liste ». »
- **Jamais « Bien noté » sans outil** (`claimsSomethingNoted`) : quand un modèle a écrit la réponse et qu'**aucun outil n'a réussi** pendant le tour, une réponse qui dit « Bien noté », « C'est noté », « je l'ai ajouté à ta liste »… reçoit tout de suite, à l'écran, à la voix et dans l'historique : « Correction : je n'ai rien noté, aucun outil n'a rien écrit pendant ce tour… ». Cela vaut pour toutes les équipes, et pour le chat sans orchestre.

## 3. Défaut 3 : « Mets de la musique (sur mon PC / sur l'enceinte) »

Constat : « Mets de la musique » lançait `spotify_play` avec la requête « musique », donc une **recherche du mot « musique »**. « … sur mon PC » n'était pas vu comme de la musique (« pc » l'écartait) et partait au cerveau. Enfin, « mets la musique » allait **au modèle** de l'équipe Musique : rien ne forçait Spotify.

Correction (`genericMusicRequest`, `media/playIntent.ts`) : « mets / lance / joue / démarre (moi) (de la / la / un peu de / ma) musique », suivi ou non de « sur mon PC / l'ordinateur / l'enceinte / la <nom> », avec ou sans « s'il te plaît ».
- L'équipe Musique est choisie en express, sans cerveau.
- L'agent appelle `spotify_resume` sans modèle, avec la cible dite.
- `spotify_resume` passe cette cible à `play()`, qui prend l'appareil (PC, enceinte ou appareil nommé), y transfère la lecture, reprend et vérifie que ça joue.
- « Mets de la musique classique », « mets du jazz » restent des recherches ; « … sur YouTube » n'est pas pris par cette règle.

**À savoir** : cette reprise ne pose pas la question « Sur la Devialet ou sur le PC ? » (`spotifyAskDevice`, actif dans Jarvis Test). Sans cible dite, elle reprend sur l'appareil habituel. La question reste pour un morceau nommé.

**Vu, non corrigé (existait avant)** : « Mets la musique plus fort » lance une recherche « la musique plus fort » au lieu de monter le volume.

## 4. Essais

- Cœur : `quotidien/notes-liste-1123.test.ts` (formes prises et écartées, garde, réponses qui prétendent avoir noté), `media/musique-generique-1123.test.ts` (cibles, et ce qui reste une recherche).
- Bureau, vraie session : `notes-musique-session-1123.test.ts` (9 essais) :
  - note prise sans modèle ;
  - liste coupée, avec et sans chef d'orchestre ;
  - contenu illisible ;
  - « Bien noté » corrigé à l'écran et dans l'historique, et réponse normale non touchée ;
  - trois phrases de musique : express, `spotify_resume`, aucun appel de modèle.
- Pas essayé dans la fenêtre de Jarvis Test, ni avec le vrai Spotify, ni à la voix.

## 5. Vitesse : quels modèles sont rechargés, quand, pourquoi (mesure, rien changé)

Sources, lues sans rien modifier :
- les journaux du serveur Ollama, du 13 au 23 novembre : chaque démarrage de modèle, avec ses options et les évictions qui le précèdent ;
- le journal du tour des conversations de Jarvis Test ;
- un relevé de 6 minutes des processus qui se connectent à Ollama ;
- une mesure des modèles d'équipe sur le processeur.

Rappel : **Live et Test partagent le même Ollama** et la même carte de 6 Go. Le 7B du cerveau y prend 4,8 Go avec son contexte de 8 192 : plus rien d'autre ne tient à côté.

| Modèle (contexte, place) | Chargements | Après une éviction | Démarrage médian (max) |
| --- | ---: | ---: | --- |
| `qwen2.5:7b` (8 192, carte) | 51 | 15 | 3,8 s (15,1 s) |
| `qwen2.5:1.5b` (4 096, carte) | 28 | 22 | 1,5 s (6,1 s) |
| `qwen3.5:4b` (8 192, processeur) | 15 | 0 | 4,0 s (22,6 s) |
| `qwen2.5:7b` (4 096, carte) | 10 | 4 | 3,5 s (12,8 s) |
| `jarvis-coder` (8 192, processeur) | 10 | 0 | 4,8 s (16,5 s) |
| `qwen2.5:3b` (8 192, processeur) | 7 | 0 | 6,5 s (13,3 s) |
| `jarvis-coder` (8 192, carte) | 2 | 2 | 14,3 s |
| `qwen3.5:4b` (8 192, carte) | 1 | 1 | 10,0 s |

130 chargements en tout, dont 44 après une éviction. Le 7B a été rechargé 51 fois, dont 12 à froid (plus de 10 s).

### Trois causes

1. **La suite de tests évince le 7B** (cause n° 1 en nombre).
   - Le test « appelle le modèle réel, ou dit que la série est bloquée » (`packages/core/src/developer/lab.test.ts`) tourne à **chaque `npm test`**. Il charge `qwen2.5:1.5b` sur la carte, ce qui évince le 7B.
   - Preuve : les chargements du 1.5b d'aujourd'hui (11:33, 11:46, 12:15, 12:24) tombent pendant mes lancements de `npm test`. À 12:24:25, c'est un processus `node` qui se connecte à Ollama, puis le 1.5b démarre.
   - Sur 10 jours : 28 chargements du 1.5b, dont 22 qui évincent le 7B. 16 sont suivis d'un rechargement du 7B dans l'heure, payé par le tour suivant de Live ou de Test (3,5 s si le fichier est encore en cache, jusqu'à 15 s sinon).
   - Son voisin de `labJournal.test.ts` n'est lancé qu'avec `JARVIS_LAB_BATCH=1`.
2. **Jarvis Test met les équipes Mémoire et Code sur la carte** (Live les met sur le processeur).
   - La carte ne peut pas tenir le 7B à côté : chaque tour Mémoire ou Code évince le cerveau, et le tour suivant le recharge.
   - Dans le journal du tour de Test, 4 tours sur 37 ont attendu un chargement, pour **48 s en tout**. Mémoire : 12,1 s ; Code : 5,1 + 5,5 s, puis 3,6 + 16,3 s ; le tour PC qui suit : 5,7 s.
3. **Le 7B avec un contexte de 4 096** : 10 chargements. Chaque fois, le retour à 8 192 recharge le 7B. Cause trouvée ensuite, voir la section 7 : trois appels de Jarvis qui ne précisaient pas le contexte.

### Vitesse mesurée des modèles d'équipe

| Modèle | Où | Écriture | Lecture de la consigne | Démarrage à froid |
| --- | --- | ---: | ---: | ---: |
| `qwen2.5:7b` (cerveau, équipe PC) | carte | 18,5 jetons/s | ~2 000 jetons/s | 3,5 à 15 s, une fois |
| `qwen3.5:4b` (Mémoire) | carte | 67 jetons/s | ~1 900 jetons/s | 10 s, et évince le 7B |
| `qwen3.5:4b` | processeur | 5,2 jetons/s | 114 jetons/s | 15,5 s |
| `jarvis-coder` (Code) | carte | 19 jetons/s | ~1 150 jetons/s | 14 s, et évince le 7B |
| `jarvis-coder` | processeur | 3,9 jetons/s | 188 jetons/s | 17,8 s |
| `qwen2.5:3b` (Musique) | processeur | 8 jetons/s | ~430 jetons/s | 3,4 s (13 s ce matin) |

Le processeur ne sauve rien : une consigne d'équipe d'environ 1 500 jetons s'y lit en 8 à 13 s.

### Proposition chiffrée (à décider, rien n'est changé)

| # | Changement | Gain attendu | Coût, risque |
| --- | --- | --- | --- |
| P1 | Ne lancer le test du vrai modèle de `lab.test.ts` que sur demande (`JARVIS_LAB_REAL=1`), comme celui de `labJournal.test.ts` | Plus aucune éviction par les tests : 22 évictions en 10 jours, 16 rechargements du 7B (3,5 à 15 s chacun) payés par Live ou Test | Aucun pour toi ; le test ne tourne plus tout seul |
| P2 | Dans Jarvis Test, équipe **Mémoire** sur le 7B du cerveau | Plus de chargement : 12,1 s de moins sur ces tours, et 3,5 à 15 s de moins sur le tour suivant | Écriture moins rapide (18,5 contre 67 jetons/s) : environ 2 s de plus pour 50 jetons. Qualité avec les outils de mémoire à vérifier au banc avant |
| P3 | Dans Jarvis Test, équipe **Code** sur le 7B du cerveau | Plus de chargement : 5 à 16 s de moins sur ces tours, et le rechargement du cerveau ensuite | Même vitesse d'écriture (18,5 contre 19). Qualité : `jarvis-coder` est un 3B entraîné ; à comparer au banc |
| P4 | Équipe **Musique** sur le 7B | 3 à 13 s de démarrage en moins, écriture 2 fois plus rapide | Faible : la plupart des phrases de musique passent maintenant sans modèle |

Avec P1 à P4, un seul modèle reste sur la carte : le 7B, déjà gardé chaud. Les chargements de Jarvis Test tombent à zéro, sauf au premier tour de la journée.

Recommandation : P1 tout de suite ; P2 et P3 après un passage du banc avec ces équipes sur le 7B (et `banc:outils-pc` si une consigne change) ; P4 en même temps, au choix.

À ne pas faire : toucher aux variables du serveur Ollama (règle de Jarvis), ou baisser le contexte du 7B (les consignes et les outils de l'équipe PC en ont besoin).

## 7. Options alignées (Jarvis Test)

Ollama recharge un modèle déjà en mémoire dès qu'on l'appelle avec un autre `num_ctx` ou `num_gpu`.

**Relevé des appels au 7B.** Le tri du cerveau, le trieur, la vérification « c'est à Jarvis ? », les équipes et les modèles gardés chauds envoient tous `num_ctx 8192`, et `num_gpu 0` seulement sur le processeur. Le bilan de santé n'appelle aucun modèle. Trois appels n'envoyaient **aucune option**, et Ollama prenait son défaut, 4 096 :

1. **le préchauffage des enceintes** (`speaker/warmup.ts`, `warmupRun.ts`) : à chaque réveil d'une enceinte, au plus une fois toutes les 10 s. Avec « Garder Jarvis éveillé », il garde ce 7B en 4 096 indéfiniment ;
2. **le rechargement du modèle après une image, et le déchargement avant** (`images/OllamaControl.ts`) ;
3. **la reformulation d'Imager** (`images/PromptRefiner.ts`).

Le 20 novembre à 10:27, un `/api/generate` de 5,9 s (le préchauffage) précède bien un 7B en 4 096.

**Correction, Jarvis Test seulement** (champ d'édition `alignOllamaOptions`, absent de Live) :
- `ollamaLoadOptions(réglages, modèle)` (`packages/core/src/vitesse/options.ts`) rend les options que la session enverrait pour ce modèle : 8 192, et `num_gpu 0` si son équipe ou le trieur est sur le processeur. Sans chef d'orchestre, ce sont celles du chat (profil de la machine).
- Les trois appels s'en servent.
- Live envoie les mêmes requêtes qu'avant.

**Nouvelle mesure** (vrai Ollama, réglages de Jarvis Test lus seulement). Une demande du chat, puis le préchauffage d'enceinte tel que Jarvis Test le construit, puis une nouvelle demande du chat :

| | Préchauffage | Demande suivante du chat | Démarrages du 7B (journal d'Ollama) |
| --- | ---: | ---: | ---: |
| Avant (sans options) | 5,8 s | 6,2 s | 2 (4 096, puis 8 192) |
| Après (options alignées) | 0,01 s | 0,28 s | 0 |

**Gain** : environ 6 s sur la réponse **de chaque phrase dite à une enceinte** quand le 7B était déjà prêt, et 5,8 s de carte occupée en moins au réveil. Autour d'une image : un rechargement en moins avant, et un après.

**Live a le même défaut** (`speakerWarmup` et « Garder Jarvis éveillé » y sont actifs) : à porter dans une Live sur ta décision.

**Vu en passant** : le lint officiel compte 71 erreurs dans `.claude/worktrees/atelier`, une copie de travail **verrouillée** de `claude/atelier-3d` créée à 12:21 par une autre session. Je n'y ai pas touché. Sans ce dossier, le lint est vert.

## 8. P1 fait ; P2 et P3 passés au banc (23 novembre, après-midi)

**P1 fait** : le test du vrai modèle de `lab.test.ts` ne tourne plus que sur demande (`JARVIS_LAB_REAL=1`). Vérifié : passage de `lab.test.ts` sans aucun chargement dans le journal d'Ollama. Le contrôle de style ignore aussi `.claude/worktrees/` (dans `eslint.config.js` et `.gitignore`, sur cette branche et sur celle de la Live).

**Banc de vitesse** (`npm run banc:vitesse`) : 29 demandes types, vraie session, réglages de Jarvis Test (lus seulement), vrai Ollama, départ à froid. Quatre passages en alternance :
- « actuel » : Mémoire `qwen3.5:4b` et Code `jarvis-coder` sur la carte ;
- « 7B » : `JARVIS_BANC_EQUIPES=memoire=qwen2.5:7b@carte,code=qwen2.5:7b@carte`.

Résultats : `C:\dev\jarvis-dataitesseanc\p2p3-*.json`.

| | actuel 1 | actuel 2 | 7B 1 | 7B 2 |
| --- | ---: | ---: | ---: | ---: |
| Temps de chargement en tout | 36,9 s | 36,9 s | 0,3 s | 0,3 s |
| Tours qui attendent un chargement | 7 | 7 | 0 | 0 |
| Durée totale des 29 demandes | 242 s | 269 s | 231 s | 255 s |

La durée totale varie surtout avec les recherches sur Internet (d'un passage à l'autre, ± 25 s) ; les chargements, eux, disparaissent.

Les tours concernés (durée du tour, dont chargement) :

| Demande | Équipe | actuel | 7B |
| --- | --- | --- | --- |
| g1 mémoire, projets | Mémoire | 8,3 s (5,1) / 7,8 s (4,8) | 4,3 s / 4,0 s |
| c3 fenêtre active (après g1) | PC | 20,4 s (5,5) / 20,0 s (5,7) | 13,0 s / 14,5 s |
| i1 code, inverser une chaîne | Code | 8,3 s (5,5) / 8,3 s (5,5) | 3,2 s / 3,2 s |
| j1 résumé (après i1) | Conversation | 10,6 s (5,2) / 10,2 s (5,3) | 3,6 s / 2,8 s |
| i2 code, majuscules | Code | 7,3 s (5,5) / 8,0 s (5,5) | 2,4 s / 2,4 s |
| g2 mémoire, voiture | Mémoire | 6,9 s (4,7) / 6,9 s (4,7) | 4,1 s / 3,8 s |
| m1 recherche (après g2) | Internet | 11,9 s (5,2) / 13,8 s (5,3) | 6,9 s / 7,1 s |

**Qualité** :
- Mémoire : `search_jarvis_memory` est appelé à chaque demande dans les quatre passages. Avec `qwen3.5:4b`, le premier appel de g1 échoue (mauvais arguments) puis le second réussit, dans les deux passages ; avec le 7B, il réussit du premier coup. Les réponses disent la même chose. **Limite** : le banc part d'une mémoire vide, il mesure l'appel de l'outil, pas la qualité d'un vrai souvenir retrouvé.
- Code : réponses justes des deux côtés (`chaine[::-1]`, `.upper()`). Le 7B ajoute une phrase d'explication. **Limite** : deux questions courtes ; une explication longue ou un vrai programme n'est pas mesuré ici.

**Conclusion** : P2 et P3 retirent environ 5 s sur chaque tour Mémoire ou Code, et autant sur le tour qui suit, sans perte vue au banc. Le changement se fait dans les réglages de Jarvis Test (Réglages, Le cerveau de Jarvis, Chef d'orchestre : Mémoire et Code sur `qwen2.5:7b`, carte). Je ne l'ai pas fait : ce sont tes réglages.

## 6. Vérification

RAPPORT DE VÉRIFICATION

- Construction : FAIT (cœur construit).
- Types (`npm run typecheck`) : FAIT, vert.
- Style (`npm run lint`) : FAIT, vert sur cette branche (71 erreurs dans la copie de travail `.claude/worktrees/atelier` d'une autre session, hors de ce travail).
- Tests : FAIT. Après l'alignement des options : cœur 2 752 sur 2 752, bureau 904 sur 904 (8 ignorés), suite complète au repos. Avant :
  cœur 2 747 sur 2 747. Bureau :
  - pendant ma mesure sur le processeur, 5 essais ont dépassé leur délai de 5 s ;
  - repassés seuls, machine au repos, ils sont tous verts (33 sur 33) ;
  - suite complète au repos : 898 sur 900 (8 ignorés), les 2 restants dans `sandbox.test.ts` (délai git sous charge), verts au passage suivant.
  Ces délais de 5 s sous charge viennent de l'existant, pas de ce travail.
- Secrets : FAIT (aucun).
- Relecture : FAIT.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT. Notes et musique essayées par la vraie session en test (modèle simulé), pas dans la fenêtre de Jarvis Test ni avec le vrai Spotify.
