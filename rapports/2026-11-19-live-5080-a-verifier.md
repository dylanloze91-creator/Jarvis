# Live 5.0.80 : essais à faire avec toi (préparée le 19 novembre 2026)

Branche `claude/live-5080`, partie de `main` (5.0.79), préparée par Claude Code sur le PC Windows. **Rien n'est fusionné dans `main`, rien n'est publié. Jarvis Live installé n'a pas été touché ; ses données ont été lues seulement, par copie temporaire.** J'attends ton « publie ».

## 1. Ce que contient la 5.0.80

Seulement les corrections essayées d'abord dans Jarvis Test (`rapports/2026-11-19-corrections-5080.md`), rien d'autre de Test :

- **Mémoire apprise** : une phrase en « non » sans rien à retenir attend ton accord au lieu de devenir une règle ; les petits mots ne comptent plus au rappel ; l'en-tête ne dit plus de ne pas appeler d'outil.
- **Règle express sans modèle** : « les informations sur mon PC » appelle `get_system_info` directement. Le fichier `packages/core/src/agent/expressRules.ts` arrive dans la Live avec cette seule règle.
- **Outils** : pause de Spotify sans lecture en cours, `list_processes`, lien YouTube inventé par le modèle.
- Version **5.0.80** : `package.json` (racine et bureau), `package-lock.json`. Le programme de l'enceinte ne change pas : il garde l'étiquette 5.0.79, **rien à flasher**.

Non repris de Test : le chronomètre, les modèles gardés chauds, la mémoire courte des outils, le carnet, le lot B, le socle des appendices.

## 2. Ce qui est déjà vérifié sans toi

Banc des outils du PC sur ce code, avec **tes vraies données de Live** (personnalisation et mémoire apprise, copie temporaire), 10 passages. Bon outil appelé :

| | Bloc-notes | Infos du PC | Fenêtre active | Bloc-notes, neuve | Infos du PC, neuve | Fenêtre, neuve |
| --- | --- | --- | --- | --- | --- | --- |
| Live 5.0.79 (avant) | 10 | 10 | 10 | 10 | 9 | **0** |
| Live 5.0.80 (ce code) | 10 | 10 | 10 | 10 | 10 | **10** |

Contrôles : types, style, tests (cœur 217 fichiers, 2 534 tests ; bureau 161 fichiers, 841 tests, 8 ignorés par leur propre condition), construction, installateur. Aucun `__golden__` régénéré.

## 3. Comment l'essayer

Deux façons, au choix :

- **Sans l'installer** (conseillé d'abord) : quitter Jarvis Live (icône près de l'horloge → Quitter), puis `npm run dev` depuis cette branche. Elle utilise les mêmes données que la Live : mêmes réglages, mêmes enceintes, même mémoire.
- **En l'installant** : `apps/desktop/release/Jarvis-Setup-5.0.80.exe` remplace la 5.0.79. Pour revenir en arrière : réinstaller `Jarvis-Setup-5.0.79.exe` depuis la release GitHub `v5.0.79`. Tes données ne bougent pas.

## 4. Les essais

### A. Le défaut de la fenêtre active

| # | Essai | Attendu |
| --- | --- | --- |
| E1 | Nouvelle discussion, première phrase : « Quelle fenêtre est active ? » | le vrai nom de la fenêtre, avec la bulle de l'outil. Avant : une fenêtre inventée, 10 fois sur 10 |
| E2 | Même chose à l'enceinte : « Jarvis, quelle fenêtre est active sur mon PC ? » | le vrai nom |

### B. Les informations du PC, sans modèle

| # | Essai | Attendu |
| --- | --- | --- |
| E3 | Nouvelle discussion : « Donne-moi les informations sur mon PC » | réponse immédiate, « Voici les informations du PC : » puis la liste (système, processeur, mémoire, disque) ; pastille « PC · sans modèle · express » ; la bulle de l'outil est là |
| E4 | Juste après, dans la même discussion : « Quelle fenêtre est active ? » | le vrai nom de la fenêtre (l'outil est appelé) |
| E5 | « Pourquoi mon PC est lent en ce moment ? » | c'est le modèle qui répond, pas la liste toute faite |
| E6 | À l'enceinte : « Jarvis, donne-moi les informations sur mon PC » | Jarvis lit le début, puis dit que le détail est sur le PC. À me dire si c'est trop long à l'oreille |

### C. La mémoire apprise

| # | Essai | Attendu |
| --- | --- | --- |
| E7 | Poser une question à laquelle Jarvis répond par une question, puis répondre « Non merci, pas maintenant » | dans Réglages → Moi → Mémoire documentaire → « Fiches récentes » : la phrase est notée « candidate », avec « Valider » et « Rejeter ». Elle n'est pas une règle |
| E8 | Dire une vraie correction : « Non, la capitale de l'Australie est Canberra » | la fiche est « validated » |
| E9 | Dans « Fiches récentes », regarder les anciennes fiches en « non » | elles sont encore là (je n'ai rien modifié). Tu peux les rejeter ; même sans le faire, elles ne sont plus rappelées |

### D. Les outils corrigés

| # | Essai | Attendu |
| --- | --- | --- |
| E10 | Sans musique en cours : « Stop la musique » | « Rien n'était en lecture sur Spotify : il n'y a rien à mettre en pause. » Avant : une erreur 404 en anglais |
| E11 | Avec de la musique : « pause », « reprends », « morceau précédent » | chaque ordre est fait |
| E12 | « Liste les processus qui prennent le plus de mémoire » | une vraie liste. Avant : l'outil échouait à chaque fois sur ce PC |
| E13 | « Résume-moi cette vidéo YouTube », sans donner de lien | Jarvis demande le lien. Il ne doit pas en inventer un. Si le modèle en invente quand même un, l'outil lui répond de te le demander : me dire ce que Jarvis dit alors |

### E. Rien d'autre n'a bougé

| # | Essai | Attendu |
| --- | --- | --- |
| E14 | « Quelle heure est-il ? », « Le cours de l'action Airbus », « Combien font 12 fois 37 ? » | comme avant, sans modèle |
| E15 | Une question à l'enceinte, et Ctrl+Espace | comme avant |

### F. Options Ollama alignées (ajout du 23 novembre)

Le préchauffage des enceintes, le déchargement / rechargement d'Imager et sa reformulation envoient maintenant les mêmes `num_ctx` / `num_gpu` que le chat. Avant, Ollama prenait 4 096 et rechargeait le 7B deux fois (5,8 s, puis 6,2 s sur la réponse). Rapport : `rapports/2026-11-23-live-5080-options-ollama.md`.

| # | Essai | Attendu |
| --- | --- | --- |
| E16 | Une question dans la fenêtre, puis tout de suite « Jarvis, quelle heure est-il ? » à l'enceinte, puis « Jarvis, raconte-moi une blague courte » à l'enceinte | la blague arrive sans attente de rechargement (pas de « trou » de 5 à 6 s de plus que d'habitude) |
| E17 | Une image (« génère une image d'un vélo rouge »), puis une question dans la fenêtre | la question répond sans second rechargement du modèle après celui qui suit l'image |

Contrôle sans rien lancer : dans `%LOCALAPPDATA%\Ollama\server.log`, aucune ligne `starting llama-server` avec `-c 4096` pour le 7B pendant ces essais.

## 5. Ce que je n'ai pas pu vérifier

- Rien n'a été essayé dans la fenêtre ni à la voix : le banc passe par la vraie session et le vrai Ollama, sans fenêtre.
- L'installateur est construit, pas installé.
- `generer_image` : les ratés du 12 novembre viennent du démarrage de Forge (113 s au repos, plus de 4 minutes un soir chargé). Non corrigé : à décider.
- Gmail : la connexion Google expire au bout de 7 jours en mode « Test ». Rien à corriger dans Jarvis.

## 6. Pour publier

Quand tu as essayé et que tu dis « publie » : fusion de `claude/live-5080` dans `main`, puis `bash release.sh` depuis `main`. Les corrections sont déjà dans `claude/dev` (Jarvis Test).

## 7. Essais faits par Claude Code le 20 novembre 2026

À ta demande, pendant ton absence. Jarvis Live arrêté, la branche `claude/live-5080` lancée sans rien installer (`electron-vite dev`), avec tes vraies données. Phrases tapées dans la vraie fenêtre (pilotée par le port de débogage), réponses, bulles d'outil et pastilles relues à l'écran. Enceinte : phrases en voix de synthèse Windows, envoyées au pont par `apps/desktop/scripts/fake-speaker.mjs` avec une enceinte d'essai temporaire. **Rien n'est publié.**

Avant : copie de sécurité des données de Live (488 fichiers, 68 Mo, sans les caches) dans `C:\dev\jarvis-data\sauvegardes\live-avant-essais-5080-2026-11-20`. Après : Jarvis Live 5.0.79 relancé, pont des enceintes de nouveau ouvert.

| # | Résultat | Ce que Jarvis a répondu |
| --- | --- | --- |
| E1 | **réussi** | pastille « PC et applications · qwen2.5:7b · choisi par le cerveau », bulle « Fenêtre active · terminé », puis le vrai nom de la fenêtre active (Jarvis) et quelques applications ouvertes. Rejoué 3 fois avec la phrase de l'enceinte tapée au clavier : 3 sur 3 |
| E2 | **raté 4 fois sur 6** | à la fausse enceinte, discussion neuve à chaque fois. 4 fois : « Je vais vérifier cela pour vous, [prénom]. » suivi du nom de l'outil écrit entre accolades, sans l'appeler (4 s de voix, 6 à 8,5 s d'attente). 2 fois : l'outil est appelé, « La fenêtre active est celle de Jarvis… » (10 s de voix, 9 s d'attente). Voir « Ce qui coince », point 1 |
| E3 | **réussi** | réponse en 0,5 s, pastille « PC et applications · sans modèle · express », bulle « État du PC · terminé », « Voici les informations du PC : » puis système, machine, processeur, mémoire, disque, temps depuis le démarrage |
| E4 | **réussi** | bulle « Fenêtre active · terminé », « La fenêtre active est celle de Jarvis. » puis la liste des fenêtres ouvertes (18 s) |
| E5 | **réussi pour l'attendu, avec un défaut** | ce n'est pas la liste toute faite. Mais la demande part à l'équipe Internet (pastille « Internet · express », à cause de « en ce moment ») et le modèle écrit « j'effectue une recherche rapide » puis un appel d'outil en texte, sans le faire. Pas lié à la 5.0.80 (règle d'actualité inchangée). Point 4 |
| E6 | **réussi, à écouter** | réponse en 5,6 s, 11,8 s de voix. Enregistrée pour toi : `C:\dev\jarvis-data\essais-5080\reponse-E6.wav`. Le texte de la discussion est la liste complète |
| E7 | **réussi** | Jarvis demande le lien de la vidéo ; « Non merci, pas maintenant » est rangée « candidate » (lu par la même lecture que l'écran « Fiches récentes »). Fiche retirée après l'essai |
| E8 | **réussi, avec un défaut trouvé** | la correction est « validated ». Mais elle a fait passer une de tes anciennes fiches de « validated » à « rejected », sans rapport avec elle (point 2). Fiche d'essai retirée, ta fiche remise dans son état d'avant à partir de la copie de sécurité |
| E9 | **réussi** | les anciennes fiches en « non » sont toujours là (4 rejetées, 2 validées), aucune modifiée au final |
| E10 | **réussi** | « Rien n'était en lecture sur Spotify : il n'y a rien à mettre en pause. », en 0,5 s |
| E11 | **pause et reprise réussies, « morceau précédent » raté** | sur le PC, volume de Windows à 8 % le temps de l'essai puis remis. « pause » : « Spotify est en pause. » ; « reprends » : « Lecture Spotify reprise. » ; « morceau précédent » : Spotify refuse (erreur 403 « Restriction violated »), et le modèle dit une fois « je ne peux pas… avec le niveau d'accès actuel », une fois l'erreur en anglais. Points 3 |
| E12 | **réussi** | bulle « Processus en cours · terminé », une vraie liste de cinq processus avec leur mémoire (15 s) |
| E13 | **réussi** | « Pour résumer la vidéo, j'ai besoin de l'URL de celle-ci. Pouvez-vous me la fournir, s'il vous plaît ? » Aucun lien inventé (2 essais) |
| E14 | **réussi** | « Il est 10 h 05. » (Horloge · sans modèle) ; le cours d'Airbus à Paris avec la variation du jour (Bourse · express) ; « 12 × 37 = 444. » (Calcul · calcul exact) |
| E15 | **réussi** | à la fausse enceinte : « La capitale de l'Italie est Rome. » en 7,3 s ; Ctrl+Espace cache la fenêtre puis la ramène |

### Ce qui coince

1. **À la voix, « quelle fenêtre est active » rate encore 4 fois sur 6.** Dans la fenêtre au clavier, c'est bon (4 sur 4). À l'enceinte, le modèle dit sa phrase de majordome puis écrit le nom de l'outil au lieu de l'appeler. Ce qui change à la voix : la note « transcription vocale » et la consigne « réponds comme on parle » s'ajoutent aux consignes. Le banc des outils du PC ne passe jamais par la voix : il ne pouvait pas le voir, ni sur la 5.0.79 ni sur la 5.0.80. La correction de la mémoire apprise est bonne, mais elle ne suffit pas pour l'enceinte.
2. **Une correction rejette une fiche sans rapport** (`applyIncoming`, `continuous.ts`) : la règle « deux mots en commun = fiches qui se contredisent » compte encore les petits mots (« non », « la », « est »). Le rappel a été corrigé pour la 5.0.80, pas cette règle.
3. **Spotify** : (a) Jarvis lance toujours un seul morceau, même pour « l'album … » ; Spotify refuse alors « précédent », et « suivant » arrête la lecture alors que l'outil répond « Morceau suivant. » sans vérifier ; (b) « pause » quand c'est déjà en pause affiche l'erreur 403 en anglais ; (c) « morceau suivant » et « morceau précédent » passent par le petit modèle sur le processeur : 17 à 33 s d'attente.
4. **« Pourquoi mon PC est lent en ce moment ? »** part sur Internet et annonce une recherche sans la faire.
5. Le caractère « majordome » vouvoie et ajoute des phrases (« Vous travaillez actuellement… ») : à toi de dire si c'est voulu.

Mon avis : les points 1 à 3 sont des corrections, donc à leur place dans la 5.0.80, d'abord dans Jarvis Test avec un banc qui passe aussi par la voix. Je ne les ai pas faites : tu m'as demandé les essais.

### Deux essais que je te laisse

- **Une phrase à la vraie enceinte, avec ta voix** : « Jarvis, quelle fenêtre est active sur mon PC ? » (il faut d'abord lancer la 5.0.80, voir § 3).
- **Écouter la réponse E6** (`C:\dev\jarvis-data\essais-5080\reponse-E6.wav`) et me dire si c'est trop long à l'oreille. Les deux réponses de E2 sont à côté (`reponse-E2-ratee.wav`, `reponse-E2-reussie.wav`).

### Traces laissées par mes essais

- Dans l'historique de Jarvis : une douzaine de discussions d'essai (dont celles des enceintes « essai-claude »). Je ne les ai pas effacées.
- Les six enceintes d'essai sont retirées ; il ne reste que la tienne.
- `knowledge-index.json.avant-remise-2026-11-20` dans le dossier de données : l'index tel qu'il était juste avant que je remette ta fiche.

## 8. Forge : `insightface` réparé (20 novembre 2026, avec ton accord)

Hors de Jarvis : seul le dossier `C:\dev\Forge` a été touché, aucun fichier de Jarvis.

- **Cause** : à chaque démarrage, Forge lance `pip install insightface==0.7.3`. Cette version n'existe sur PyPI qu'en sources à compiler : l'installation échouait à chaque fois, après une longue attente.
- **Réparation** : la roue officielle `insightface 2.1` de PyPI (projet deepinsight, Python pur, rien à compiler) installée dans le venv de Forge, sans ses dépendances, comme le fait Forge. Aucun autre paquet du venv n'a changé (liste comparée avant et après). Forge voit le paquet et ne tente plus rien.
- **Mesure**, modèles d'Ollama déchargés comme le fait Jarvis, jusqu'à ce que l'API réponde : **51 s** au premier démarrage, **22 s** au second (113 s avant). Forge arrêté ensuite. Le délai de 4 minutes reste tel quel : plus besoin de passer à 6.
- **Limite** : Forge est écrit pour la 0.7.3. Les fonctions qui s'en servent (IP-Adapter FaceID, InstantID de ControlNet) n'ont pas été essayées avec la 2.1. Jarvis Imager ne les utilise pas. Aucune image n'a été générée pendant cet essai.
- **Pour revenir en arrière** : `C:\dev\Forge\venv\Scripts\python.exe -m pip uninstall insightface`.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npx electron-vite build ; installateur Jarvis-Setup-5.0.80.exe construit, non publié ; banc sur le vrai Ollama)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : OK (cœur 217 fichiers, 2534 tests ; bureau 161 fichiers, 841 tests, 8 ignorés par leur propre condition ; aucun __golden__ régénéré, les tests figés passent tels quels)
Secrets   : OK (aucune clé, aucune phrase de l'utilisateur, aucun souvenir)
Fichiers modifiés : learning/continuous.ts, agent/expressRules.ts (nouveau dans la Live), agent/orchestra.ts, youtube/url.ts, captions.ts, listen.ts, index.ts ; bureau session.ts, tools/spotify.ts, tools/processes.ts ; cinq fichiers d'essais ; versions ; CLAUDE.md, AGENTS-COORDINATION.md, rapports
Prêt à fusionner : NON, pas avant tes essais et ton « publie »
À corriger : § 7, « Ce qui coince » (fenêtre active à la voix, fiche rejetée à tort, Spotify)
Testé en vrai (à la voix, sur le PC) : FAIT par Claude Code le 20 novembre (fenêtre, fausse enceinte, Spotify sur le PC ; § 7). PAS FAIT avec ta voix sur la vraie enceinte
```

## 9. Essais avec toi, 23 novembre 2026

Branche `claude/corrections-5080-suite` lancée sans rien installer (`electron-vite dev`), Jarvis Live 5.0.79 arrêté, tes vraies données. Copie de sécurité avant : `C:\dev\jarvis-data\sauvegardes\live-avant-essais-5080-2026-11-23`. Phrases dites par toi à la vraie enceinte ; résultats lus dans le journal d'audit, l'historique et la mémoire.

| # | Résultat |
| --- | --- |
| E2 | **réussi** 3 sur 3 à ta voix, y compris quand Whisper a compris une phrase abîmée : « Fenêtre active : … » |
| E5 | **réussi** : plus d'Internet, Jarvis propose un diagnostic |
| E6 | **raté, grave** : Whisper a entendu « une information ou les informations sur mon PC ». L'empêchement « où » de la règle, une fois les accents retirés, prenait aussi « ou » : la phrase est partie au modèle, qui a **inventé** un processeur, une mémoire et un disque, sans outil |
| E8 | **réussi** : aucune autre fiche n'a changé (comparé à la copie de sécurité). La fiche est « candidate », pas « validated » : ta phrase répondait à une question de Jarvis, c'est la règle voulue |
| E11 | **raté** : (a) « mets pause sur Spotify », écrit « Mes pauses sur Spotify » par Whisper, a lancé un morceau (« … sur Spotify » = un titre ; même « Mets pause sur Spotify » bien transcrit cherchait « pause ») ; (b) « mets la playlist … » joue un morceau seul : Jarvis ne cherche que des morceaux ; (c) l'enceinte a lu « Lecture vérifiée : is_playing=true et URI confirmée. » |

### Corrigé le 23 novembre (avec ton accord)

1. **Règle « informations sur mon PC »** (`agent/expressRules.ts`) : l'empêchement « où » est remplacé par des questions de lieu (« où est », « où sont », « où se », « où trouver », « où voir », « par où », « d'où ») ; « ou » ne bloque plus. Deux phrases « pour » et une « contre » ajoutées.
2. **Pause** (`media/playIntent.ts`) : « mets pause », « mes pauses » (Whisper), « pause sur Spotify », « … la musique » mettent en pause sans modèle, jamais une recherche de morceau. Un vrai titre (« Pause Café de … ») reste un titre.
3. **Réponse de `spotify_play`** (`tools/spotify.ts`) : la phrase technique est retirée ; il reste « Lecture sur « … » : titre — artiste. ».

Essais : `packages/core/src/essais-5080-23nov.test.ts` (phrases écrites pour l'essai), assertion ajoutée dans `tools/spotify.test.ts`.

**Non corrigé, nouveauté à décider :** jouer une playlist ou un album (« mets la playlist … »). À faire d'abord dans Jarvis Test.

### Deuxième passage (23 novembre, 17 h)

- **E6 bon** : « Dis-moi les informations sur mon PC » → `get_system_info` sans modèle, vraies valeurs.
- **E11 pas bon** : « Mets pause sur Spotify » a bien mis en pause, sans modèle. Mais « Mets play sur Spotify » (écrit « Mes play » par Whisper) a lancé une recherche de morceau « Mes play » et la question de l'appareil. **Corrigé** : `RESUME_PHRASE` (`media/playIntent.ts`) accepte « play », « mets / remets / mes play », « mets en lecture », avec une fin « sur Spotify » ou « s'il te plaît » ; `isPlaybackControlOnly` et `isMusicIntent` la reconnaissent avant la recherche. « Mets Play Hard de David Guetta sur Spotify » reste un titre. Test : `essais-5080-23nov.test.ts`.
- **E16 fait** : heure sans modèle (« Il est 17 h 18. »), blague par le modèle.
- **E17 fait** : image en 266 s ; le 7B a été rechargé à 17 h 08 avec `-c 8192`, comme le chat : pas de rechargement en trop. Un `qwen2.5:1.5b` en `-c 4096` à 17 h 22 ne vient pas de la Live (aucun réglage ne le nomme ; même suite d'appels que le test du vrai modèle du labo, qui ne tourne plus sur cette branche sans `JARVIS_LAB_REAL=1`).
- Vu en passant, non corrigé : « Peux-tu augmenter le volume de l'enceinte ? » a reçu un refus du modèle alors que `spotify_set_volume` existe ; « Elle en est où, l'image ? » a reçu une réponse inventée (« en cours »).

### Troisième passage (23 novembre, 18 h 50)

- **E11 à moitié bon** : pause, morceau suivant (« Morses suivantes ») et morceau précédent bons, sans modèle. « Mets play sur Spotify » a été écrit « M'éplay » par Whisper et a lancé « Quarantine » de E-Play. **Corrigé** : devant « play », la règle accepte aussi « mes », « mais », « mé » et « m'é », collé ou non. Test : `essais-5080-23nov.test.ts`.
- Suite complète : `workflow.test.ts` (modèle de code) a échoué une fois sous la charge, puis 9 sur 9 seul ; sans rapport avec la correction.

### Quatrième passage (23 novembre, 19 h 20)

- **Play bof** : « pause sur Spotify » bon ; trois ratés venus de Whisper : « Mets sur pause, potifie » a lancé un morceau ; « Mais sur Play, sur Spotify » a été pris pour un titre ; « Mes play » dit pendant la question « Sur la Phantom… ou sur le PC ? » a reposé la question (réponse floue).
- **Corrigé** : `isSpotifyPausePhrase` / `isSpotifyResumePhrase` relisent aussi la phrase sans accents ni ponctuation, sans « Jarvis », « s'il te plaît », « la musique » ni « (sur) Spotify » même déformé (spotifie, potifie, spotifaille) ; il doit rester exactement « [mets|mes|mais|me|m] [sur|en] pause » ou « … play | lecture ». Pendant la question de l'appareil, pause, reprise, suivant et précédent passent avant la réponse attendue (`agent.ts`). Tests : `essais-5080-23nov.test.ts`, `agent.test.ts`.

### Cinquième passage (23 novembre, 19 h 50)

- **Toujours pas** : Whisper a écrit « Pose sur Spotify » (lancé « Poséidon »), « Juste play sur Spotify » (lancé « Juste une minute »), « Mes play sur ce pays » (parti au modèle). Pause dite proprement : bonne.
- **Corrigé autrement** : au lieu d'ajouter chaque faute, les mots de remplissage (juste, mets, mes, mais, sur, en, allez, ok…) sont retirés ; s'il ne reste qu'un mot, pause / pose ou play / lecture, c'est le geste. « Pose une question », « Mets une pause de cinq minutes » restent hors du geste.
- **Non corrigé** : « Spotify » entendu « ce pays ». Conseil : dire « reprends la musique » (mots français, mieux transcrits) plutôt que « play ».
