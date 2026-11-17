# Cahier des charges : Jarvis plus rapide, sans nouveau modèle

Écrit par Claude (le chat, manager) le 17 novembre 2026, sur décision de l'utilisateur :
« ce qui nous ralentit, c'est les modèles d'IA ; on doit développer des outils qui ne sont pas des
modèles afin d'améliorer l'IA ». Mission confiée à **Claude Code**.

Ce cahier applique une règle déjà écrite dans la feuille de route (section 2) : **ce qui se décide
par une règle sûre ne passe pas par un modèle**. Il prépare aussi l'étape 2 de la « Vraie
conversation » (répondre plus vite), sans la commencer.

## 0. Ce qui ne bouge pas

- **Jarvis Test seulement.** Branche `claude/rapide-sans-modele`, partie de `claude/dev`. Rien dans
  la Live. Ne pas fusionner dans `claude/dev` avant que l'utilisateur ait fait les essais de
  `5.1.0-test.1` (ce soir) : la branche doit attendre, pas les gêner.
- **Aucun modèle ajouté, changé ou entraîné.** Aucune dépendance native. Pas de modèle « caché »
  non plus (pas de petit réseau de neurones, pas d'« embeddings ») : seulement du code, des règles,
  des comptes, des caches et des réglages d'Ollama.
- **Chat sans orchestre inchangé**, `__golden__` jamais régénérés, `parseSettings({})` sans nouvelle
  clé, tests figés intacts (`chat-unchanged`, `ollama-unchanged`, `orchestra-session`,
  `machineProfile`).
- **Une réponse rapide mais fausse est pire qu'une réponse lente.** Chaque règle nouvelle a des
  essais qui disent ce qu'elle prend **et ce qu'elle ne doit pas prendre**. En cas de doute, la
  règle laisse passer au chemin d'avant.
- **Les phrases de l'utilisateur ne quittent pas son PC.** Les mesures se comptent (durées,
  nombres, noms d'équipe) ; aucune phrase n'est recopiée dans le dépôt ni dans un rapport.
- Chaque outil rend un **résultat clair** au journal du tour (feuille de route, section 4).

## 1. D'abord mesurer : le chronomètre par étape

Aujourd'hui le journal du tour (`TurnLogEntry`) ne donne qu'une durée totale. On ne peut pas
savoir ce qui ralentit.

1. Ajouter au journal du tour, **en champ facultatif** (les anciens journaux restent lisibles), le
   détail des étapes en millisecondes :
   - `tri` : temps pour choisir l'équipe, et par quel chemin (calcul, horloge, express, cerveau) ;
   - `chargement` : temps de chargement du modèle par Ollama (`load_duration`, déjà renvoyé par
     Ollama, il suffit de le lire) ;
   - `lecture` : temps de lecture du prompt (`prompt_eval_duration`) et nombre de jetons lus
     (`prompt_eval_count`) ;
   - `premierMot` : temps jusqu'au premier morceau de réponse ;
   - `ecriture` : temps d'écriture (`eval_duration`) et nombre de jetons écrits ;
   - `outils` : temps passé dans chaque outil ;
   - `voix` : temps jusqu'au premier son, quand la réponse est dite.
2. Un script `scripts/vitesse.ps1` (même esprit que `carte-utilisation.ps1`) lit les conversations
   de Jarvis Test sur le PC et écrit `C:\dev\jarvis-data\vitesse\vitesse.md` : **seulement des
   chiffres** (médiane et pire cas par étape, par équipe, par chemin, par source texte/voix/enceinte),
   et la part du temps de chaque étape. L'utilisateur envoie ce fichier à Claude.
3. Un **banc de vitesse** reproductible : une vingtaine de demandes types écrites par Claude Code
   (pas par l'utilisateur), passées dans Jarvis Test sur le PC, mesurées avant et après chaque
   outil. Rapport « avant / après » par outil.

Rien de la section 2 ne se garde s'il ne gagne pas de temps au banc.

## 2. Les outils sans modèle (dans cet ordre, chacun mesuré)

### 2.1 Garder les modèles chauds

Charger un modèle sur la RTX 2060 prend plusieurs secondes ; c'est souvent la plus grosse attente.

- Mesurer combien de tours paient un chargement (`chargement` > 1 s).
- Préchauffer au démarrage de Jarvis Test le cerveau et l'équipe la plus utilisée, puis les garder
  chargés tant que la carte graphique le permet (`keep_alive`), sans gêner Jarvis Développeur ni
  les images (ils libèrent déjà la carte quand ils en ont besoin).
- Éviter le va-et-vient : si le cerveau et l'équipe peuvent tenir ensemble dans la mémoire de la
  carte, ne pas décharger l'un pour charger l'autre. S'ils ne tiennent pas, le dire au rapport
  avec les chiffres, et proposer (sans l'appliquer) le choix de modèles qui l'éviterait.

### 2.2 Prompt plus court et réutilisable

Plus le prompt est long, plus la lecture est longue. Ollama réutilise le début d'un prompt
identique d'un tour à l'autre : si une ligne qui change souvent est placée au début, tout est relu.

- Mesurer les jetons lus par équipe (`prompt_eval_count`).
- Vérifier l'ordre du prompt système des équipes : la ligne d'heure (`clockLinePrompt`) change
  chaque minute et se trouve dans le message système, **avant** tout l'historique. Essayer de la
  placer après l'historique (sans changer ce qu'elle dit), et mesurer si la lecture raccourcit.
- N'envoyer à chaque équipe que les outils qu'elle utilise vraiment (c'est déjà le principe ;
  vérifier qu'aucune description d'outil inutile ne reste), raccourcir les descriptions trop
  longues, et limiter l'historique envoyé aux derniers échanges utiles.
- Ne pas toucher au chat sans orchestre ni aux `__golden__`.

### 2.3 Plus de demandes réglées sans modèle

- **Règles express** : ajouter des règles là où le cerveau est appelé pour une demande que des
  mots sûrs suffisent à classer. **On ne devine pas** : la liste vient de la carte de l'utilisation
  (`carte.md`) et de `vitesse.md` quand ils arriveront. Avant, préparer seulement l'outil qui
  permet de les ajouter proprement (une règle = des mots qui la déclenchent, des mots qui
  l'empêchent, des essais pour et contre).
- **Réponses directes** pour les demandes dont la réponse vient d'un outil sans réflexion (heure,
  date, minuteur, volume, musique, bourse, météo quand l'outil existe) : l'outil répond seul, avec
  une phrase faite, sans repasser par un modèle pour reformuler.
- Le **trieur entraîné reste en pause** : on parle ici de règles écrites, pas d'un modèle de tri.

### 2.4 Mémoire courte des résultats d'outils

- Garder quelques minutes les résultats qui ne changent pas vite (météo, actualité, cours de
  bourse, recherche identique) : la même question deux fois de suite ne refait pas le travail.
- Durée par outil, écrite dans le code, dite dans le journal (« réponse gardée, vieille de 3 min »).
- Jamais pour un outil qui agit (imprimante, robot, musique, enceinte) : seulement pour la lecture.

### 2.5 Hors de cette mission

- La voix phrase par phrase, la transcription au fil de la parole, couper Jarvis : c'est la
  « Vraie conversation », chantier suivant. Cette mission ne fait que le chronomètre `voix`.
- Changer de modèle, quantifier autrement, entraîner : décidé plus tard, avec l'examen tiré de
  l'usage réel.

## 3. Ce que Claude Code rend

- La branche `claude/rapide-sans-modele`, poussée, avec typecheck, lint, tests,
  `npx electron-vite build` verts.
- `rapports/AAAA-MM-JJ-rapide-sans-modele.md` : pour chaque outil, le gain mesuré au banc (avant /
  après, médiane et pire cas), ce qui a été gardé, ce qui a été retiré parce qu'il ne gagnait rien,
  et ce qui attend `carte.md` ou `vitesse.md`.
- La liste des essais à faire par l'utilisateur dans Jarvis Test (cinq au plus, à la voix et au
  clavier).

## 4. Ordre de travail conseillé

1. Chronomètre par étape + `vitesse.ps1` + banc de vitesse (sans eux, rien ne se juge).
2. Modèles chauds (2.1).
3. Prompt plus court (2.2).
4. Mémoire courte des outils (2.4).
5. L'outil pour ajouter des règles express (2.3), les règles elles-mêmes après `carte.md`.

S'il faut s'arrêter en route, s'arrêter à la fin d'une étape, branche verte, rapport à jour.
