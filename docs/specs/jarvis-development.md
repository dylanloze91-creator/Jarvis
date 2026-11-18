# Cahier — Jarvis Development : les appendices de Jarvis

Rédigé par Claude Code le 17 novembre 2026, à la demande de l'utilisateur. **Étude et plan : aucun code de fonctionnalité.** Branche `claude/jarvis-development`, partie de `main`.

À lire avec :

- `FEUILLE-DE-ROUTE.md` (le cap, les règles, « Jarvis autonome » et « Vraie conversation ») ;
- `docs/materiel/electronique-appendices.md` (les pièces, les prix, l'alimentation, les outils) ;
- `rapports/2026-11-17-jarvis-development-etude.md` (les 5 premiers achats, les décisions à prendre).

Ce cahier **propose**. C'est l'utilisateur, avec Claude (le chat), qui décide de l'ordre et de ce qui se construit. Il ne change ni la feuille de route, ni Jarvis Live, ni Jarvis Test.

Le dépôt est public : ce cahier ne contient ni adresse, ni nom de réseau, ni photo, ni donnée personnelle.

---

## 0. En bref

**Jarvis Development** donne un corps à Jarvis. Chaque partie du corps est un **appendice** : une chose que Jarvis peut voir, entendre, sentir, bouger ou allumer. Un appendice, c'est toujours trois programmes et un peu d'électronique :

1. un programme **sur la carte** (le petit ordinateur de l'appendice) ;
2. un programme **sur le PC** (le pont qui lui parle) ;
3. des règles et des outils **dans le cœur de Jarvis** (ce que Jarvis a le droit de lui demander) ;
4. et toujours un **faux appendice** pour tout essayer sans matériel.

Ce que dit ce cahier, en dix points :

1. Jarvis a déjà **des oreilles et une voix** (les enceintes), **des jambes** (le robot), **une fabrique** (l'imprimante 3D), **un écran** (sur l'enceinte) et **le téléphone**. On réutilise tout.
2. Tous les appendices suivent **le même contrat**, copié sur celui de l'enceinte et du robot : réseau local, jeton, présentation, état, résultat clair, « stop » et arrêt d'urgence qui passent avant tout.
3. Une règle simple dit qui appelle qui : **ce qui agit écoute Jarvis** (comme le robot) ; **ce qui sent ou parle appelle Jarvis** (comme l'enceinte).
4. **Jarvis n'agit seul que dans le sens de la sécurité** (pause, arrêt, coupure), et il prévient toujours. Tout ce qui démarre, chauffe ou bouge attend l'accord de l'utilisateur.
5. **Les caméras restent à la maison** : images traitées sur place, rien dans le cloud, rien d'enregistré par défaut, un témoin lumineux quand une caméra regarde.
6. **Pour la vision, on n'achète rien au début.** Surveiller l'imprimante demande une image toutes les 10 à 30 secondes : le processeur du PC suffit, la RTX 2060 reste aux modèles de langage. Les chiffres sont dans le document matériel.
7. **Pour la maison, on commence en direct** (une prise qui parle au PC sans Internet), et on passe par Home Assistant seulement quand il y aura beaucoup d'appareils. Le contrat côté Jarvis est le même dans les deux cas.
8. **L'ordre proposé commence par l'imprimante** : une caméra, une prise, un détecteur de fumée. C'est le moins cher et c'est le premier objectif de « Jarvis autonome ».
9. Ensuite : couper Jarvis à la voix, les capteurs, les lumières, les yeux et la sécurité du robot, le bras, puis la recharge.
10. Ce qui demande un **modèle entraîné** (reconnaître une impression ratée, reconnaître les objets à ranger) est seulement noté dans la section « Pour Model Development ».

---

## 1. Ce que c'est, et ce que ce n'est pas

- **C'est** un chantier à côté de Jarvis Live et de Jarvis Test. Il vit sur la branche `claude/jarvis-development`. Chaque appendice aura son propre cahier, sa branche partie de celle-ci, sa relecture, puis ses essais **dans Jarvis Test**.
- **Ce n'est pas** Model Development (entraîner des modèles) : hors de cette mission. Quand un appendice a besoin d'un modèle entraîné, c'est noté en section 9, rien de plus.
- **Ce n'est pas** une nouvelle application. Les appendices se branchent sur ce qui existe : le Tool Manager, les confirmations, le journal d'audit, le bilan de santé, le chef d'orchestre.
- **Rien ici ne modifie Live ni Test.** Une nouveauté suit le chemin habituel : branche, relecture, `claude/dev`, Jarvis Test, essai par l'utilisateur, puis seulement Live.

> **Point d'attention pour plus tard.** La branche part de `main`, comme demandé. Mais deux briques dont les appendices auront besoin ne sont pas encore dans `main` : la **table des éditions** (ports de Live et de Test, `packages/core/src/edition.ts`) et le **client Moonraker** de l'imprimante (`packages/core/src/quotidien/moonraker.ts`). Elles sont dans `claude/dev`. Avant d'écrire du code d'appendice, il faudra fusionner `claude/dev` dans `claude/jarvis-development`, ou attendre que `claude/dev` arrive dans `main`.

---

## 2. Ce qui existe déjà (vérifié dans le dépôt le 17 novembre 2026)

| Ce qui existe | Où | Ce qu'on en réutilise |
| --- | --- | --- |
| **Enceinte** : carte ESP32-S3 (copie XH-S3E N16R8), micro INMP441, ampli MAX98357A | `firmware/jarvis-speaker/`, `apps/desktop/src/main/speaker/`, `packages/core/src/speaker/` | Tout le modèle : jeton dont le PC ne garde que l'empreinte, réseau privé seulement, `hello`, signe de vie toutes les 30 s, installation par USB, annonce du PC sur le réseau (mDNS), fausse enceinte pour les essais |
| **Écran de l'enceinte** : OLED SH1106 1,3 pouce en I2C (IO8 et IO9), mascotte, heure, informations du PC | branches `claude/enceinte-ecran`, `claude/ecran-infos`, `claude/live-5079` (pas encore dans `main`) | L'en-tête `X-Jarvis-Ecran`, la file d'affichage par enceinte, l'outil `afficher_sur_enceinte` |
| **Robot Jarvis Rover** : Raspberry Pi 5 + ESP32, propulsion arrière, direction avant type voiture | service hors dépôt (`jarvis-rover/`), client `apps/desktop/src/main/rover/`, règles `packages/core/src/rover/` | Le contrat « on l'appelle » : `/api/sante`, `/api/etat`, `/api/stop`, `/api/arret_urgence`, mouvements bornés et mesurés, mode simulation, faux robot de test |
| **Le robot comme enceinte** | `robot/voix/` | Le principe « un programme séparé à côté du pilotage », et le « stop » reconnu sur place, sans attendre le PC |
| **Imprimante 3D** : Ender 3 S1 Plus sous Klipper | client Moonraker du lot B, dans `claude/dev` | État, fichiers, lancer (confirmé), pause, reprise, annulation, faux Moonraker de test |
| **Téléphone** : appli web par Tailscale | `apps/desktop/src/main/phone/` | Les cartes de confirmation hors du PC ; un endroit où afficher une alerte et une photo |
| **Deux Jarvis** : Live et Test côte à côte | `packages/core/src/edition.ts` dans `claude/dev` | Une seule table : dossier de réglages, base des ports, fonctions réservées à Live |
| **Routines** du lot B | `packages/core/src/quotidien/routines.ts` dans `claude/dev` | Le point de départ des « règles permanentes » |
| **Bilan de santé** du lot A | `packages/core/src/health/` | Chaque appendice y aura sa ligne |
| **Écriture sûre des fichiers d'état** (5.0.78) | `apps/desktop/src/main/safeFile.ts` | Le registre des appendices s'écrira comme `speakers.json` |
| **Module images** : décharger le modèle de langage, travailler, le recharger | `apps/desktop/src/main/images/` | La même manœuvre pour un petit modèle de vision sur la RTX 2060 |
| **Capture de l'écran du PC** | outil `take_screenshot` | « Lire mon écran » sans caméra |

Ce que le dépôt **ne dit pas** et qu'il faudra confirmer avec l'utilisateur (section 8) : sur quel petit ordinateur tourne Klipper ; la batterie exacte du robot ; les broches encore libres sur l'ESP32 du robot ; le type de chauffage du logement.

Deux faits utiles relevés dans le faux robot de test (`fakeRover.testkit.ts`) : le robot est limité à **0,3 m/s**, et son **rayon de braquage minimal est d'environ 0,5 m**. Il ne tourne pas sur place. Ça compte pour la pince (section 4.2).

---

## 3. Le contrat commun à tous les appendices

### 3.1 Les huit règles, en français simple

1. **Réseau local seulement.** Un appendice ne parle qu'à des adresses de la maison. Jamais Internet.
2. **Un jeton par appendice.** Sans jeton, pas d'ordre. Le PC ne garde que l'empreinte du jeton quand c'est l'appendice qui appelle ; quand c'est le PC qui appelle, le jeton est rangé dans le coffre des clés (lot A).
3. **Il se présente** (`hello`) : qui il est, ce qu'il sait faire, son niveau de risque, sa version.
4. **Il dit son état** : prêt, occupé, arrêté, en arrêt d'urgence, en erreur ; et quand il a donné signe de vie pour la dernière fois.
5. **Un résultat clair.** Réussi, raté et pourquoi. « Terminé » veut dire que l'appendice l'a **mesuré ou relu** (la distance parcourue, le relais vraiment coupé, la photo vraiment prise). Jamais un « fait » non vérifié.
6. **« Stop » et arrêt d'urgence passent avant tout.** Ils n'attendent ni une carte de confirmation, ni un modèle, ni la fin d'une phrase.
7. **Il est inscrit dans un registre**, comme les enceintes : on voit ses appendices, on les ajoute, on les retire, et on sait lesquels répondent.
8. **Live et Test côte à côte** : des ports et des dossiers séparés, pris dans la table des éditions. Jamais un port écrit en dur.

### 3.2 Qui appelle qui

Une seule règle, déjà vraie aujourd'hui :

- **Ce qui agit écoute Jarvis.** Un appendice qui bouge, chauffe ou commute est un petit serveur, et c'est Jarvis qui l'appelle. C'est le modèle du **robot** et de l'**imprimante**. Avantage : le « stop » va droit à lui, et il peut se protéger seul si Jarvis disparaît.
- **Ce qui sent ou parle appelle Jarvis.** Un capteur, un bouton, une enceinte appellent le pont du PC. C'est le modèle de l'**enceinte**. Avantage : l'appendice peut dormir, et le PC n'a pas à connaître son adresse.

Les appareils du commerce (Moonraker, prise Shelly, Home Assistant) ne parlent pas ce contrat. Ils ont chacun un **adaptateur** dans le cœur de Jarvis, avec son faux appareil de test. C'est l'adaptateur qui tient les promesses du contrat : résultat relu, arrêt d'abord, réseau local.

### 3.3 Les trois niveaux de risque

| Niveau | Ce que fait l'appendice | Exemples | Ce que Jarvis exige |
| --- | --- | --- | --- |
| **Lire** | Il regarde, écoute, mesure | caméra, capteur de température, détecteur de porte | Rien pour lire. Les règles des caméras (3.7) s'appliquent. |
| **Agir** | Il fait quelque chose de sans danger et de réversible | allumer une lampe, afficher un message, dire une phrase | Outil sûr, sans carte, comme Spotify aujourd'hui (à valider, section 8). |
| **Bouger ou chauffer** | Il démarre, chauffe ou déplace quelque chose | robot, pince, imprimante, chauffage, prise d'un appareil qui chauffe | Carte de confirmation **à chaque fois**, qu'aucun réglage ne peut retirer. Jamais depuis une enceinte. |

Dans les trois niveaux, **arrêter, mettre en pause et couper** sont toujours permis sans carte.

### 3.4 « Stop » et arrêt d'urgence

Ce sont deux choses différentes :

- **Stop** : « arrête ce que tu es en train de faire ». L'appendice s'immobilise et reste prêt. On peut redonner un ordre ensuite.
- **Arrêt d'urgence** : « coupe et ne repars plus ». L'appendice se verrouille. Il faut le **relâcher** exprès, sur le PC ou le téléphone, avec une carte de confirmation (c'est déjà la règle de `rover_release_emergency`).

Les règles :

1. **Accepté de partout** : PC, téléphone, enceinte, bouton physique. Sur le réseau local, le stop n'exige même pas le jeton (c'est déjà le cas du robot) : mieux vaut un arrêt de trop.
2. **Sans modèle.** « Stop », « arrête », « arrête tout » sont reconnus par des règles sûres, avant le chef d'orchestre, comme « stop la musique » aujourd'hui.
3. **Sur place quand c'est possible.** Le robot reconnaît « stop » lui-même (`robot/voix/`), sans attendre le PC.
4. **« Arrête tout »** : une nouvelle phrase, à écrire. Elle envoie stop à **tous** les appendices qui bougent ou chauffent : le robot s'arrête, la pince se fige, l'impression se met en pause.
5. **Le chien de garde.** Un appendice qui bouge borne lui-même chaque ordre (durée, distance). Si Jarvis ne répond plus pendant une action, il s'arrête seul. Et si Jarvis annule un tour, il envoie stop avant de rendre la main (déjà fait pour le robot).
6. **Le bouton physique reste la vraie sécurité.** Un bouton d'arrêt d'urgence coupe l'alimentation des moteurs par un fil, sans passer par un programme. Aucun logiciel ne le remplace.

### 3.5 Le registre des appendices

Comme les enceintes (`speakers.json`), **hors de `settings.json`** : un brouillon de réglages ouvert ne peut pas effacer un appendice, et `parseSettings({})` ne gagne aucune clé.

- Un fichier `appendices.json` dans le dossier de réglages de l'édition, écrit par l'écriture sûre (`safeFile.ts`).
- Pour chaque appendice : un identifiant, un genre (œil, bras, jambes, oreille, sens, main, écran, énergie), un nom, une pièce, le sens du lien (il appelle ou on l'appelle), son niveau de risque, ce qu'il sait faire, sa version, et son dernier signe de vie (en mémoire seulement).
- Un écran dans les réglages, sur le modèle de « Enceintes » : ajouter, retirer, voir qui répond, et un bouton **« Tout arrêter »**.
- Une ligne par appendice dans le **bilan de santé** : « La caméra de l'imprimante ne répond plus depuis 10 minutes. »
- Chaque action d'un appendice va au **journal d'audit**, avec le nom de l'appendice.
- Les enceintes gardent leur registre et leur contrat tels quels (`/api/speaker/*` ne change pas sans cahier). Le registre des appendices est leur frère, pas leur remplaçant.

### 3.6 Live et Test côte à côte

- **Le pont des appendices prend son port dans la table des éditions** : base de l'édition + un décalage. Proposition : décalage 8, à côté du téléphone (6) et des enceintes (7). Le chiffre se fixera dans `edition.ts`, nulle part ailleurs.
- **Chaque édition a son dossier** : son `appendices.json`, ses journaux. Test n'écrit jamais chez Live.
- **Un appendice appartient à une seule édition à la fois.** On le relie à Live ou à Test. Pendant Jarvis Development, les nouveaux appendices sont reliés à **Test**. Les enceintes restent réservées à Live.
- **Sur la carte, jamais de port en dur.** L'adresse et le port du PC arrivent au moment où on relie l'appendice (par le câble USB, comme l'enceinte), ou par l'annonce du PC sur le réseau.
- **Un appendice qui bouge n'obéit qu'à un seul Jarvis.** Il lit son état et accepte « stop » des deux, mais ne prend ses ordres que de celui auquel il est relié. Le robot et l'imprimante sont des objets uniques : si Live et Test les pilotaient en même temps, personne ne saurait qui a lancé quoi.
- **Les modèles Ollama sont partagés** entre Live et Test, comme aujourd'hui. Un modèle de vision suivra la même règle.

### 3.7 Les règles de sécurité, noir sur blanc

**Jarvis seul**

1. Jarvis n'agit **seul** que **dans le sens de la sécurité** : mettre en pause, arrêter, couper. Une action faite seul n'a jamais le droit d'être plus risquée que de ne rien faire.
2. Il **prévient toujours** : ce qu'il a fait, pourquoi, et comment revenir en arrière. Sur le PC, le téléphone et l'enceinte. Et il l'écrit dans un journal de ce qu'il a fait seul.
3. Il choisit d'abord l'action **la plus douce** : la pause (on peut reprendre) avant l'annulation, l'annulation avant la coupure du courant.
4. Dans le doute, il **prévient sans agir**. On mesure d'abord ses fausses alertes ; on le laisse agir ensuite.

**L'accord de l'utilisateur**

5. Tout ce qui **démarre, chauffe ou fait bouger** demande l'accord de l'utilisateur, à chaque fois, par une carte de confirmation sur le PC ou le téléphone.
6. Seule exception : une **règle permanente** que l'utilisateur a écrite ou validée lui-même, une fois, en clair. Elle dit une condition précise et une action précise. Elle se relit, se coupe et s'efface à tout moment.
7. Une règle permanente ne peut **jamais** : lancer une impression, faire rouler le robot, faire bouger un bras, relâcher un arrêt d'urgence. (Peut-elle régler le chauffage dans des bornes fixées ? C'est une décision de l'utilisateur, section 8.)
8. **Depuis une enceinte : jamais d'accord donné, jamais de lancement.** Une enceinte n'a pas d'écran pour lire la carte. Elle peut arrêter, jamais démarrer.

**Les caméras**

9. Les images sont **traitées en local** : sur la carte, sur le Pi du robot ou sur le PC. **Rien dans le cloud.**
10. **Pas d'enregistrement par défaut.** Une image vit en mémoire le temps de l'analyse. Une photo n'est gardée que si l'utilisateur le demande, ou jointe à une alerte, avec une durée de vie courte.
11. **Un signe visible quand une caméra regarde** : une lumière allumée sur l'appendice pendant chaque prise de vue. Sur les cartes que l'on construit, cette lumière est commandée par le programme de la carte et par rien d'autre.
12. Une caméra se **coupe d'un geste** : un interrupteur, un volet, ou la débrancher. Jarvis dit alors « la caméra est coupée », jamais une vieille image.
13. Les images **ne vont jamais dans le dépôt**, ni dans un jeu d'entraînement, sans que l'utilisateur l'ait décidé. Elles restent sur son PC.
14. Une image n'est envoyée au téléphone que par le lien privé qui existe déjà (Tailscale), jamais par un service en ligne.

**L'électricité et les batteries**

15. Un **fusible** au plus près de chaque batterie. Une batterie au lithium a toujours sa carte de protection.
16. On ne **charge jamais sans surveillance** une batterie au lithium, et jamais sur une surface qui brûle.
17. Un **détecteur de fumée certifié** reste la vraie sécurité incendie. Les capteurs de Jarvis s'ajoutent à lui, ils ne le remplacent pas.
18. Jarvis ne touche jamais au **230 V** autrement que par une prise ou un module du commerce, certifié, monté selon sa notice.

### 3.8 Les essais sans matériel

Chaque appendice arrive avec, dès le premier jour :

- un **faux appendice** : un petit serveur ou un petit script qui suit le contrat (comme `fakeRover.testkit.ts`, `fakeMoonraker.testkit.ts` et `fake-speaker.mjs`) ;
- des **données fabriquées par les tests** : des images dessinées par le test, des mesures inventées. Jamais une vraie photo, jamais une vraie voix dans le dépôt ;
- les essais **des refus** : sans jeton, adresse hors de la maison, ordre pendant un arrêt d'urgence, appendice muet, ordre venu d'une enceinte ;
- les essais **de la sécurité** : stop au milieu d'une action, coupure du lien, résultat « bloqué », résultat non relu.

Les tests figés du chat restent verts sans régénération. Sans appendice relié, le catalogue d'outils et les consignes du chat sont ceux d'avant.

### 3.9 Détails techniques (pour le développeur)

Proposition de contrat, version 1. Les noms suivent ceux du robot, en français.

**Appendice qui agit (Jarvis l'appelle)** — routes servies par l'appendice :

| Route | Jeton | Rôle |
| --- | --- | --- |
| `GET /api/sante` | non | Répond, donne la version et le mode (`simulation` ou non). |
| `GET /api/hello` | oui | Présentation : `contrat`, `id`, `genre`, `nom`, `piece`, `version`, `risque`, `capacites`. |
| `GET /api/etat` | non | État : `etat` (`pret`, `occupe`, `arrete`, `arret_urgence`, `erreur`), `action` en cours, `derniere_action`, `alertes`, `mesures`, `alimentation`, `limites`. |
| `POST /api/<action>` | oui | Lance une action bornée. Rend `{ action: { id, type, statut, message, mesure, duree_s } }`. |
| `POST /api/stop` | non | Arrête l'action en cours. Sans effet s'il n'y en a pas. Rend l'état. |
| `POST /api/arret_urgence` | non pour l'activer, **oui pour le relâcher** | Verrouille ; `{ actif: false }` relâche. |

Statuts d'une action, les mêmes mots que le robot : `en_cours`, `termine`, `interrompu`, `remplace`, `bloque`, `erreur`, plus `refuse`. Le client du PC les traduit vers `ToolResult.outcome` (`success`, `recoverable`, `definitive`, `timeout`, `cancelled`).

**Appendice qui sent ou parle (il appelle Jarvis)** — routes servies par le pont du PC :

| Route | Rôle |
| --- | --- |
| `GET /api/appendice/hello` | Le PC se présente : nom, version, édition, version du contrat. |
| `POST /api/appendice/etat` | Signe de vie toutes les 30 à 60 s, avec les mesures. La réponse peut porter une information à afficher, comme `X-Jarvis-Ecran`. |
| `POST /api/appendice/evenement` | Quelque chose vient d'arriver : porte ouverte, présence, fumée, bouton. |

Mêmes gardes que le pont des enceintes : adresse distante privée sinon 403, `Authorization: Bearer` sinon 401, corps borné (413), une requête à la fois par appendice (429), comparaison du jeton en temps constant.

**Où ranger le code** (proposition) :

- `packages/core/src/appendices/` : schémas Zod du contrat, contrôle des adresses (généraliser `checkRoverBaseUrl`), niveaux de risque, règles permanentes, textes des cartes. Sans Electron.
- `apps/desktop/src/main/appendices/` : registre, pont, clients, service de surveillance.
- `apps/desktop/src/main/tools/` : les outils, ajoutés en fin de catalogue, avec `isAvailable` (absents tant que rien n'est relié).
- `firmware/jarvis-<appendice>/` : un projet PlatformIO par carte, sur le modèle de `firmware/jarvis-speaker/`. Le code commun (Wi-Fi, installation par USB, jeton, annonce du PC, signe de vie) devrait devenir une bibliothèque partagée entre les cartes.
- `robot/<programme>/` : un programme séparé par fonction sur le Pi du robot, sur le modèle de `robot/voix/`.

**Annonce sur le réseau** : `_jarvis-appendice._tcp`, avec l'édition et le genre dans les champs de texte, seulement si le pont est ouvert, comme `_jarvis-speaker._tcp`.

**Aucune dépendance native au bureau.** Les caméras arrivent par HTTP (une image JPEG), les capteurs par HTTP, la domotique par HTTP. Un programme tiers sous licence GPL ou AGPL (voir section 10) ne tourne que comme **programme séparé**, jamais lié à l'application, comme espeak-ng dans Piper.

---

## 4. La carte des appendices

Pour chaque appendice : à quoi il sert, les programmes, ce qui existe et ce qui manque, de quoi il dépend, le risque et les sécurités. Les pièces et les prix sont dans `docs/materiel/electronique-appendices.md`.

### 4.1 Les YEUX

**À quoi ça sert.** Voir ce qui se passe sans se déplacer, et laisser Jarvis surveiller.

- « Jarvis, montre-moi l'impression. »
- « Est-ce que l'impression se passe bien ? »
- « Le plateau est vide ? »
- « Qu'est-ce qu'il y a devant le robot ? »
- « Lis-moi ce qui est écrit sur l'écran de l'imprimante. »
- « Qu'est-ce qui est écrit sur mon écran ? » (sans caméra : c'est une capture de l'écran du PC)
- « Préviens-moi si l'impression se décolle. »

Trois yeux, plus un qui existe déjà :

| Œil | Où | Pour quoi |
| --- | --- | --- |
| Œil de l'imprimante | fixé sur l'imprimante, face au plateau | surveiller, montrer, vérifier le plateau |
| Œil du robot | à l'avant du robot | voir les objets à ranger, se repérer |
| Œil du bureau ou d'une pièce | posé, avec un volet | à la demande seulement ; à décider (section 8) |
| Écran du PC | — | existe : `take_screenshot` |

**Les programmes.**

| Où | Programmes et sous-programmes |
| --- | --- |
| **a) Sur la carte** | **Imprimante** : si la caméra est une webcam USB branchée sur l'ordinateur de Klipper, il n'y a rien à écrire : le service de caméra de Klipper la sert déjà, et Moonraker en donne l'adresse. Si c'est une petite caméra Wi-Fi (ESP32 avec caméra) : programme `jarvis-oeil` — prise d'une image à la demande, témoin lumineux, `hello`, état, pas de flux continu, rien d'enregistré. **Robot** : sur le Pi, un programme séparé du pilotage (`robot/oeil/`) — prise d'image, puis sur place les repères visuels et, plus tard, les objets. |
| **b) Sur le PC** | Client « œil » : va chercher une image, la garde en mémoire seulement. **Surveillance de l'impression** : une boucle lente qui lit l'état par Moonraker et une image toutes les 10 à 30 s. **Analyse** en trois étages : 1) des règles sans modèle (erreur de Klipper, température qui s'écarte, progression bloquée, image noire) ; 2) un petit détecteur sur le processeur du PC ; 3) à la demande seulement, un petit modèle « vision + langage » pour décrire une image. **Alerte** : phrase sur l'enceinte, message et photo sur le PC et le téléphone. |
| **c) Dans le cœur** | Le contrat d'un œil (image, témoin, vie privée). La **machine de surveillance** : tout va bien → doute → pause → alerte → annulation au bout du délai choisi. Outils proposés : `oeil_regarder` (sûr : montre l'image et la décrit), `oeil_etat`, `imprimante_surveiller` (une règle permanente à valider une fois). Règle express, sans modèle : « montre-moi l'impression ». Depuis une enceinte : une phrase courte, l'image va sur le PC ou le téléphone. |
| **d) Essais sans matériel** | Une **fausse caméra** qui sert des images dessinées par le test. Le faux Moonraker qui annonce une webcam. Un **banc de surveillance** qui rejoue une impression (températures qui dérivent, erreur, image figée) et vérifie : pause, alerte, annulation après le délai, aucune action sur un simple doute. La mesure des **fausses alertes** se fait sur un dossier de photos qui reste sur le PC de l'utilisateur. |

**Ce qui existe.** Le client Moonraker (état, pause, annulation). La capture de l'écran du PC. Le téléphone et l'enceinte pour prévenir. La manœuvre « décharger le modèle de langage, travailler, le recharger » du module images. Le moteur de calcul qui fait déjà tourner Whisper et le mot de réveil sur le processeur.

**Ce qui manque.** Une caméra sur l'imprimante et une sur le robot. Le chemin de l'image jusqu'à Jarvis. La boucle de surveillance. Le détecteur d'impression ratée (Model Development). Une façon de **prévenir le téléphone quand l'appli est fermée** (décision, section 8). À noter : l'application refuse aujourd'hui la caméra à sa fenêtre (`mediaPermissions.ts`). C'est une bonne règle : les yeux passent par le réseau local, pas par la fenêtre.

**Dépendances.** Il dépend du client Moonraker (lot B, dans Test) et du contrat commun. Dépendront de lui : la surveillance autonome de l'imprimante, la pince (voir l'objet), les jambes (se repérer), l'atelier 3D à la voix (« le plateau est-il vide ? » avant tout lancement à distance).

**Risque : lire seulement.** Sécurités : les règles des caméras (3.7, points 9 à 14). Une surveillance qui ne voit plus rien (caméra muette, image noire) le dit ; elle ne dit jamais « tout va bien ».

### 4.2 Les BRAS

**À quoi ça sert.** Prendre et poser de petites choses.

- « Jarvis, range les trois briques dans la boîte. »
- « Ramasse ce qui est devant toi. »
- « Lâche. » « Ouvre la pince. »
- Plus tard, sur le bureau : « Passe-moi le tournevis. »

**Le bras du robot existe déjà sur le papier : c'est le bras treillis V1, conçu par l'utilisateur.** Il est pris tel quel, à la place de la « pince simple » de la première version de ce cahier (correction du 19 novembre 2026).

| | Bras treillis V1 |
| --- | --- |
| Structure | Deux segments en treillis de **150 mm**, imprimés en **PETG** |
| Articulations | Base, épaule, coude, poignet : quatre servos |
| Servos | Base, coude et poignet : **25 kg** ; épaule : **35 kg**. **Déjà achetés.** |
| Pince | Deux mâchoires, sur un servo **MF90** |
| Masse | Environ **540 g** |
| Charge | **250 g**, à moins de **25 cm** de l'épaule |
| Électronique prévue | Carte **PCA9685** ; alimentation des servos de **6,8 à 7,4 V**, **10 A au moins** ; le MF90 en **5 à 6 V** |

Le **bras de bureau** (un petit bras à six moteurs, d'un modèle ouvert) reste une idée pour plus tard, seulement si l'envie est là. Il ouvre la porte à l'apprentissage par démonstration (Model Development).

Trois points à connaître :

- Le robot **ne tourne pas sur place** (rayon de braquage d'environ 0,5 m). Il lui est difficile de se placer au centimètre devant un objet. Le bras rattrape une partie de l'écart grâce à sa portée, mais la règle reste : des objets choisis pour ça (légers, de 3 à 6 cm, posés au sol dans une zone dégagée), et une approche en ligne droite.
- Ces servos **ne disent rien** : ni leur position réelle, ni leur effort. Le bras ne sait pas tout seul s'il tient l'objet ou s'il force. Il faut donc une vérification à part : un petit contact dans la pince, ou la caméra qui regarde.
- Un servo de 25 ou 35 kg **peut pincer et faire mal**, et un bras de 540 g qui n'est plus alimenté **retombe**. La sécurité du bras (plus bas) en tient compte.

**L'alimentation des servos et sa protection.**

- Les servos ont **leur propre alimentation** (6,8 à 7,4 V, 10 A au moins), jamais le 5 V du Pi.
- Le MF90 de la pince a **son propre régulateur de 5 à 6 V**. La carte PCA9685 distribue une seule tension à toutes ses sorties : le MF90 ne prend donc que son **signal** sur la carte, et son alimentation à part. Toutes les masses sont reliées.
- **Un fusible** sur la ligne qui alimente les servos, au plus près de la batterie. Son calibre dépend de la batterie (décision A10) ; l'ordre de grandeur est 10 à 15 A.
- **Une coupure par l'arrêt d'urgence** : le bouton coupe l'alimentation des servos **par le câblage**, sans passer par un programme. Bouton enfoncé, les servos n'ont plus de courant, même si le Pi ou l'ESP32 est planté. Si le contact du bouton ne supporte pas 10 A, il commande un relais (bouton enfoncé : bobine sans courant, relais ouvert).
- À vérifier sur la carte PCA9685 avant de câbler : ses pistes ne sont pas forcément prévues pour 10 A. Si elles ne le sont pas, l'alimentation des gros servos est distribuée à part et la carte ne porte que les signaux.

**Les programmes.**

| Où | Programmes et sous-programmes |
| --- | --- |
| **a) Sur la carte** | Sur l'ESP32 du robot, ou sur une petite carte ajoutée, qui commande la PCA9685 : chaque articulation a une **vitesse limitée**, des **butées** logicielles (angles permis), une montée en douceur ; les gestes de base (`repos`, `ouvrir`, `fermer`, `tendre`, `replier`) ; le chien de garde. Sur stop : le bras **se fige**, servos toujours alimentés (il ne lâche pas et ne tombe pas). Sur arrêt d'urgence : l'alimentation des servos est **coupée** par le câblage ; le bras retombe, et le programme le sait (il repartira de la position de repos, lentement). |
| **b) Sur le PC et sur le Pi** | Sur le Pi, un programme séparé (`robot/bras/`), à côté du pilotage : il sert le contrat et enchaîne le geste complet (approcher, saisir, vérifier que l'objet est tenu, aller, poser, vérifier). L'enchaînement vit sur le Pi, près des capteurs, pas sur le PC : le Wi-Fi ne doit jamais être dans la boucle d'un geste. Sur le PC : le client du robot gagne quelques ordres. |
| **c) Dans le cœur** | Outils proposés : `rover_grip` et `rover_release` (confirmés, sans catégorie, comme `rover_move`), `rover_tidy` (« ranger » : la carte montre **quel objet** et **où**), et le stop qui existe. Règles : jamais depuis une enceinte ; au début, chaque départ est confirmé ; zone de travail obligatoire ; charge de 250 g au plus. |
| **d) Essais sans matériel** | Le mode simulation du robot gagne un **faux bras** : quatre articulations avec leurs butées, un objet saisi s'il est à portée (25 cm), un objet qui peut tomber, une charge trop lourde refusée. Tests : objet absent, objet hors de portée, pince bloquée, objet perdu en route, stop au milieu du geste (le bras se fige), arrêt d'urgence (le bras retombe, puis repart du repos), lien coupé. |

**Ce qui existe.** Le robot, son service, le stop et l'arrêt d'urgence, les outils `rover_*`, le mode simulation. Pour le bras : sa conception, et les quatre gros servos.

**Ce qui manque.** L'impression des pièces, la carte PCA9685, l'alimentation des servos avec son fusible et sa coupure, le régulateur du MF90 (et le MF90 lui-même s'il n'est pas déjà là : à confirmer), le contact de la pince, la caméra, la reconnaissance des objets, la zone de travail. Le détail et les prix sont dans le document matériel, section 2.2.

**Dépendances.** Il dépend des jambes (s'approcher), des yeux (voir l'objet), du contrat. Pour reconnaître les objets : au début, des objets **marqués** (une couleur vive ou un repère imprimé), sans entraînement ; plus tard un modèle (Model Development).

**Risque : bouger.** Sécurités : une vitesse lente et des butées ; une charge limitée à 250 g ; un fusible sur l'alimentation des servos ; le bouton d'arrêt d'urgence qui la coupe par le câblage ; une zone délimitée, sans personne à portée du bras ; jamais depuis une enceinte ; chaque départ confirmé au début.

### 4.3 Les JAMBES

**À quoi ça sert.** Que le robot se déplace seul dans une zone qu'il connaît.

- « Jarvis, envoie le robot à sa base. »
- « Viens au bureau. »
- « Où est le robot ? » « Il lui reste de la batterie ? »
- « Arrête-toi. »

**Ce qui manque pour qu'il se déplace seul**, du plus urgent au moins urgent :

1. **Sentir un obstacle** : un ou deux capteurs de distance à l'avant, et un pare-chocs à contact. Aujourd'hui le robot ne détecte un obstacle que quand ses roues se bloquent.
2. **Un réflexe sur la carte** : c'est l'ESP32 qui coupe les moteurs sous une certaine distance, sans demander ni au Pi ni au PC. Un réflexe ne passe jamais par le Wi-Fi.
3. **Savoir où il est** : il compte déjà ses tours de roue, mais l'erreur grandit. Il lui faut des **repères** : de petits carrés imprimés collés à des endroits connus, vus par sa caméra. Pas cher, et suffisant pour une pièce.
4. **Une zone et des points connus** : « base », « bureau », « boîte de rangement ». On les lui apprend en le conduisant une fois. Et une clôture : il refuse de sortir de la zone.
5. **Rentrer à la base** : s'aligner sur le repère de la base et s'arrêter dessus.
6. **Se recharger** : des contacts sur la base, ou plus simplement un câble qu'on branche à la main au début.
7. **Une carte complète de la pièce** (avec un capteur laser tournant) : le meilleur choix à terme, mais un gros morceau de logiciel. Pas avant que le reste marche.

**Les programmes.**

| Où | Programmes et sous-programmes |
| --- | --- |
| **a) Sur la carte** | ESP32 du robot : lecture des capteurs de distance et du pare-chocs ; **arrêt réflexe** ; refus d'avancer si l'obstacle est déjà là ; batterie basse → refus de partir. Ces règles vivent sur la carte et ne se désactivent pas depuis Jarvis. |
| **b) Sur le Pi et sur le PC** | Sur le Pi, dans le service du robot (hors de ce dépôt) : position corrigée par les repères, points connus, « aller à », clôture, procédure de retour à la base, simulation. Sur le PC : le client du robot gagne `aller_a`, `base`, `points`. |
| **c) Dans le cœur** | Outils proposés : `rover_goto` (confirmé : la carte dit **où** et **par où**), `rover_dock` (confirmé), `rover_where` (sûr). Les limites existantes restent (0,3 m/s, distance maximale par ordre). Batterie basse : le robot **s'arrête et prévient** ; il ne rentre seul à la base que si une règle permanente le lui permet. |
| **d) Essais sans matériel** | Le simulateur du robot gagne une **pièce en deux dimensions** avec des obstacles et des repères. Tests : un obstacle apparaît → arrêt ; repère perdu → arrêt et « je ne sais plus où je suis » ; sortie de zone refusée ; batterie basse ; retour à la base réussi et raté. |

**Ce qui existe.** Avancer et tourner d'une distance mesurée, position estimée, tension et courant de la batterie, limites, stop, arrêt d'urgence, simulation, la voix du robot avec son « stop » sur place.

**Ce qui manque.** Les sept points ci-dessus.

**Dépendances.** Il dépend des yeux du robot (repères), du contrat. Dépendront de lui : la pince (s'approcher d'un objet), tout « va chercher ».

**Risque : bouger.** Sécurités : le réflexe sur la carte, la vitesse lente, le pare-chocs, la clôture, le bouton d'arrêt d'urgence, le fusible sur la batterie, chaque départ confirmé, jamais depuis une enceinte.

### 4.4 Les OREILLES et la VOIX

Elles existent : les enceintes, le micro du PC, le robot qui écoute. Voici **seulement ce qui manque**.

| Ce qui manque | Pourquoi | Où ça se construit |
| --- | --- | --- |
| **Couper Jarvis sur le PC** | Aujourd'hui le micro n'entend plus rien d'utile pendant que Jarvis parle : il s'entend lui-même. Il faut l'**annulation d'écho** : retirer du micro ce que Jarvis est en train de dire. | D'abord en logiciel, sans rien acheter (le moteur de la fenêtre sait le faire, et on peut l'activer **sans** remettre le réglage automatique du volume coupé en 0.4.16 — à mesurer). Si la mesure est mauvaise : un haut-parleur-micro USB qui le fait lui-même. |
| **Couper Jarvis depuis l'enceinte** | Même raison. La carte de l'enceinte sait retirer l'écho si on lui donne le son qu'elle joue comme référence. | Dans le programme de l'enceinte, et peut-être une carte avec deux micros. C'est un changement du contrat des enceintes : il lui faut son cahier. |
| **Une enceinte qui parle sans qu'on lui parle** | Pour qu'une alerte soit dite (« j'ai mis l'impression en pause »). Aujourd'hui une enceinte ne parle qu'en réponse. | Une « annonce » que l'enceinte vient chercher avec son signe de vie. Changement du contrat : cahier. |
| **Plus d'enceintes** | Une par pièce. | Rien à écrire : les mêmes pièces, le même programme. Quand deux enceintes entendent la même phrase, le PC doit n'en garder qu'une. |
| **La voix du robot** | Le Pi n'a pas de prise audio. | Un haut-parleur-micro USB, déjà prévu dans `robot/voix/`. |
| **Entendre autre chose que des mots** | Le détecteur de fumée qui sonne, l'imprimante qui claque. | Plus tard. Noté pour Model Development. |

**Les programmes** (pour couper Jarvis) :

| Où | Programmes et sous-programmes |
| --- | --- |
| **a) Sur la carte** | Enceinte : garder le micro ouvert pendant la lecture, retirer l'écho avec le son joué comme référence, garder le mot de réveil actif pendant la lecture, arrêter le son dès que la parole est détectée. |
| **b) Sur le PC** | Annulation d'écho du micro (sans réglage automatique du volume) ; détection de la parole pendant la synthèse ; arrêt net de la voix ; reprise de l'écoute avec le début de la phrase gardé. |
| **c) Dans le cœur** | La discussion gagne un état « interrompu » ; « non, attends » annule le tour en cours ; mesure du temps entre la parole et le silence de Jarvis. |
| **d) Essais sans matériel** | Des sons fabriqués par les tests : la voix de Jarvis mélangée à une parole. On vérifie que la parole est détectée et que la voix seule ne déclenche rien. |

**Dépendances.** C'est l'objectif « Vraie conversation » de la feuille de route (étapes 1 et 4). Il s'appuie sur les mesures de la mission « Jarvis plus rapide, sans nouveau modèle ».

**Risque : agir (parler).** Sécurités : celles des enceintes, inchangées. Une enceinte ne donne jamais d'accord.

### 4.5 Les SENS

**À quoi ça sert.** Savoir ce qui se passe dans la maison, et être prévenu.

- « Il fait combien dans la chambre ? »
- « L'air est bon dans le bureau ? »
- « La porte d'entrée est fermée ? »
- « Préviens-moi si quelqu'un entre dans l'atelier. »
- « Il fait combien près de l'imprimante ? »

| Sens | Ce qu'il mesure | Remarque |
| --- | --- | --- |
| Température et humidité | l'air d'une pièce | le plus simple, le premier à faire |
| Présence | quelqu'un est là, même immobile | un petit radar, pas une caméra : il ne voit pas qui |
| Qualité de l'air | le CO2 (il faut aérer), les poussières | utile dans un bureau fermé et près de l'imprimante |
| Fumée | un début d'incendie | **un détecteur certifié, toujours** ; Jarvis s'y ajoute |
| Porte ou fenêtre ouverte | un contact | simple et fiable |

Deux façons de faire, qui peuvent se mélanger :

- **Des capteurs que l'on construit** : une petite carte à quelques euros avec ses capteurs, qui suit le contrat et appelle Jarvis. Le moins cher, et tout reste chez soi.
- **Des capteurs du commerce** sans fil (Zigbee), à pile, déjà en boîtier : plus propres, mais il leur faut un récepteur et un logiciel entre eux et Jarvis (voir 4.6).

**Les programmes.**

| Où | Programmes et sous-programmes |
| --- | --- |
| **a) Sur la carte** | Programme `jarvis-sens` : la base réseau de l'enceinte (Wi-Fi, installation par USB, jeton, signe de vie), lecture des capteurs, envoi de l'état toutes les 30 à 60 s, envoi **immédiat** d'un événement (porte, présence, fumée). |
| **b) Sur le PC** | Le **pont des appendices** : reçoit états et événements, garde la dernière valeur de chaque capteur et un court historique local. Un petit **moteur d'alertes** par règles (seuils, « depuis combien de temps »). |
| **c) Dans le cœur** | Outil proposé : `capteurs_lire` (sûr). Règle express sans modèle : « il fait combien dans… ». Les seuils, les unités, les phrases. Le briefing du matin peut dire la température de la maison. Les règles permanentes peuvent partir d'un capteur. |
| **d) Essais sans matériel** | Un **faux capteur** (un script, comme la fausse enceinte) qui envoie des valeurs fabriquées. Tests : seuil franchi, capteur muet (« je n'ai plus de nouvelles depuis 10 minutes », jamais une vieille valeur donnée comme actuelle), valeur absurde écartée. |

**Ce qui existe.** Le modèle du pont (celui des enceintes), les routines, le briefing, le bilan de santé.

**Ce qui manque.** Tout le reste : la carte, le pont, les outils.

**Dépendances.** Il dépend du contrat et du pont. Dépendront de lui : les règles permanentes, la sécurité de l'imprimante (fumée, température), le confort (aérer, chauffer).

**Risque : lire seulement.** Sécurités : la fumée ne dépend jamais de Jarvis seul. Sur une alerte fumée, Jarvis prévient partout, met l'impression en pause et coupe la prise de l'imprimante : c'est dans le sens de la sécurité.

### 4.6 Les MAINS SUR LA MAISON

**À quoi ça sert.** Allumer, éteindre, régler.

- « Allume la lampe du bureau. » « Éteins tout dans le salon. »
- « Coupe l'imprimante. »
- « Mets 19 degrés dans la chambre. »
- « La machine à laver a fini ? » (une prise qui mesure le courant le sait)

**Home Assistant ou en direct ?** Recommandation : **en direct d'abord, Home Assistant quand la maison grandit.**

| | En direct | Par Home Assistant |
| --- | --- | --- |
| Ce que c'est | Jarvis parle lui-même à chaque appareil, par le réseau local | Un logiciel libre de domotique parle aux appareils ; Jarvis parle à Home Assistant |
| Pour | Rien à installer, rien d'allumé en plus, simple à comprendre, tout de suite | Des milliers d'appareils, le sans-fil Zigbee et Matter, des capteurs à pile, le chauffage |
| Contre | Seulement les appareils qui ont une vraie interface locale documentée | Il lui faut une machine allumée en permanence, et un deuxième tableau de bord à entretenir |
| Bon pour | 2 à 6 appareils : la prise de l'imprimante, deux lampes | Plus de 6 appareils, des capteurs sans fil, les radiateurs |

Pourquoi cet ordre : le Raspberry Pi 5 est pris par le robot, et le PC est sous Windows. Home Assistant demande donc une petite machine en plus. Ce n'est pas justifié pour une prise et deux lampes. Et rien n'est perdu : côté Jarvis, les outils `maison_*` sont les mêmes ; seul l'adaptateur change.

**Les programmes.**

| Où | Programmes et sous-programmes |
| --- | --- |
| **a) Sur la carte** | Rien à écrire : ce sont des appareils du commerce. (Une carte maison ne commute jamais du 230 V.) |
| **b) Sur le PC** | Un **adaptateur** par famille : `prise locale` (interface locale du fabricant), plus tard `Home Assistant` (une seule adresse, un seul jeton). Chaque ordre est **relu** : après « éteins », l'adaptateur relit l'état de la prise. |
| **c) Dans le cœur** | Outils proposés : `maison_etat` (sûr), `maison_allumer` et `maison_eteindre`, `maison_chauffage`. Chaque appareil est **déclaré** avec ce qui est branché dessus : une lampe (sûr), un appareil qui chauffe (allumer = confirmé), un appareil **à ne jamais couper** (congélateur, box, PC). Le chauffage a des bornes que l'utilisateur fixe. |
| **d) Essais sans matériel** | Une **fausse prise** et un **faux Home Assistant** de test. Tests : ordre relu, appareil muet, appareil « à ne jamais couper » refusé, chauffage hors bornes refusé, ordre venu d'une enceinte. |

**Ce qui existe.** Le modèle du client local avec son faux appareil (Moonraker, robot), les confirmations, le coffre des clés.

**Ce qui manque.** Les appareils, les adaptateurs, les outils, la déclaration de ce qui est branché.

**Dépendances.** Il dépend du contrat. Dépendront de lui : la coupure de l'imprimante en dernier recours, les règles permanentes, le confort.

**Risque : agir (lumières), ou chauffer (chauffage, prise d'un appareil qui chauffe).** Sécurités : éteindre est toujours permis, sauf la liste « à ne jamais couper » ; allumer un appareil qui chauffe est confirmé ; le chauffage reste entre ses bornes ; rien qui demande un accord ne part d'une enceinte.

### 4.7 Les ÉCRANS

**À quoi ça sert.** Voir d'un coup d'œil, sans demander.

- « Affiche le minuteur sur l'enceinte. » (existe en 5.0.79 : `afficher_sur_enceinte`)
- Près de l'imprimante : la progression, la température, « surveillance active », et un gros bouton **Pause**.
- Sur le robot : sa batterie, ce qu'il est en train de faire.

| Écran | État | Remarque |
| --- | --- | --- |
| Écran de l'enceinte (OLED 1,3 pouce) | existe (5.0.79 préparée) | mascotte, heure, informations du PC |
| Fenêtre du PC, téléphone | existent | le téléphone peut déjà servir de tableau de bord posé sur un support |
| **Panneau d'atelier** près de l'imprimante | à faire | un petit écran tactile avec sa carte intégrée, quelques euros |
| **Témoin de caméra** | à faire | une lumière : obligatoire avec les yeux (3.7) |
| Écran du robot | plus tard | batterie, état |
| Affichage à encre électronique | plus tard | le briefing, les notes ; ne consomme presque rien |

**Les programmes.**

| Où | Programmes et sous-programmes |
| --- | --- |
| **a) Sur la carte** | Programme `jarvis-ecran` : affiche des **cartes d'affichage** envoyées par le PC (un titre, une ou deux lignes, une barre de progression, une durée). Boutons tactiles limités à ce qui est sûr : **Pause** et **Stop**. |
| **b) Sur le PC** | La file d'affichage par écran, qui existe pour les enceintes, généralisée à tout écran. |
| **c) Dans le cœur** | L'en-tête `X-Jarvis-Ecran` devient un cas particulier d'une « carte d'affichage ». Outil proposé : `afficher_sur_ecran`. Ce qui s'affiche tout seul : la progression d'une impression, une alerte, un minuteur. |
| **d) Essais sans matériel** | Un **faux écran** qui relit la carte d'affichage comme la carte le ferait (le cœur a déjà `parseSpeakerScreenHeader` pour ça). |

**Dépendances.** Il dépend du contrat. Les yeux dépendent du témoin de caméra.

**Risque : agir (sans danger).** Sécurités : un écran tactile peut **arrêter**, il ne **donne pas d'accord** — sauf décision contraire de l'utilisateur (section 8).

### 4.8 Les autres appendices utiles

**La FABRIQUE (l'imprimante 3D).** Elle existe, et c'est elle qui fabriquera les supports, les boîtiers et la pince. C'est aussi l'appendice le plus risqué : elle chauffe et elle bouge, souvent sans personne à côté. Ce qui lui manque pour que Jarvis la surveille :

- un œil (4.1) et son éclairage ;
- une **prise qui mesure et qui coupe** (4.6) : le dernier recours, et aussi « l'impression est finie » ;
- un **détecteur de fumée** tout près (4.5) ;
- la vérification « **le plateau est vide** » avant tout lancement à distance.

Les protections de Klipper lui-même (il coupe la chauffe s'il la voit s'emballer) restent la première ligne de défense. Jarvis s'ajoute, il ne les remplace pas. L'ordre des gestes de Jarvis : **pause**, puis **annulation**, puis **arrêt d'urgence de Klipper**, puis **coupure de la prise** (seulement sur fumée, ou si Klipper ne répond plus alors que ça chauffe).

**L'ÉNERGIE.** Les coupures de courant du 13 novembre ont abîmé des fichiers d'état. Deux appendices simples :

- un **onduleur** (une batterie de secours pour le PC) relié en USB : Jarvis sait qu'il y a une coupure, met l'impression en pause, enregistre, et le dit au retour du courant ;
- des **prises qui mesurent** : savoir qu'une machine a fini, repérer un appareil qui consomme trop.

Risque : lire, et agir dans le sens de la sécurité.

**Le TOUCHER (les boutons).** Un bouton, c'est un accord donné avec la main, à l'endroit où l'on voit ce qui se passe :

- un bouton **« Tout arrêter »** sur le bureau ;
- le **bouton d'arrêt d'urgence** du robot, câblé sur l'alimentation des moteurs ;
- peut-être un bouton **« Oui »** près de l'imprimante : Jarvis demande « le plateau est vide, je lance ? », et l'accord se donne devant la machine. Ce n'est pas une enceinte : le bouton prouve que quelqu'un est là et regarde. À décider (section 8).

**La TÉLÉCOMMANDE (infrarouge).** Pour une télévision ou un climatiseur qui ne connaissent que leur télécommande. Utile seulement s'il y en a ; plus tard.

---

## 5. Où faire tourner la vision

Les chiffres (mémoire, vitesse, prix) et leurs sources sont dans `docs/materiel/electronique-appendices.md`, section « Où faire tourner la vision ». L'idée, en clair :

Il n'y a pas une vision, mais trois, et elles n'ont pas les mêmes besoins.

| Vision | Rythme | Où | Coût |
| --- | --- | --- | --- |
| **Surveiller** (l'imprimante, une pièce) | une image toutes les 10 à 30 s | le **processeur du PC** | 0 € |
| **Regarder à la demande** (« que vois-tu ? », lire un écran) | une image, de temps en temps | un petit modèle « vision + langage » : sur le processeur du PC, ou sur la RTX 2060 **à la place** du modèle de langage, le temps de l'image (la manœuvre du module images) | 0 € |
| **Voir en roulant** (le robot) | plusieurs images par seconde | le **Pi 5 du robot**, d'abord sans accélérateur | 0 €, puis un module IA seulement si la mesure le demande |

**Recommandation : ne rien acheter pour la vision au début.** La RTX 2060 reste aux modèles de langage. On mesure d'abord ; le module IA du Pi 5 est le premier achat si le robot voit trop lentement. Une carte à part (du type Jetson) n'est pas justifiée aujourd'hui.

Une règle ne dépend pas du matériel : **la sécurité du robot ne passe jamais par la vision ni par le Wi-Fi.** Elle passe par ses capteurs de distance, son pare-chocs et son bouton, sur sa carte.

---

## 6. L'ordre de construction proposé

Chaque étape est **utile seule** et **essayable dans Jarvis Test**. Elle commence toujours par son faux appendice, sans rien acheter. Les coûts sont des relevés du 17 novembre 2026, hors frais de port et hors petites pièces sans prix relevé ; le détail et les sources sont dans le document matériel, section « Récapitulatif ». L'étape 6 a été rechiffrée le 19 novembre 2026 (relevés du 18 novembre). Total des étapes 1 à 7 : **233,17 €** au moins cher, **476,65 €** au meilleur choix, plus les outils si rien n'est déjà là (116,77 € à 295,07 €).

| Étape | Ce qu'on construit | Ce que l'utilisateur gagne | Objectif de la feuille de route | Coût relevé (moins cher → meilleur choix) |
| --- | --- | --- | --- | --- |
| **0. Le socle** | Le contrat commun, le registre, le pont, un faux appendice, « arrête tout ». Aucun achat. | Rien de visible. Tout le reste s'y branche. | Tous | 0 € |
| **1. L'imprimante sous surveillance** | Une caméra sur l'imprimante, une prise qui mesure et coupe, un détecteur de fumée. Surveillance par règles (sans modèle) : erreur de Klipper, température, progression. | « Montre-moi l'impression. » Une alerte avec la photo. La pause automatique sur un vrai problème. Le début du dossier de photos. | **Jarvis autonome, étapes 1 et 2** | 78,66 € → 133,56 € (minimum : caméra et prise, 43,67 €) |
| **2. Couper Jarvis sur le PC** | L'annulation d'écho, d'abord en logiciel. | On peut lui couper la parole. | **Vraie conversation, étape 1** | 0 € ; un haut-parleur-micro USB (48 à 113 €) seulement si la mesure est mauvaise |
| **3. Les sens** | Une première carte de capteurs (température, humidité, présence, puis CO2), un contact de porte. | « Il fait combien dans la chambre ? » Des alertes. | Jarvis autonome (les règles ont des yeux partout) | 27,34 € → 69,94 € |
| **4. Les mains sur la maison** | Deux ou trois lampes et prises, en direct. | « Allume la lampe du bureau. » | Usage de tous les jours | 23,68 € → 47,36 € |
| **5. Le robot voit et se protège** | Caméra du robot, capteurs de distance, pare-chocs, repères imprimés. | Le robot s'arrête avant l'obstacle. Il sait où il est. | **Jarvis autonome, étape 3** (préparation) | 43,46 € → 112,21 € |
| **6. Le bras** | Le bras treillis V1 de l'utilisateur : pièces imprimées en PETG, les quatre servos déjà achetés, la pince sur son MF90, la carte PCA9685, l'alimentation des servos avec **son fusible et sa coupure par l'arrêt d'urgence**. D'abord le faux bras, puis le vrai bras essayé seul sur l'établi, puis monté sur le robot. | Le robot range 2 ou 3 petits objets (250 g au plus) dans une zone connue. | **Jarvis autonome, étape 3** | 60,03 € → 83,63 € (servos déjà achetés ; MF90 et PETG non comptés) |
| **7. Couper Jarvis depuis l'enceinte** | L'annulation d'écho sur la carte. Les annonces. | On lui coupe la parole depuis la chambre. Il peut prévenir à voix haute. | **Vraie conversation, étape 4** | 0 € (essai sur la carte actuelle) → 29,95 € |
| **8. Le robot rentre et se recharge** | La base, le retour, la recharge. | Le robot est toujours prêt. | Jarvis autonome (suite) | non chiffré : dépend de la batterie actuelle |
| **Plus tard** | Panneau d'atelier, onduleur, Home Assistant, carte complète de la pièce, bras de bureau. | Du confort. | — | voir le document matériel |

Pourquoi cet ordre :

- **L'étape 1 d'abord** : c'est la moins chère, elle répond au premier objectif de « Jarvis autonome », et le client Moonraker est déjà écrit. Elle marche **sans modèle entraîné** : une erreur de Klipper ou une température qui dérive se lisent par des règles. Le détecteur d'impression ratée viendra s'y brancher (Model Development), une fois le dossier de photos rempli.
- **L'étape 2 ne coûte peut-être rien** : c'est du logiciel. Mais la feuille de route la place après Jarvis Test et la carte de l'utilisation. Elle est listée ici pour que le matériel soit prêt.
- **Les étapes 5 et 6 vont ensemble** : un bras sans yeux ni capteurs ne range rien. Elles sont les plus longues ; elles passent après les gains rapides.
- **L'étape 0 n'achète rien** et peut commencer dès que la feuille de route le dit.

### Idées en attente

Notées pour ne pas les perdre. Aucune n'est dans l'ordre de construction, aucune n'est chiffrée.

| Idée | Ce que c'est | Ce qu'il faudrait trancher avant |
| --- | --- | --- |
| **Décoller une pièce du plateau avec une spatule** | Le bras, équipé d'une spatule, décolle une impression finie du plateau de l'imprimante. | Le bras est sur le robot et le plateau est en hauteur : portée et placement. Le plateau doit être froid (une règle, pas un modèle). La force pour décoller dépasse peut-être la charge de 250 g. Une lame près d'une machine : zone sans personne, chaque geste confirmé. |
| **Le boîtier « œil de pièce »** (mis de côté le 17 novembre 2026) | Un Raspberry Pi 5 2 Go, une caméra grand angle montée sur un servo de 180°, et la détection faite par le Pi lui-même. Un œil qui balaie une pièce. | La décision A8 (une caméra dans une pièce de vie, les pièces interdites, le volet, le témoin lumineux). Les règles des yeux s'appliquent telles quelles : images traitées sur place, rien d'enregistré par défaut. |

---

## 7. Ce qui dépend de quoi

```
Contrat commun + registre + pont (étape 0)
 ├─ Yeux ── imprimante ──► surveillance autonome ──► règles permanentes
 │    │                         ▲
 │    │        prise qui coupe ─┤   (mains sur la maison)
 │    │      détecteur de fumée ┘   (sens)
 │    └─ robot ──► repères ──► jambes (se repérer, rentrer à la base)
 │                    └──────► bras (voir l'objet, ranger)
 ├─ Sens ──► alertes, règles permanentes, briefing
 ├─ Mains sur la maison ──► coupure de l'imprimante, confort
 ├─ Écrans ──► témoin de caméra (obligatoire pour les yeux), panneau d'atelier
 └─ Oreilles et voix ──► annonces (une alerte dite) ──► vraie conversation

Client Moonraker (lot B, dans Test) ──► yeux de l'imprimante, surveillance
Table des éditions (dans Test)       ──► tous les ports des appendices
Model Development (plus tard)        ──► impression ratée, objets à ranger
```

---

## 8. Les décisions à prendre (par l'utilisateur, avec Claude)

| # | Décision | Proposition de ce cahier |
| --- | --- | --- |
| A1 | **Sur quoi tourne Klipper** (un Raspberry Pi, un boîtier du commerce, autre), et y a-t-il un port USB libre ? | Port libre : une webcam USB. Sinon : une petite caméra Wi-Fi. |
| A2 | **La vision sans achat au début** (processeur du PC, Pi 5 du robot), un accélérateur seulement si la mesure le demande ? | Oui. |
| A3 | **La maison en direct d'abord**, Home Assistant plus tard ? Et quel est le **type de chauffage** ? | En direct d'abord (des appareils Wi-Fi qui parlent au PC). Le chauffage et les capteurs sans fil à pile (Zigbee) viendront avec Home Assistant. |
| A4 | **Les lumières sans carte de confirmation**, comme Spotify ? | Oui, sinon la voix est inutilisable. Les prises d'appareils qui chauffent restent confirmées. |
| A5 | **Une règle permanente peut-elle régler le chauffage** dans des bornes fixées ? (La feuille de route dit « jamais une règle qui chauffe » ; la mission dit « sauf une règle permanente validée ».) | Oui pour le chauffage du logement, entre deux bornes. Jamais pour l'imprimante, le robot ni un bras. |
| A6 | **Prévenir le téléphone quand l'appli est fermée** : une notification passe par les serveurs d'Apple (texte chiffré, sans photo). L'accepter, ou s'en tenir au PC et aux enceintes ? | À décider. Sans elle, l'alerte est dite par les enceintes et s'affiche à l'ouverture de l'appli. |
| A7 | **Un bouton « Oui » près de l'imprimante** vaut-il un accord ? | Oui, pour l'imprimante seulement, et seulement pendant que Jarvis pose la question. |
| A8 | **Une caméra dans une pièce de vie** : en veut-on une ? Quelles pièces sont interdites ? | Seulement à la demande, avec volet. Pas dans une chambre. |
| A9 | **Le bras** : **décidé le 19 novembre 2026.** C'est le bras treillis V1 de l'utilisateur (section 4.2), pas une pince simple. Reste à confirmer : le MF90 est-il déjà là ? | — |
| A10 | **La batterie du robot** aujourd'hui : type, tension, protection, chargeur ? | À relever avant de choisir la recharge. |
| A11 | **Les outils déjà possédés** : fer à souder, multimètre ? | La liste des outils du document matériel se réduit d'autant. |
| A12 | **Un appendice = une seule édition**, les nouveaux reliés à Test ; port du pont = base + 8. | Oui. |
| A13 | **La licence du dépôt.** Il est public mais n'a pas de fichier de licence. Tant que ce n'est pas décidé, un programme GPL ou AGPL ne peut tourner que comme programme séparé. | Garder cette règle, quelle que soit la licence choisie. |
| A14 | **L'ordre de construction** de la section 6. | À valider ou à changer. |

---

## 9. Pour Model Development

Hors de cette mission. Ces besoins sont seulement notés, avec ce qu'il faudrait pour les mesurer.

| Besoin | Pour quel appendice | Ce qu'il faudra |
| --- | --- | --- |
| **Reconnaître une impression ratée** (« spaghetti », pièce décollée, buse qui traîne un amas) | Yeux de l'imprimante | Un dossier de photos de **son** imprimante, réussies et ratées, rempli pendant l'étape 1. Mesurer les fausses alertes avant de laisser Jarvis agir. |
| **Dire si le plateau est vide** | Fabrique, atelier 3D à la voix | Des photos du plateau vide et occupé, sous plusieurs lumières. |
| **Reconnaître les 2 ou 3 objets à ranger** et la boîte | Bras, yeux du robot | Des photos de ces objets au sol, vus par la caméra du robot. Au début, des objets marqués suffisent, sans modèle. |
| **Choisir un petit modèle « vision + langage »** pour décrire une image et lire un écran | Yeux | Un examen tiré de vraies demandes, sur le matériel de l'utilisateur. Probablement une mesure, pas un entraînement. |
| **Savoir que c'est à Jarvis de parler**, en français (« euh… attends ») | Oreilles et voix | Vérifier d'abord si un détecteur ouvert existant suffit en français. |
| **Entendre un détecteur de fumée sonner**, ou un bruit anormal de l'imprimante | Oreilles | Des modèles ouverts de reconnaissance de sons existent ; à évaluer avant d'entraîner. |
| **Apprendre un geste par démonstration** | Bras de bureau | Seulement s'il y a un bras de bureau. Loin. |
| **Une seconde carte graphique ?** | Tous les modèles | La RTX 2060 est pleine avec le modèle de langage. Une carte de 12 ou 16 Go changerait surtout les modèles de langage : c'est à Model Development d'en juger, chiffres du document matériel à l'appui. |

Un point de départ relevé : un grand jeu ouvert de photos d'impressions existe (CAXTON, université de Cambridge, licence CC BY), mais ses étiquettes sont des réglages d'impression, pas « ratée » ou « réussie ». Aucun jeu ouvert d'impressions ratées n'a pu être vérifié pendant cette étude : les photos de l'imprimante de l'utilisateur resteront la base.

Règles déjà écrites dans la feuille de route, qui s'appliqueront : jamais un texte ni une image produits par Claude ou Cursor dans un jeu d'entraînement ; l'examen n'est jamais entraîné ; les données de l'utilisateur restent sur son PC.

---

## 10. Licences relevées

Les licences des bibliothèques et des modèles cités sont vérifiées et notées dans `docs/materiel/electronique-appendices.md`, section « Licences ». Trois règles en découlent :

1. **Ouvert seulement** : bibliothèques et modèles ouverts, licence vérifiée à la source avant tout usage.
2. Un programme sous **GPL ou AGPL** n'est jamais lié à l'application : il tourne à côté, comme programme séparé, et on lui parle par le réseau local.
3. Un modèle marqué **« non commercial »** ou **« recherche seulement »** n'entre pas dans Jarvis.

---

## 11. Ce que ce cahier ne fait pas

- Il n'écrit aucun code et ne change aucun comportement de Jarvis Live ni de Jarvis Test.
- Il ne modifie pas `FEUILLE-DE-ROUTE.md` : les objectifs cités y sont déjà ; l'ordre proposé ici attend une décision.
- Il ne change pas le contrat des enceintes (`/api/speaker/*`).
- Il n'achète rien : les prix sont des relevés datés, à revérifier au moment de commander.
