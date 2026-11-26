# Cahier des charges : Jarvis Développeur facile, étape 3 (suivre son projet, et Claude en renfort)

Écrit par Claude (le chat, chef d'équipe) le 26 novembre 2026, après une discussion à la voix avec
l'utilisateur :

> « À chaque fois que je veux lancer une application, j'ai l'impression que c'est un monde. Je sais
> même pas où il en est. Il n'y a rien d'intuitif. »
>
> « Quand c'est trop dur pour lui, il le détecte et il dit : il faudrait passer sur un modèle plus gros
> pour telle étape, ça prendrait tel temps, avec tel modèle ça coûterait tant. »
>
> « On va utiliser que Claude, grâce aux crédits d'API de mon abonnement. »

Suite de `developpeur-facile.md` (étapes 1 et 2, branches `claude/developpeur-facile` et
`claude/developpeur-facile-etape2`). **Constat du 26 novembre : ces deux étapes n'ont jamais été
fusionnées dans `claude/dev`**, l'utilisateur ne les a donc jamais eues dans Jarvis Test. C'est une
partie de son « rien n'est intuitif ».

Jarvis Test seulement. Le chantier suit l'atelier 3D et les yeux (feuille de route, § 0).

## 0. En bref, pour l'utilisateur

- Tu dis « fais-moi une appli de suivi de commandes pour Driver's Ink ». Jarvis répond tout de suite,
  te montre **son plan en étapes**, puis coche chaque étape quand elle est faite, avec les fichiers.
- À tout moment, « **où en est mon appli ?** » (fenêtre, téléphone ou enceinte) : l'étape en cours, ce
  qui est fait, ce qui reste, ce qu'il attend de toi.
- À la fin : « C'est prêt », un bouton **« Ouvrir l'appli »**, et où sont les fichiers.
- Quand une étape est **trop dure** pour le petit modèle local, Jarvis s'arrête et te montre une carte :
  « Cette étape est trop dure pour moi. Je propose de la confier à Claude : environ X minutes, environ
  Y centimes. » Tu dis oui ou non. **Un plafond par appli** (2 € par défaut) : Jarvis s'arrête avant de
  le dépasser.

## 1. D'abord : remettre les étapes 1 et 2 dans Jarvis Test

- Contrôles officiels sur `claude/developpeur-facile-etape2` (dont `fallbackMission.test.ts`,
  `missionWorkflow.test.ts`, la carte React), puis fusion dans `claude/developpeur-facile` et dans
  `claude/dev`, sans casser l'atelier ni les yeux.
- Essai réel décrit au rapport `rapports/2026-11-20-developpeur-facile-etape2.md` (« À faire par Claude
  Code »), et une capture de la carte pour l'utilisateur.

## 2. Suivre son projet

- **Le plan visible** : dès le début, la liste des étapes de la mission (celles qui existent déjà :
  base, écrans, logique, tests, revue…) en mots simples, chacune avec son état : à faire, en cours (avec
  ce que Jarvis fait en ce moment), faite ✓, ratée (avec la raison), en attente de toi.
- **« Où en est mon appli ? »** : règle express, sans modèle, qui lit l'état de la mission en cours (ou
  de la dernière) et le dit en trois phrases. À l'enceinte : une phrase, « le détail est sur le PC ».
- **« Mes applis »** : la liste des projets créés, avec pour chacun son état, son dossier, « Ouvrir
  l'appli » et « Continuer ».
- **Reprendre** : une mission coupée (PC redémarré, question restée sans réponse) se reprend où elle en
  était (cap chef de projet, § 5).
- **Prévenir** : à la fin, ou quand Jarvis attend une réponse, une ligne sur le téléphone.

## 3. Claude en renfort, seulement avec ton accord

### 3.1 Quand Jarvis propose Claude

Pas au hasard : sur des signes mesurés.
- La même étape rate **deux fois de suite** avec la même erreur (l'arrêt net actuel,
  `repeatedFailure`).
- Le contrôle de difficulté (`assessMission`) juge la mission trop grande pour le Codeur local : au
  lieu de « Mission non lancée », la carte propose aussi « avec Claude ».
- Une étape dépasse son plafond de durée, ou le modèle local rend une réponse illisible après la
  relance.
- L'utilisateur le demande (« passe à Claude pour cette étape »).

### 3.2 La carte

- L'étape concernée, en une phrase, et pourquoi le local n'y arrive pas.
- Le modèle proposé : le plus petit modèle Claude qui convient (par exemple Haiku pour une correction
  ciblée, Sonnet pour un plan ou une étape difficile ; jamais Opus sans que l'utilisateur le demande).
- **Estimation** de durée et de coût : calculée d'après la taille de ce qui sera envoyé (fichiers de
  l'étape, plan, erreurs) et une marge pour la réponse, avec les prix d'une table. Toujours écrite
  « environ ».
- Ce qui a déjà été dépensé sur cette appli, et le plafond.
- Boutons : « Oui, avec Claude », « Non, continue en local », « Arrête ».

### 3.3 Le plafond

- Par appli : **2 € par défaut**, réglable. Par mois : réglable, vide par défaut.
- Avant chaque appel, si l'estimation fait dépasser le plafond : pas d'appel, carte « plafond
  atteint ».
- Après chaque appel : le **coût réel** calculé à partir des jetons rendus par l'API, ajouté au total
  de l'appli et du mois, et affiché.

### 3.4 Ce qui part chez Claude, et ce qui n'y part jamais

- Seulement ce qu'il faut pour l'étape : la demande, le plan, les fichiers du projet concernés, les
  erreurs des tests.
- **Jamais** : les clés, les fichiers de réglages, les conversations privées, la mémoire, les photos,
  rien hors du dossier du projet. Revue de ce qui part avant l'envoi (même garde que les secrets du
  journal).
- Le reste de la boucle ne change pas : les fichiers écrits par Claude passent par les mêmes contrôles
  que ceux du modèle local (plan, revue du diff, tests, cartes pour les fichiers hors plan).

### 3.5 La clé

- Clé API Anthropic de l'utilisateur, tapée **par lui** dans les réglages, gardée dans le **coffre**
  (`coffre.bin`, `safeStorage`) ; la fenêtre ne la revoit jamais.
- Fournisseur : `packages/core/src/providers/anthropic.ts` existe déjà ; mettre à jour la liste des
  modèles et la table des prix d'après la **documentation d'Anthropic au moment de construire**
  (vérifier les noms et les prix en ligne, les noter avec la date dans le code ; ne rien inventer).
- Sans clé : la carte ne propose que le local, et dit comment ajouter la clé.

### 3.6 La règle des données (inchangée)

Rien de ce que Claude écrit n'entre dans un jeu d'entraînement. Chaque fichier ou réponse venue de
Claude est **marqué** dans l'historique de la mission, et ces missions sont **exclues** de toute
collecte pour entraîner les modèles locaux.

## 4. Ce qui ne change pas

- Jarvis Test d'abord. Mode Développeur et Claude en renfort **coupés par défaut** ; réglages
  facultatifs **sans défaut Zod** ; tests figés sans régénération.
- La Live ne reçoit rien de ce chantier sans décision de l'utilisateur.
- Aucun appel payant sans clic sur la carte ; jamais depuis une enceinte.

## 5. L'examen

« Fais-moi une appli de suivi de commandes pour Driver's Ink » (fiches : client, visuel, taille,
couleur du vinyle, prix ; états : reçue, en découpe, posée ou expédiée, payée ; liste de ce qui reste à
faire), **plafond 2 €** :
- le plan visible dès le début, chaque étape cochée ;
- « où en est mon appli ? » répond juste à tout moment ;
- Claude proposé seulement sur une étape où le local bloque, avec une estimation, et le coût réel noté ;
- à la fin, « Ouvrir l'appli » ouvre une appli qui marche, et le total dépensé est affiché.
Rapport : ce que le local a fait, ce que Claude a fait, le coût réel, et ce qui a coincé.
