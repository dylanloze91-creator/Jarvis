# Cahier des charges : Jarvis Développeur facile (étape 1)

Écrit par Claude (le chat, manager) le 19 novembre 2026, à partir des mots de l'utilisateur.
Mission pour **Claude Code**. Jarvis Test seulement.

## 0. Pourquoi

La carte de l'utilisation montre **une seule** demande de code à Jarvis sur 479. Ce n'est pas un
manque d'envie : l'utilisateur code avec Claude à côté, parce que Jarvis Développeur n'est pas
utilisable par quelqu'un qui ne code pas. Ce qu'il a vécu :

- il demande une application, Jarvis affiche « Jarvis réfléchit… » et **plus rien** : il ne sait
  pas si Jarvis travaille ;
- Jarvis crée des fichiers sur le PC **sans le dire** et sans qu'on les voie apparaître ;
- Jarvis ne lui **parle** pas pendant le travail ;
- les questions arrivent toutes au début, puis Jarvis disparaît ;
- les mots sont ceux d'un développeur (objectif, critères, plan, branche, diff, appliquer).

Ce que l'utilisateur veut, avec ses mots : « je lui décris vite fait, il dit : pas de souci, je
travaille dessus, et je me renseigne s'il y a de bonnes solutions sur Internet pour ce genre
d'application ». Puis il pose la base tout de suite (toutes les applications ont la même base) et
pose ses questions au fur et à mesure.

**Cette étape ne change pas le moteur** (les modèles du PC et la boucle de mission existante). Elle
change ce que l'utilisateur voit, entend et comprend. Le choix d'un autre moteur (par exemple Claude
Code) viendra plus tard, sur décision de l'utilisateur ; l'interface doit pouvoir s'y brancher sans
être refaite.

## 0 bis. Les écrans

Maquettes proposées par Claude le 19 novembre 2026, à valider par l'utilisateur (canevas claude.ai « Jarvis Développeur
facile — écrans ») : 1. Tout de suite, 2. Ce que j'ai trouvé, 3. Il construit et raconte,
4. Une question à la fois, 5. C'est prêt. Couleurs de Jarvis : fond très sombre, accent cyan,
vert pour ce qui est fait, ambre pour « c'est long ». Les noms d'applis trouvées sont des exemples ;
dans Jarvis, seuls de vrais résultats de recherche s'affichent.

## 1. Ce qui ne bouge pas

- Jarvis Test seulement. Live ne change pas. Branche `claude/developpeur-facile`, partie de
  `claude/dev` **après** la correction des outils de l'équipe PC.
- `parseSettings({})` sans clé nouvelle ; `__golden__` jamais régénérés ; tests figés intacts ;
  chat sans orchestre inchangé.
- Toutes les sécurités de Jarvis Développeur restent : projet neuf dans son propre dossier
  (`developer.projectsRoot`), rien écrit ailleurs, tri des commandes, cartes pour les
  dépendances, les suppressions et tout fichier protégé. Depuis une enceinte : Jarvis répond et
  raconte, mais **ne lance jamais** une création (il dit « je te montre ça sur le PC »).
- Aucune dépendance native, aucun modèle ajouté.

## 2. Le déroulé voulu

```
1. L'utilisateur décrit l'application, en quelques mots, au clavier ou à la voix.
2. Jarvis répond TOUT DE SUITE, sans attendre de modèle :
   « Pas de souci, je m'en occupe. Je regarde d'abord ce qui existe déjà. »
3. En même temps :
   a) RECHERCHE : Jarvis cherche sur Internet s'il existe déjà une application gratuite qui fait
      ça, et la bonne façon de la construire ;
   b) BASE : Jarvis pose la base de l'application à partir du gabarit qui convient (sans modèle).
4. Jarvis raconte, une ligne par étape, ce qu'il fait et ce qu'il a trouvé.
5. Jarvis présente ce qu'il a trouvé en mots simples, avec un choix clair.
6. Jarvis construit, en posant ses questions UNE À LA FOIS, au moment où il en a besoin.
7. Jarvis montre le résultat : l'application qui tourne, le dossier, ce qui reste à faire.
```

### 2.1 Réponse immédiate

- Dès qu'une demande de création est reconnue (`directMissionRequest`, outil `proposer_mission`,
  ou une nouvelle règle « crée/fais-moi une appli, un programme, un jeu, un site… »), Jarvis répond
  par une **phrase fixe** en moins d'une seconde, sans attendre le modèle. À la voix, il la dit.
- Puis une phrase de reformulation : « Si j'ai bien compris : une application qui … ». Faite par le
  modèle avec un plafond court ; s'il tarde ou répond mal : la phrase de l'utilisateur, nettoyée.
- **La carte de mission actuelle ne bloque plus le départ.** La recherche et la base démarrent
  tout de suite : ce sont des étapes sans risque (lecture du web, écriture dans un dossier neuf
  créé pour l'occasion). Ce qui demande une carte aujourd'hui (installer des dépendances, toucher
  un fichier hors du projet neuf, supprimer) en demande toujours une, au moment où ça arrive.

### 2.2 La recherche (l'agent qui se renseigne)

- Outils existants seulement (`web_research`, `web_search`, `fetch_page`), 2 à 4 recherches :
  « application gratuite qui fait … », « open source … », « comment faire … en JavaScript/
  TypeScript ».
- Résultat montré en français simple, trois parties au plus :
  - **« Ça existe déjà »** : 1 à 3 applications gratuites ou open source, une phrase chacune, le lien ;
  - **« Pour la construire »** : la façon conseillée en une ou deux phrases, sans jargon ;
  - **un choix** en boutons : « Construis-la quand même », « Montre-moi celle qui existe »,
    « Je change ma demande ».
- Sans réponse de l'utilisateur, la construction continue (« construis-la » est le choix par défaut) :
  la base est déjà posée, rien n'est perdu.
- Jamais de lien inventé : seulement des pages réellement lues ou trouvées.

### 2.3 La base tout de suite (l'agent qui construit)

- Le gabarit est choisi **sans modèle** par les règles qui existent (`fallbackFactory`,
  `steerFactory`, gabarits Node, web, jeu, .NET). La base est écrite pendant la recherche.
- Dès que la base tourne, Jarvis l'**ouvre** (page web dans le navigateur, ou fenêtre de l'appli)
  et le dit : « La base marche, je te l'ai ouverte. Maintenant j'ajoute … ».
- La carte graphique ne fait tourner qu'un modèle à la fois : la recherche (qui a besoin du modèle
  pour résumer) et la base (qui n'en a pas besoin) peuvent avancer **en même temps** ; les étapes
  qui demandent un modèle se suivent. Le rapport le dit clairement.

### 2.4 Jarvis parle pendant qu'il travaille

- **Fini « Jarvis réfléchit… » seul.** Pendant une création, la discussion montre une **ligne de
  travail vivante** : l'étape en cours en mots simples, le temps écoulé, et un signe qui bouge
  tant que ça tourne. Si une étape dépasse 30 s sans nouvelle, Jarvis le dit (« c'est long, je suis
  toujours dessus : le modèle écrit la page des réglages »).
- **Une ligne par étape, dans la discussion**, par exemple :
  - « Je cherche sur Internet ce qui existe déjà… »
  - « J'ai trouvé deux applications gratuites qui font presque ça. »
  - « Je pose la base de l'application (dossier C:\dev\Projets\…). »
  - « Je crée le fichier des réglages. »
  - « Je teste : 3 essais sur 4 marchent, je corrige le dernier. »
  - « C'est prêt. Je te l'ouvre. »
- **Les fichiers apparaissent** dans une petite liste sous la ligne de travail, au moment où ils
  sont créés ou modifiés, avec « Ouvrir le dossier ».
- **À la voix** (si la demande vient de la voix) : seulement les moments importants (début, ce
  qu'il a trouvé, une question, fin), en une phrase courte. Le reste reste à l'écran.
- Les phrases viennent des étapes réelles (`onPhase`, événements des outils fichiers, tests) :
  **jamais une étape annoncée qui n'a pas eu lieu**.

### 2.5 Les questions au fil de l'eau

- Plus de liste de questions au départ. Une question **à la fois**, au moment où Jarvis en a
  besoin, en mots simples, avec **une réponse proposée par défaut** (« Je pars sur un fond sombre,
  ça te va ? »). Sans réponse au bout de 2 minutes, Jarvis prend la réponse par défaut, le dit, et
  continue.
- Une question à l'enceinte se répond à la voix.

### 2.6 Des mots simples

- Dans la vue principale : pas de « branche », « diff », « plan validé », « critères », « copie
  isolée ». À la place : « dossier du projet », « ce qui a changé », « ce que je vais faire ».
- Les détails techniques restent disponibles, repliés sous « Détails pour développeur ».
- « Appliquer à ta copie » ne concerne que Jarvis lui-même ; pour un projet neuf, le résultat est
  simplement **dans son dossier**.

## 3. Essais

**Dans les tests :** réponse immédiate sans modèle ; recherche avec faux résultats (applications
trouvées, rien trouvé, Internet coupé) ; base posée pendant la recherche ; chaque ligne de travail
correspond à une vraie étape ; question avec réponse par défaut après le délai ; aucune création
lancée depuis une enceinte ; tests figés intacts.

**Avec l'utilisateur, dans Jarvis Test :**
1. « Fais-moi une petite appli pour noter mes heures de chantier » au clavier : phrase immédiate,
   lignes de travail, ce qui existe déjà, base ouverte.
2. La même chose à la voix depuis le PC.
3. Une question au fil de l'eau, puis la même sans répondre (réponse par défaut).
4. Depuis l'enceinte : Jarvis répond et dit qu'il montre la suite sur le PC.

## 4. Hors de cette étape

- Changer de moteur (Claude Code ou autre) : décision de l'utilisateur plus tard. L'interface doit
  passer par une couche « moteur » claire pour que ce branchement ne demande pas de tout refaire.
- Deux modèles en même temps sur la carte graphique : impossible avec 6 Go.
- Améliorer le code produit par les petits modèles.

## 5. Ce que Claude Code rend

- La branche `claude/developpeur-facile`, verte (typecheck, lint, tests, `npx electron-vite build`).
- `rapports/AAAA-MM-JJ-developpeur-facile.md` : ce qui a changé, des captures de la ligne de
  travail, les essais à faire avec l'utilisateur.
- `CLAUDE.md` mis à jour, `AGENTS-COORDINATION.md` tenu.
