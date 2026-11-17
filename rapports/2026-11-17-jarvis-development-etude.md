# Rapport — Jarvis Development, étape 1 : étude et plan des appendices

Claude Code, 17 novembre 2026. Branche `claude/jarvis-development`, partie de `main`. **Documentation seulement : aucun code, rien de changé dans Jarvis Live ni dans Jarvis Test, `FEUILLE-DE-ROUTE.md` non touchée.** Pas de fusion dans `main`, pas de publication.

## 1. Ce qui est rendu

| Fichier | Ce qu'il contient |
| --- | --- |
| `docs/specs/jarvis-development.md` | La carte des appendices (yeux, bras, jambes, oreilles et voix, sens, mains sur la maison, écrans, et quatre autres), le contrat commun, les règles de sécurité, l'ordre de construction proposé, les décisions à prendre, la liste « Pour Model Development ». |
| `docs/materiel/electronique-appendices.md` | Pour chaque appendice, le meilleur choix et une option moins chère : nom exact, rôle, prix relevé, vendeur, lien. La question de la vision avec des chiffres. L'alimentation, les fusibles, les batteries. Les outils. Ce qui s'imprime. Le récapitulatif avec les totaux. Les licences. |
| `rapports/2026-11-17-jarvis-development-etude.md` | Ce rapport. |

## 2. Les cinq premières pièces à acheter

Elles servent l'étape 1 (l'imprimante sous surveillance, premier objectif de « Jarvis autonome ») et ouvrent l'étape 3 (les sens).

| # | Pièce | À quoi elle sert | Prix relevé | Où |
| --- | --- | --- | --- | --- |
| 1 | Webcam USB **Logitech C270** | L'œil de l'imprimante : « montre-moi l'impression », et le début du dossier de photos | 19,99 € | Amazon.fr |
| 2 | Prise **Shelly Plug S Gen3** | Mesure et coupe le courant de l'imprimante, en local, sans Internet | 23,68 € | shelly.com/fr |
| 3 | Détecteur de fumée **Shelly Plus Smoke** (Wi-Fi) | Près de l'imprimante ; prévient le PC lui-même | 49,89 € | Alternate.fr |
| 4 | Lot de 5 cartes **ESP32-C3 SuperMini** | La base des capteurs, du bouton « Tout arrêter » et des témoins | 20,44 € port compris | Fruugo |
| 5 | Capteur **SHT40** | Température et humidité d'une pièce, ou près de l'imprimante | 6,90 € | Gotronic |
| | **Total** | | **120,90 €** | |

À savoir avant de commander :

- **La webcam suppose un port USB libre sur l'ordinateur de Klipper** (décision A1 ci-dessous). Sinon, une petite caméra Wi-Fi à 16,12 € la remplace.
- **Variante moins chère pour la fumée** : un détecteur Heiman (18,99 €) et un récepteur Zigbee (16,00 €) à la place du Shelly. Le total descend à **106,00 €**, mais il faut alors faire tourner un programme de plus sur le PC. Le récepteur servira ensuite à des capteurs à pile à 10 €.
- **Le minimum pour commencer** : la webcam et la prise, **43,67 €**.
- Pour le Shelly Plus Smoke, vérifier dans sa notice qu'il peut appeler une adresse du réseau local quand il sonne (le guide de Shelly le dit, le nom exact de l'événement n'a pas été trouvé). Il était en rupture sur le site de Shelly le jour du relevé.
- Tous les prix sont **hors frais de port** (sauf ligne 4) et **à revérifier sur la page** : voir la section 5.

## 3. Les décisions à prendre (une ligne chacune)

Le détail est dans le cahier, section 8.

| # | Décision | Ce que je propose |
| --- | --- | --- |
| A1 | Sur quoi tourne Klipper, et a-t-il un port USB libre ? | Port libre : webcam USB. Sinon : caméra Wi-Fi. |
| A2 | La vision sans achat au début (processeur du PC, Pi 5 du robot) ? | Oui ; un module IA (79,80 €) seulement si la mesure le demande. |
| A3 | La maison en direct d'abord, Home Assistant plus tard ? Quel type de chauffage ? | En direct d'abord ; le chauffage et les capteurs à pile viendront avec Home Assistant. |
| A4 | Les lumières sans carte de confirmation, comme Spotify ? | Oui ; une prise d'appareil qui chauffe reste confirmée. |
| A5 | Une règle permanente peut-elle régler le chauffage entre deux bornes ? | Oui pour le logement ; jamais pour l'imprimante, le robot ni un bras. |
| A6 | Prévenir le téléphone quand l'appli est fermée (ça passe par les serveurs d'Apple, texte chiffré, sans photo) ? | À décider ; sinon l'alerte est dite par les enceintes. |
| A7 | Un bouton « Oui » près de l'imprimante vaut-il un accord ? | Oui, pour l'imprimante seulement, pendant que Jarvis pose la question. |
| A8 | Une caméra dans une pièce de vie ? Quelles pièces interdites ? | À la demande, avec volet ; pas dans une chambre. |
| A9 | Une pince simple d'abord, ou tout de suite un petit bras ? | Simple d'abord (26 à 45 €). |
| A10 | Quelle est la batterie du robot (type, tension, protection, chargeur) ? | À relever avant tout achat de recharge. |
| A11 | Quels outils sont déjà là (fer à souder, multimètre) ? | La liste des outils se réduit d'autant (117 à 295 € si rien). |
| A12 | Un appendice relié à une seule édition, les nouveaux à Jarvis Test ; port du pont = base + 8 ? | Oui. |
| A13 | Quelle licence pour le dépôt ? Il est public mais n'en a pas. | Quelle qu'elle soit : un programme GPL ou AGPL reste à côté, jamais dedans. |
| A14 | L'ordre de construction (cahier, section 6) ? | À valider ou à changer. |

## 4. Pour Model Development

Hors de cette mission. Ces besoins sont seulement notés.

1. **Reconnaître une impression ratée** (« spaghetti », pièce décollée). Il faut d'abord un dossier de photos de **son** imprimante, réussies et ratées, que l'étape 1 commence à remplir, et mesurer les fausses alertes avant de laisser Jarvis agir.
2. **Dire si le plateau est vide**, avant tout lancement à distance.
3. **Reconnaître les 2 ou 3 objets à ranger** et la boîte, vus par la caméra du robot. Au début, des objets marqués suffisent, sans modèle.
4. **Choisir un petit modèle « vision + langage »** pour décrire une image et lire un écran : une mesure sur de vraies demandes, probablement pas un entraînement.
5. **Savoir que c'est à Jarvis de parler**, en français : vérifier d'abord si un détecteur ouvert existant suffit (l'un d'eux annonce le français).
6. **Entendre un détecteur de fumée qui sonne** ou un bruit anormal de l'imprimante.
7. **Apprendre un geste par démonstration**, seulement s'il y a un jour un bras de bureau.
8. **Une seconde carte graphique ?** La RTX 2060 est pleine avec le modèle de langage ; les chiffres sont dans le document matériel, section 3.

Les modèles de détection les plus connus (Ultralytics, Obico) sont sous licence AGPL : ils ne pourront pas entrer dans Jarvis. Des équivalents sous licence Apache 2.0 existent.

## 5. Les limites de cette étude (à lire)

- **Les prix viennent d'extraits de pages lus par le moteur de recherche**, pas de pages ouvertes : le réseau de la session n'autorise pas les sites des boutiques. La plupart ne sont pas datés. **Chaque prix est à revérifier avant de commander.**
- **Le quota de recherches web a été atteint** (200 par tour). Dix-sept lignes du document matériel portent un « prix à vérifier » : entre autres l'éclairage de l'imprimante, le régulateur des servos, les micro-interrupteurs, le radar de présence, le contact de porte, le filament TPU et PLA, les contacts de recharge, l'alimentation de laboratoire.
- **Presque aucun prix AliExpress** n'a pu être lu.
- **Aucune mesure n'a été faite sur le matériel de l'utilisateur.** Les vitesses de la vision viennent des documentations ; la vitesse d'un petit modèle « vision + langage » sur un processeur n'a été trouvée dans aucune source.
- **Trois faits manquent dans le dépôt** et ont été laissés ouverts : l'ordinateur de Klipper, la batterie du robot, les broches libres de l'ESP32 du robot.
- Deux licences sont notées « non revérifié » (Florence-2, Qwen2.5-VL 3B).

## 6. Points d'attention

- **La branche part de `main`, comme demandé.** Mais la table des éditions (ports de Live et de Test) et le client Moonraker ne sont pas encore dans `main` : ils sont dans `claude/dev`. Avant d'écrire du code d'appendice, il faudra fusionner `claude/dev` dans `claude/jarvis-development`, ou attendre que `claude/dev` arrive dans `main`.
- **Deux noms de branche.** Cette session de travail en ligne impose sa propre branche, `claude/jarvis-development-2y1sxj`. Le même contenu, commit pour commit, a été poussé sur `claude/jarvis-development`, la branche demandée, qui est celle à garder. L'autre peut être supprimée.
- **Un écart à trancher** entre la mission et la feuille de route : la mission permet une règle permanente pour ce qui chauffe, la feuille de route dit « jamais une règle qui chauffe ». C'est la décision A5.
- **Deux changements du contrat des enceintes** seront nécessaires un jour (une enceinte qui parle sans qu'on lui parle, l'annulation d'écho). Ils ne sont que signalés : ce contrat ne change pas sans cahier.
- **Deux remarques sur ce qui existe déjà**, sans rien modifier : les modèles fournis avec openWakeWord (« hey jarvis ») sont sous licence non commerciale, alors que `CLAUDE.md` note seulement « Apache 2.0 » (vrai du code, pas des modèles) ; et le dépôt d'origine de Piper est archivé, son successeur est sous GPL-3.0. Sans conséquence pour un usage personnel.
- **Le marché a bougé en 2026** : la mémoire a fait monter les prix. Le boîtier Home Assistant Green est passé de 99 $ à 199 $, le Jetson Orin Nano Super de 249 $ à 399 $, le module IA le plus récent du Pi de 130 $ à 200 $. C'est une raison de plus de commencer sans achat pour la vision.

## 7. Rapport de vérification

Aucun fichier de code n'a été touché : les étapes de construction, de types, de style et de tests de la routine n'avaient rien à vérifier et n'ont pas été lancées.

```
RAPPORT DE VÉRIFICATION
Lancement : NON LANCÉ (documentation seulement, aucun fichier de code modifié)
Types     : NON LANCÉ (idem)
Style     : NON LANCÉ (idem)
Tests     : NON LANCÉ (idem)
Secrets   : OK (0 trouvé dans les quatre fichiers modifiés)
Fichiers modifiés : AGENTS-COORDINATION.md, docs/specs/jarvis-development.md, docs/materiel/electronique-appendices.md, rapports/2026-11-17-jarvis-development-etude.md
Prêt à fusionner : NON (rien à fusionner : c'est une étude, la branche vit à part)
À corriger : les lignes « prix à vérifier » du document matériel ; les trois faits à relever (ordinateur de Klipper, batterie du robot, broches libres)
Testé en vrai (à la voix, sur le PC) : PAS FAIT (rien à essayer : aucun comportement de Jarvis n'a changé)
```

## 8. Résumé en dix lignes

1. Jarvis Development a maintenant son plan : un cahier, une liste de matériel, ce rapport.
2. Chaque appendice (yeux, bras, jambes, oreilles, sens, mains sur la maison, écrans) y est décrit : à quoi il sert, ses programmes, ce qui existe, ce qui manque, ses risques.
3. Tous suivent le même contrat que l'enceinte et le robot : réseau local, jeton, résultat vérifié, « stop » avant tout.
4. Jarvis n'agit seul que pour mettre en pause, arrêter ou couper, et il prévient toujours ; tout ce qui démarre, chauffe ou bouge attend ton accord.
5. Les caméras restent à la maison : rien dans le cloud, rien d'enregistré par défaut, une lumière quand elles regardent.
6. Pour la vision, on n'achète rien au début : le processeur du PC suffit à surveiller l'imprimante, la RTX 2060 reste aux modèles de langage.
7. Pour la maison, on commence en direct avec une prise à 24 € ; Home Assistant viendra quand il y aura beaucoup d'appareils.
8. L'ordre proposé commence par l'imprimante : une webcam, une prise, un détecteur de fumée, pour 79 à 134 €.
9. Les cinq premiers achats font 120,90 € ; tout le programme (étapes 1 à 7) fait 199 € au moins cher, 438 € au meilleur choix, plus les outils.
10. Les prix sont des relevés du 17 novembre à revérifier, et il te reste quatorze décisions à prendre : la première est de dire sur quoi tourne Klipper.
