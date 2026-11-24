# Cap : Jarvis chef de projet (les grandes demandes, menées jusqu'au bout)

Écrit par Claude (le chat, chef d'équipe) le 24 novembre 2026, à la demande de l'utilisateur :

> « Je lui parle, il choisit l'équipe. Mais quand je lui demande un truc assez précis, il va se servir
> de plusieurs équipes pour mener à bien la tâche. Comme toi : quand je te demande un boîtier qui
> contient un écran avec une carte électronique, imprimable en 3D, tu prends le temps qu'il faut, tu
> fais des recherches sur Internet pour savoir quelle taille fait l'écran, comment l'encastrer, quelle
> taille fait la caméra… et j'ai le modèle. Le but, c'est de réussir à faire la même chose avec Jarvis. »

**Ce document est un cap, pas encore une mission.** Il dit à chaque agent (Claude Code, Cursor) comment
construire ce qu'il construit **dès aujourd'hui** pour que ce cap soit possible. Le chantier « chef de
projet » lui-même commencera quand la feuille de route le dira (après l'étape 3 des boîtiers et
l'étape 1 des yeux).

## 1. Ce que l'utilisateur veut, en une image

Aujourd'hui : une demande → **une** équipe → une réponse.

Demain, pour une **grande demande** (« dessine-moi un boîtier pour un Raspberry Pi 5 avec un écran 7
pouces et une caméra, imprimable ») :

1. Jarvis **reconnaît** que c'est une grande demande et le dit : « C'est un projet. Je m'y mets, ça va
   me prendre un moment. »
2. Il **fait un plan** en étapes, chaque étape confiée à une équipe : chercher les cotes (Recherche),
   dessiner (Atelier), vérifier (Atelier et contrôles), préparer l'impression (Imprimante), regarder
   (Yeux), écrire du code (Code)…
3. Il **mène le plan seul**, étape après étape, en prenant le temps qu'il faut, et **montre où il en
   est** (« je cherche les cotes de l'écran », « 2 sources sur 3 concordent », « je dessine le
   socle »), dans la discussion et sur le téléphone.
4. Il **ne pose que les vraies questions** : une cote introuvable ou contradictoire (« mesure-moi
   l'épaisseur du bord de l'écran au pied à coulisse »), un vrai choix (« ports à l'arrière ou à
   droite ? »).
5. Il **livre** : le modèle 3D à l'écran, les fichiers, la liste des cotes avec leur source et leur
   état (sûre, incertaine, mesurée par toi), ce qui reste à vérifier, puis la carte « Imprimer ? ».
6. Il **prévient** quand c'est fini (téléphone), même si l'utilisateur est parti entre-temps.

## 2. Comment le faire marcher avec de petits modèles locaux

Les modèles de la RTX 2060 ne savent pas inventer un plan solide pour n'importe quoi. On fait donc
comme pour l'atelier : **des règles et des recettes d'abord, le modèle pour remplir les trous.**

- **Recettes** : un plan tout fait par genre de projet, écrit dans le code et testé. Première
  recette : « boîtier électronique » (liste des composants → cotes de chacun → placement →
  boîtier → contrôles → rendu → impression). D'autres viendront à l'usage (support, pièce de
  rechange, programme, recherche documentée…). Le modèle ne fait que **reconnaître la recette** et
  **remplir ses cases** (quels composants, quelles contraintes).
- **Pas de recette qui convient** : Jarvis le dit, propose la plus proche, ou traite la demande comme
  aujourd'hui (une équipe). Jamais un plan inventé présenté comme sûr.
- **Le dossier de projet** : chaque projet a son dossier (`jarvis-data/projets/<date>-<nom>/`, hors
  dépôt) : la demande, le plan, l'avancement, les cotes avec leurs sources, les fichiers produits, les
  questions posées et les réponses. Un projet reprend où il s'était arrêté (PC redémarré, question en
  attente).
- **Un seul modèle chargé à la fois** sur la carte graphique, comme partout ; les étapes qui n'ont pas
  besoin de modèle (recherche web, calcul, OpenSCAD, contrôles) passent sans lui.
- **Un gros modèle en ligne (Claude ou autre)** pour les demandes difficiles : **décision de
  l'utilisateur, pas encore prise** (coût à chaque usage, données qui sortent du PC). Rien ne le
  suppose ; s'il vient, ce sera une option coupée par défaut.

## 3. La recherche des cotes sur Internet (le cœur du cap)

- Pour chaque composant hors de la bibliothèque (`composants.json` de l'atelier) : chercher la fiche
  du fabricant et des plans (pages, PDF de cotes), **lire les nombres** (encombrement, trous de
  fixation, position des prises, épaisseurs), garder **chaque source**.
- **Recouper** : deux sources qui concordent → « sûre » ; une seule ou en désaccord → « incertaine »,
  et Jarvis conçoit avec une marge réglable (comme le chariot de la caméra du hub) ou demande une
  mesure. **Jamais une cote inventée.**
- Une cote **critique et incertaine** (ce qui doit s'emboîter au millimètre) → question à
  l'utilisateur, une à la fois, avec où et comment mesurer.
- Les cotes trouvées et confirmées **enrichissent la bibliothèque** (avec leurs sources) : la
  prochaine fois, plus besoin de chercher.
- Recherche web : les outils existants (`web_search`, `web_research`, `fetch_page`, gardes d'URL) ;
  la lecture des PDF de cotes est à ajouter.

## 4. Ce qui ne change pas

- Les actions **physiques ou irréversibles** (imprimer, lancer une pièce de la file, déplacer le
  robot, supprimer, acheter, publier) demandent **toujours** la carte de l'utilisateur, même au bout
  d'un long projet mené seul. Une enceinte ne valide jamais.
- Un projet ne dit « fini » que si les contrôles sont passés ; sinon il dit ce qui a raté.
- Jarvis Test d'abord, Live ensuite.
- Les règles des caméras, du réseau local et des secrets restent les mêmes.

## 5. Ce que chaque agent doit faire **dès maintenant** (la règle qui compte)

Tout ce que vous construisez sera un jour **une étape d'un projet**, appelée par Jarvis sans que
l'utilisateur clique. Donc, pour chaque fonction nouvelle :

1. **Une fonction appelable, pas seulement un bouton ou une phrase.** Entrées et sorties typées, dans
   `packages/core` quand c'est possible (sans Electron), avec un faux pour les tests. Exemples :
   « dessiner ce boîtier avec ces composants », « prendre une photo de cet œil », « chercher les cotes
   de ce composant », « préparer ce fichier pour l'imprimante ».
2. **Un résultat honnête et lisible par une machine** : réussi / raté et pourquoi, ce qui a été
   produit (chemins), les **sources** utilisées, les **incertitudes** (« incertaine », « à mesurer »),
   et ce qui demande l'accord de l'utilisateur. Jamais un « fait » non vérifié.
3. **De l'avancement** : un rappel « où j'en suis » pour les étapes longues (rendu OpenSCAD,
   tranchage, recherche), pour que le chef de projet puisse le montrer.
4. **Reprendre sans tout refaire** : une étape longue peut être relancée à partir de ce qu'elle a déjà
   produit.
5. **Les questions passent par un seul canal** : une étape qui a besoin de l'utilisateur rend une
   question (texte court, réponses possibles), elle ne bloque pas une fenêtre à elle.
6. **Penser plusieurs équipes** : ne suppose pas que ta fonction est appelée par « ta » phrase ; un
   autre agent ou le chef de projet l'appellera avec des données venues d'ailleurs.

Pour les agents actuels :

- **Atelier** : l'étape 3 (boîtier électronique dessiné seul) **est** la première étape-projet :
  `boitierElectronique({ composants, contraintes })` → modèle, contrôles, cotes avec états, questions.
  La bibliothèque de composants doit pouvoir **recevoir** des cotes venues de la recherche (avec
  source et état), pas seulement de l'utilisateur.
- **Yeux** : `prendrePhoto(œil)` et « qu'est-ce que tu vois ? » appelables par une étape (par exemple
  vérifier le plateau avant une impression, ou regarder un composant que l'utilisateur montre à
  l'iPhone pour le reconnaître).
- **Corrections** : garder le chef d'orchestre et le journal des tours capables de noter « projet »
  comme chemin, et ne rien casser de l'existant en intégrant.
- **Imprimante (plus tard)** : préparer, mettre en file, surveiller : chacune appelable par un projet.

## 6. L'examen du cap (quand le chantier sera ouvert)

1. « Dessine-moi un boîtier pour un Raspberry Pi 5 avec l'écran tactile 7 pouces et la caméra grand
   angle, les ports à l'arrière » : mené seul, sans question sur les composants connus, 64 contrôles
   de la référence du hub passés, encombrement à ±10 mm du hub.
2. La même chose avec un composant **inconnu** de la bibliothèque (par exemple l'ESP32-S3 avec l'écran
   OLED 1,3 pouce de l'enceinte) : Jarvis cherche les cotes, cite ses sources, demande seulement les
   cotes critiques incertaines, et livre un boîtier imprimable.
3. L'utilisateur part pendant le projet : il est prévenu sur le téléphone à la fin, et rien
   d'irréversible n'a été fait sans lui.
