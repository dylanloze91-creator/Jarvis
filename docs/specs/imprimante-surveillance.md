# Cahier des charges : l'imprimante sous surveillance (Jarvis Development, étape 1)

Écrit par Claude (le chat, manager) le 19 novembre 2026. Mission pour **Claude Code**.
S'appuie sur : `docs/specs/jarvis-development.md` (sections 3, 4.1, 6), le socle des appendices
(`claude/socle-appendices`, rapport `rapports/2026-11-19-socle-appendices.md`) et le client
Moonraker du lot B (dans `claude/dev`).

Objectif de la feuille de route servi : **Jarvis un peu autonome**, étapes 1 et 2. Jarvis suit une
impression, voit quand elle part mal, met en pause, prévient, et annule si personne ne répond.

## 0. En bref, pour l'utilisateur

- Une webcam USB est branchée sur l'ordinateur de Klipper (le Raspberry Pi 5 aujourd'hui, la BTT Pi
  plus tard). Une prise connectée qui mesure la consommation alimente l'imprimante.
- Jarvis peut **montrer l'impression** (« montre-moi l'impression ») et **la surveiller** pendant
  qu'elle tourne.
- La surveillance ne demande **aucun modèle d'IA** au début : elle lit ce que Klipper dit
  (erreurs, températures, avancement) et ce que la prise mesure, et elle regarde si la caméra
  voit encore quelque chose.
- Sur un vrai problème : **pause**, puis alerte avec la photo, puis **annulation** si tu ne
  réponds pas dans le délai que tu as choisi. La coupure de la prise vient **en tout dernier**,
  seulement si Klipper ne répond plus du tout alors que l'imprimante chauffe encore.
- Jarvis ne lance, ne reprend et ne chauffe jamais rien tout seul.
- Une webcam est déjà branchée sur Klipper (dit par l'utilisateur le 19 novembre). Il faut acheter seulement la prise (Shelly Plug S Gen3,
  environ 24 €). Prix relevés le 17 novembre, à revérifier.
- Hors Jarvis, et dans tous les cas : **un détecteur de fumée certifié près de l'imprimante**.
  C'est la vraie sécurité ; Jarvis vient en plus, jamais à la place.

## 1. Ce qui ne bouge pas

- **Jarvis Test seulement**, coupé par défaut. Live ne change pas. Branche
  `claude/imprimante-surveillance`, partie de `claude/socle-appendices` (qui contient `claude/dev`).
- `parseSettings({})` ne gagne aucune clé. Aucun `__golden__` régénéré. Tests figés intacts
  (`chat-unchanged`, `ollama-unchanged`, `orchestra-session`, `machineProfile`).
- Aucune dépendance native. Aucun modèle ajouté. Aucune image ni photo dans le dépôt.
- Réseau local seulement (même règle que le robot et les appendices). Aucun service en ligne.
- **Les sécurités de Klipper restent la première ligne de défense** (`verify_heater`, limites de
  température, arrêt sur erreur). Jarvis ne les remplace pas et ne les modifie pas.
- Aucun fichier de configuration de Klipper, de Moonraker ou de la prise n'est modifié par Jarvis.
  S'il faut régler quelque chose là-bas, le rapport donne la marche à suivre à l'utilisateur.

## 2. Le matériel et comment Jarvis lui parle

| Pièce | Comment Jarvis la lit | Comment Jarvis agit |
| --- | --- | --- |
| Klipper par Moonraker (existe) | état de l'impression, températures, avancement, erreurs | pause, annulation, arrêt d'urgence (`M112` / `printer/emergency_stop`) |
| Webcam USB sur l'ordinateur de Klipper | Moonraker donne l'adresse de l'image fixe (`/server/webcams/list`, `snapshot_url`) ; le service caméra de MainsailOS la sert déjà | aucune action |
| Prise Shelly Plug S Gen3 | son interface locale (état, puissance en watts) | couper ; **rallumer seulement après une carte** |

Points à vérifier par Claude Code avant d'écrire le code, avec la documentation officielle :

1. Les adresses exactes de l'interface locale des prises Shelly de 3e génération (état, puissance,
   couper), et l'authentification si un mot de passe est posé sur la prise.
2. Le format de `/server/webcams/list` de Moonraker et l'adresse d'image fixe servie par MainsailOS.
3. **La coupure ne passe pas par Moonraker.** Moonraker tourne sur le même ordinateur que Klipper :
   s'il ne répond plus, il ne pourra pas couper. Le PC parle à la prise **directement**. Le réglage
   `[power]` de Moonraker, s'il existe chez l'utilisateur, n'est pas utilisé pour la coupure de
   secours.

La prise et la caméra entrent dans le **registre des appendices** du socle par un **adaptateur côté
PC** (elles ne parlent pas le contrat de Jarvis) : la prise comme appendice de genre `energie`
(risque `agir`), la caméra comme `oeil` (risque `lire`). Elles apparaissent dans Réglages →
Appendices comme les autres.

## 3. Ce que Jarvis sait faire

### 3.1 Montrer

- « Montre-moi l'impression », « Est-ce que l'impression se passe bien ? » : règle express sans
  modèle → une image fixe, l'état (pourcentage, temps restant, températures) en une phrase.
- Depuis une **enceinte** : la phrase seulement ; l'image va sur le PC (et le téléphone si l'appli
  est ouverte).
- L'image n'est gardée qu'en mémoire, le temps de l'afficher. Rien n'est écrit sur le disque, sauf
  le dossier de photos (3.5) si l'utilisateur l'a activé.

### 3.2 Surveiller

La surveillance est une **règle permanente** que l'utilisateur active une fois (carte de
confirmation qui dit exactement ce qu'elle fera, avec le délai d'annulation choisi). Elle ne tourne
que pendant une impression. Rythme : état Klipper toutes les 10 s, image toutes les 30 s, prise
toutes les 10 s.

Signaux, **tous sans modèle** :

| Signal | Comment il se lit | Gravité |
| --- | --- | --- |
| Klipper en erreur ou arrêté (`shutdown`, `error`) | état de Moonraker | problème (Klipper a déjà coupé ses chauffes) : alerte, pas de pause à faire |
| Impression en pause sans que Jarvis l'ait demandé | état de l'impression | information : on prévient seulement |
| Température qui s'écarte de la consigne | écart de plus de 15 °C pendant plus de 90 s, consigne non nulle | doute, puis problème s'il dure 3 min |
| Avancement bloqué | pourcentage et durée d'impression qui ne bougent plus pendant 10 min alors que l'état dit « en cours » | problème |
| La caméra ne voit plus rien | image noire, ou image identique au pixel près sur 5 prises de suite, ou caméra muette | **doute seulement** ; on prévient « je ne vois plus l'imprimante », on ne dit jamais « tout va bien » |
| Moonraker ne répond plus | 3 essais ratés de suite | doute ; voir 3.4 |
| Consommation de la prise | puissance mesurée | sert de témoin : chauffe active ou non (seuil réglé au premier essai, voir 5) |

### 3.3 Ce que fait la surveillance, dans l'ordre

```
tout va bien → doute → problème confirmé → PAUSE → alerte avec photo
            → l'utilisateur répond : il décide (reprendre = carte, toujours ; annuler)
            → pas de réponse au bout du délai choisi (proposé : 10 min) → ANNULATION → alerte
```

- **Un doute seul ne déclenche jamais d'action** : il déclenche une seconde lecture, puis une
  information.
- Chaque geste est vérifié : Jarvis relit l'état après la pause et après l'annulation, et dit ce
  qu'il a constaté (« impression en pause, vérifié »), jamais seulement ce qu'il a envoyé.
- **Reprendre** une impression n'est jamais automatique : toujours une carte, jamais depuis une
  enceinte.
- Alerte : phrase sur l'enceinte qui a parlé en dernier (ou toutes, au choix), notification et
  photo sur le PC, téléphone si l'appli est ouverte. Le téléphone appli fermée attend la décision
  de l'utilisateur (cahier Jarvis Development, section 8).

### 3.4 La coupure de la prise : en tout dernier

La prise n'est coupée **automatiquement** que si **toutes** ces conditions sont vraies :

1. une impression était en cours au dernier état connu ;
2. Moonraker ne répond plus depuis 2 minutes (ou Klipper ne répond plus et Moonraker le dit) ;
3. la prise mesure encore une puissance de chauffe (au-dessus du seuil réglé) ;
4. la surveillance a été activée par l'utilisateur avec l'option « coupure de secours » (cochée à
   part, expliquée sur la carte).

Avant de couper : une alerte, puis 60 secondes. Après : relecture de la prise (« prise coupée,
vérifié ») et alerte. Si la prise ne répond pas non plus : alerte « je ne peux rien faire,
va voir l'imprimante ».

Sur demande de l'utilisateur (« coupe l'imprimante ») : **carte**, parce que la coupure détruit
l'impression. Rallumer : **toujours une carte**, jamais depuis une enceinte, jamais automatique.

### 3.5 Le dossier de photos (préparation de Model Development)

Option coupée par défaut : « Garder les photos des impressions pour apprendre ». Activée, elle
garde une photo toutes les 5 minutes et à chaque alerte, avec l'état de l'impression, dans un
dossier de l'utilisateur hors du dépôt (`C:\dev\jarvis-data\impressions\`), plafonné en taille.
L'utilisateur marquera plus tard les ratés : c'est la matière du futur détecteur d'impression ratée
(Model Development). Rien n'est envoyé nulle part.

### 3.6 « Jarvis, arrête tout »

L'imprimante rejoint « arrête tout » : **pause** de l'impression en cours (pas d'annulation, pas de
coupure). La phrase dite le précise (« impression en pause »).

## 4. Outils proposés au modèle (équipe Impression)

| Outil | Risque | Rôle |
| --- | --- | --- |
| `imprimante_regarder` | sûr | image fixe + état en une phrase |
| `imprimante_surveiller` | carte toujours | activer, régler ou couper la surveillance |
| `prise_etat` | sûr | allumée ou non, puissance |
| `prise_couper` | carte (sur demande) | couper l'imprimante |
| `prise_rallumer` | carte toujours, jamais depuis une enceinte | rallumer |

Les gestes automatiques de la surveillance (3.3, 3.4) ne passent pas par le modèle : ce sont des
règles du code.

## 5. Essais

**Sans matériel (dans les tests et au banc) :**
- un faux Moonraker (celui du lot B, complété : webcams, erreurs, températures, avancement) ;
- une fausse caméra (images dessinées par le test : normale, noire, figée) ;
- une fausse prise Shelly (état, puissance, coupure, et une prise qui ne répond pas) ;
- un **banc de surveillance** qui rejoue des impressions : tout va bien du début à la fin ;
  température qui dérive ; avancement bloqué ; Klipper en erreur ; caméra noire ; Moonraker muet
  avec chauffe ; Moonraker muet sans chauffe ; utilisateur qui répond ; utilisateur qui ne répond
  pas. Il vérifie : aucune action sur un doute seul, pause puis annulation au bon moment, coupure
  seulement dans le cas 3.4, chaque geste relu.

**Avec l'utilisateur (Jarvis Test, quand le matériel est là) :**
1. Brancher la webcam sur le Pi de Klipper, vérifier qu'elle apparaît dans Mainsail.
2. « Montre-moi l'impression » au clavier et à l'enceinte.
3. Prise : relier, lire la puissance à l'arrêt, en chauffe du plateau, en chauffe de la buse :
   c'est là que se règle le seuil de 3.4.
4. Surveillance activée sur une **petite impression d'essai** ; pause provoquée par Jarvis en
   simulant un signal (mode essai), vérifier la pause sur l'imprimante, puis reprendre à la main.
5. « Arrête tout » pendant une impression : pause, rien d'autre.
6. La coupure de secours n'est **pas** essayée en vrai pendant une impression chaude : seulement
   au banc, et prise coupée imprimante à froid.

## 6. Hors de cette mission

- Reconnaître une impression ratée sur l'image (« spaghetti ») : Model Development, avec le dossier
  de photos.
- Détecteur de fumée connecté : plus tard.
- Prévenir le téléphone quand l'appli est fermée : attend la décision de l'utilisateur.
- Lancer une impression à distance : jamais dans cette mission.

## 7. Ce que Claude Code rend

- La branche `claude/imprimante-surveillance`, poussée, verte (typecheck, lint, tests,
  `npx electron-vite build`).
- `rapports/AAAA-MM-JJ-imprimante-surveillance.md` : ce qui marche, ce qui est vérifié dans la
  documentation officielle (avec liens), résultats du banc, essais à faire avec l'utilisateur, et
  la liste exacte des achats.
- `CLAUDE.md` mis à jour, `AGENTS-COORDINATION.md` tenu.
