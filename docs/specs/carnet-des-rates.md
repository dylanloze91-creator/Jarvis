# Cahier des charges — Le carnet des ratés

Rédigé par Claude pour Cursor, le 12 novembre 2026. À lire d'abord : `FEUILLE-DE-ROUTE.md` (cap, règles, « ce qui dépend de quoi »), `docs/specs/deux-jarvis.md`, et dans `CLAUDE.md` 5.0.60 (chef d'orchestre, événement `route`), 5.0.62 (destinataire, `classifyUtterance`), 5.0.75 (chrono de l'enceinte).

## Pourquoi

Jusqu'ici, chaque problème de Jarvis a été trouvé **par hasard**, par l'utilisateur : le trieur qui l'envoyait sur Google, la bourse, l'heure fausse, l'enceinte lente. Et le 12 novembre, une mission « réussie » (tests verts) a livré un bouton qui ne faisait rien.

Le but de Jarvis est que de petits modèles locaux égalent un niveau supérieur **sur les usages de l'utilisateur**. Pour cela, il faut savoir précisément où Jarvis rate. Le carnet note ces ratés tout seul, sans rien changer à ce que Jarvis répond.

## Principes

- **Il observe, il ne change rien.** Aucune consigne, aucun catalogue, aucune réponse ne change. `chat-unchanged`, `ollama-unchanged`, `orchestra-session` et `profiles/jarvis` restent verts sans régénération. `parseSettings({})` ne gagne aucune clé (réglages du carnet dans son propre fichier).
- **Tout reste sur le PC**, dans `userData/carnet/` : jamais dans le dépôt, jamais envoyé. Le carnet contient les phrases de l'utilisateur, ce sont ses données.
- **D'abord dans Jarvis Test** (feuille de route). Le code fonctionne dans les deux éditions. Il est **actif par défaut dans Test** et **coupé par défaut dans Live**, avec un interrupteur. Il passera actif dans Live quand l'utilisateur l'aura validé dans Test.
- **Aucun modèle pour décider qu'un tour est raté** : seulement des règles sûres, écrites et testées.

## Ce qui est noté automatiquement

| Type | Règle |
| --- | --- |
| `correction` | L'utilisateur corrige Jarvis juste après une réponse (`classifyUtterance` ≠ `one-off` : « non, c'est faux », « pas ça », « je t'ai dit… », « corrige… »). |
| `repetition` | Même demande (ou presque : mots communs ≥ 70 %, après nettoyage) reposée dans les 3 minutes. |
| `interruption` | L'utilisateur coupe la réponse : « stop », « tais-toi », bouton Arrêter, ou parole pendant la voix, dans les 5 secondes après le début de la réponse. |
| `outil_echec` | Un outil rend une erreur, `verification_failed`, un délai dépassé, ou un refus non voulu par l'utilisateur. |
| `lenteur` | Fenêtre : plus de 10 s avant le premier mot. Enceinte : plus de 6 s entre la fin de la phrase et le premier son (chrono de 5.0.75). Seuils réglables. |
| `chemin` | Le cerveau rend une réponse illisible et le tour retombe sur le chemin d'avant ; ou l'équipe choisie n'a aucun outil pour une demande qui en voulait un. |
| `signale` | L'utilisateur dit « Jarvis, ça n'a pas marché », « c'était nul », « tu t'es trompé », ou clique 👎 sous une réponse. |

« Ça n'a pas marché » dit à voix haute est une **règle express**, avant tout modèle : Jarvis répond « C'est noté. » et note le tour **précédent**. Aucun modèle n'est appelé. Ça marche aussi depuis l'enceinte et le téléphone.

## Ce que contient une entrée

Fichier `userData/carnet/rates.jsonl`, une ligne par raté :

- date ;
- édition ;
- source (fenêtre, enceinte avec son nom, téléphone) ;
- type, avec la règle qui l'a déclenché ;
- la **phrase de l'utilisateur** ;
- le début de la réponse de Jarvis (300 caractères au plus) ;
- l'équipe, le modèle et le **comment** (`calcul`, `express`, `cerveau`, `trieur`, chemin d'avant) ;
- les outils appelés et leur résultat en une ligne ;
- la durée de chaque étape quand elle existe ;
- l'identifiant de la conversation.

Aucun secret : `redactSecrets` passe sur tout.

Plafond : 5 000 entrées. Au-delà, les plus anciennes déjà revues partent en premier.

## La revue de la semaine

- **Où** : dans la fenêtre, une carte « Les ratés de la semaine » sur le tableau de bord, et Réglages → Application → « Carnet des ratés ».
- **Ce qu'elle montre** : les ratés de la semaine, regroupés quand ils se ressemblent (même type et mots proches), les plus fréquents d'abord. 10 groupes au plus sont affichés, avec « tout voir » pour le reste.
- **Pour chaque groupe, l'utilisateur peut, en deux clics, sans rien taper s'il ne veut pas :**
  - écrire **ce qu'il attendait** (facultatif) ;
  - choisir une catégorie : « Une règle à ajouter », « Un bogue », « Le modèle se trompe », « Matériel ou réseau », « Pas grave » ;
  - « Ce n'était pas un raté » : l'entrée est retirée, et la règle qui l'a déclenchée est comptée comme fausse alerte.
- **Le dimanche**, au premier lancement de la journée : une phrase dans la discussion, par exemple « Cette semaine, j'ai noté 12 ratés. Tu veux les voir ? ». Jamais à voix haute sur l'enceinte.
- **« Préparer pour Claude »** : un fichier `carnet-semaine.md`, écrit dans le dossier de l'utilisateur et ouvert dans l'explorateur. L'utilisateur choisit lui-même de le donner au chat. Il contient les groupes, leurs chiffres, les catégories choisies et les phrases. Jamais envoyé tout seul.

## Pour plus tard (préparer, ne pas faire)

Les entrées où l'utilisateur a écrit « ce qu'il attendait » deviendront des exemples d'entraînement et d'examen sur **son** usage. Elles se plient aux règles de la feuille de route : l'examen n'est jamais entraîné, aucun texte de Claude ni de Cursor. Garde un format stable et documenté (`version: 1`), pour qu'un futur outil puisse les lire. N'écris pas cet outil maintenant.

## Tests

- Chaque règle de détection, avec des phrases et des séquences synthétiques (marquées `synthetique-test`) : vrais ratés, et **faux ratés à ne pas noter** :
  - une nouvelle demande qui commence par « non, mais… » ;
  - « stop » adressé à Spotify ;
  - une répétition volontaire (« encore une blague ») ;
  - une lenteur pendant un téléchargement demandé.
- « Ça n'a pas marché » : note le tour précédent, sans aucun appel au modèle (faux modèle qui échoue s'il est appelé), aussi depuis une `ChatSession` d'enceinte.
- Aucune différence dans ce que Jarvis envoie au modèle, carnet actif ou non : comparer les requêtes du faux Ollama dans les deux cas.
- Le fichier reste dans `userData/carnet/` ; secrets masqués ; plafond respecté.
- Regroupement et ordre de la revue ; « pas un raté » retire l'entrée et compte la fausse alerte.
- Édition : actif par défaut dans Test, coupé dans Live, interrupteur qui marche dans les deux.

## Livraison

- **Base** : la branche qui contient les deux Jarvis. C'est `main` si `cursor/deux-jarvis` y est fusionnée, sinon `origin/cursor/deux-jarvis`. Dis laquelle dans le rapport. Branche `cursor/carnet-des-rates`, inscrite dans `AGENTS-COORDINATION.md`.
- Ne touche pas à `speaker/repair.ts`, `serialAccess.ts`, `firmware/`, `training/`. Touche `session.ts` et `index.ts` le moins possible : le carnet est un **observateur** branché sur les événements existants (`ChatEvent`, `route`, chrono, résultats d'outils), dans de nouveaux fichiers (`main/carnet/`, `packages/core/src/carnet/`).
- Un commit par partie, tests verts, puis `typecheck`, `test` et `lint`.
- Rapport, avec la liste des essais pour Claude Code dans Jarvis Test :
  - provoquer chaque type de raté ;
  - « ça n'a pas marché » à l'enceinte ;
  - la revue de la semaine ;
  - « Préparer pour Claude ».

  Puis le RAPPORT DE VÉRIFICATION.
- Pas de fusion, pas de publication.
