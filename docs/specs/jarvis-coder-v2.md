# Cahier des charges — jarvis-coder v2 : un artisan, quatre compétences

Rédigé par Claude pour Cursor, le 11 novembre 2026. À lire d'abord : `docs/specs/specialistes.md` (la règle de la fiche), puis dans `CLAUDE.md` les sections 5.0.55 à 5.0.65.

## Pourquoi

L'équipe de développeurs de Jarvis compte 7 rôles, tenus par **2 cerveaux** :
- le **chef** (`qwen3-coder:30b`, sans entraînement) fait les plans et l'architecture ;
- l'**artisan** (jarvis-coder, de 7 à 9 milliards de paramètres) écrit, corrige, teste et relit.

Aujourd'hui, jarvis-coder v1 ne sait faire qu'une chose : écrire du code à partir d'un énoncé (79/87 à l'examen, contre 69 pour sa base). La v2 doit savoir les quatre.

## Résultat du banc du 12 novembre (à lire avant tout le reste)

Banc `lab:compare`, catalogue d'évaluation, 29 missions × 3 passages, RTX 2060 (`rapports/2026-11-12-banc-equipe-dev.md`, branche `claude/banc-equipe-dev`) :

| Modèle | Score | Niveau 3 | Appels illisibles | Jetons/s |
| --- | --- | --- | --- | --- |
| qwen2.5-coder:7b (base de la v1) | 69/87 | 9/12 | 3 | 17,3 |
| jarvis-coder (v1) | 79/87 | 9/12 | 0 | 17,8 |
| Seed-Coder-8B | 75/87 | 9/12 | 0 | 14,2 |
| **Ornith-1.0-9B Q4_K_M** (MIT) | **84/87** | **12/12** | 0 | 13,2 |

Ce qu'on en tire :

1. **Base de la v2 : Ornith-1.0-9B**, si la chaîne d'entraînement le supporte. C'est une architecture Qwen3.5 : vérifie à la source la version de `transformers`, le gabarit de chat avec outils, `peft` sur ses couches et la conversion `llama.cpp`. Si la chaîne actuelle (transformers 4.57.6, llama.cpp b12032) ne le prend pas, propose les versions à épingler, avec un essai `--dry-run` sur un petit modèle de la même famille. Sinon, repli sur Qwen2.5-Coder-7B. L'option `--base` reste le seul endroit où la base est choisie.
2. **L'examen « écrire » est presque saturé.** Ornith fait 84/87, autant que le 30B, et la seule mission ratée est un piège connu (`l2-need-name`). Il ne permettra plus de voir un progrès sur cette compétence. **Ne modifie pas** le catalogue d'évaluation (les mesures deviendraient incomparables). Ajoute plutôt un **second examen « écrire », plus dur et tenu à l'écart** (`evalCatalogHard()` : niveau 3, plusieurs fichiers, cas limites), construit comme le premier (solution de référence jamais entraînée, contrôles du catalogue). Les examens « corriger », « tester » et « relire » (point 4) deviennent la vraie mesure de la v2.
3. **Seuil pour adopter la v2** : meilleure que la base Ornith sur au moins deux des quatre compétences, et aucune perte de plus de 2 missions sur « écrire ».

## La fiche

| Compétence | Rôle dans Jarvis Développeur | L'exemple montre | Vérification sans modèle | Source |
| --- | --- | --- | --- | --- |
| **Écrire** | CODER | énoncé + départ → fichiers de la solution | tests cachés verts deux fois (déjà en place) | professeur ouvert (`lab:generate`) |
| **Corriger** | DEBUGGER, CODER | code avec **un** bogue + **vraie sortie** des tests rouges → fichier corrigé | le bogue est une erreur glissée (`mutantsOf`) que les tests **attrapent** ; la réponse est la solution d'origine, verte | **dérivée** des exercices acceptés, sans modèle |
| **Tester** | TESTER | énoncé + solution → fichier de tests `node:test` | les tests sont ceux du professeur, gardés seulement s'ils sont verts sur la solution et attrapent **au moins 60 %** des erreurs glissées | **dérivée**, sans modèle |
| **Relire** | REVIEWER | un changement (diff) → avis au **format exact du schéma REVIEWER** (`verdict`, `issues[{severity, file, line, message}]`, `recommendations`) | moitié de diffs **piégés** (une erreur glissée et attrapée : on connaît le fichier, la ligne et la règle), moitié de diffs **sains** (départ → solution d'un exercice réussi) | **dérivée**, sans modèle |

Points importants :
- **Trois compétences sur quatre se fabriquent sans aucun modèle**, à partir du cahier qui existe déjà (exercices acceptés, tests et solutions du professeur). C'est rapide, gratuit et sûr.
- **Règle des données, inchangée** : aucun texte écrit par Claude ou par Cursor dans les réponses d'entraînement. Les réponses sont les fichiers du professeur, ou des données mécaniques. Le `message` d'un avis de relecture n'est donc **pas une phrase rédigée**, mais une trace mécanique de l'erreur : « ligne 12 : `a >= b` devenu `a > b` (règle >=/>) ». Et `recommendations` reste vide.
- **Les diffs sains** donnent `verdict: "ok"` et `issues: []`. Sans eux, le modèle apprendrait à toujours crier au bogue.

## À livrer

1. **Dérivation** (`packages/core/src/developer/labDerive.ts`, pur, et `scripts/lab-derive.mjs`, `npm run lab:derive --workspace @jarvis/core -- --dir <jarvis-data>`). Le script lit `exercices.jsonl` et écrit dans `derives/` : `corriger.jsonl`, `tester.jsonl`, `relire.jsonl`, `ecartes.jsonl` (avec la raison) et `resume.json`.
   - Chaque exemple est **vérifié en vrai** (`node --test` dans un dossier jetable), comme `runtimeCheck`.
   - Au plus 2 exemples « corriger » et 2 « relire » par exercice, pour ne pas noyer le cahier sous un seul thème.
   - Déterministe : même entrée, même sortie, avec une graine.
   - **Nouveaux fichiers seulement.** Ne touche pas à `lab-generate.mjs` : la mission « flotte » y ajoute `--slice`.
2. **Format des exemples** : même conversation que `trainingExampleFromFiles`, en reprenant le `write_file` de Jarvis pour écrire, corriger et tester. Pour relire, une réponse JSON validée par `reviewerSchema` avant d'être gardée. Le message de l'utilisateur reprend la consigne du rôle **telle que Jarvis Développeur la donne vraiment** (`ROLE_FORMATS`, `planSystemPrompt`…), pour que le modèle entraîné reconnaisse ses vraies missions.
3. **Préparation** : `lab:prepare` (ou une option) mélange les quatre compétences selon des proportions réglables (défaut : écrire 40 %, corriger 25 %, tester 15 %, relire 20 %). Le découpage entraînement / validation se fait par **thème entier**, comme aujourd'hui. Les contrôles de contamination de l'examen s'appliquent aussi aux exemples dérivés.
4. **Examen par compétence**, tenu à l'écart : `evalCatalog()` (les 29 missions, solutions de référence **jamais** entraînées) sert à dériver un examen « corriger », un « tester » et un « relire » de la même façon. `lab:compare` donne **un score par compétence** (base contre candidat) et garde le verdict global d'aujourd'hui pour « écrire ». Seuil « meilleur » par compétence : au moins +10 % et pas de perte de plus de 5 % sur « écrire ».
5. **Entraînement** : `train_lora.py` accepte les données mélangées sans changement de fond : la perte reste sur la réponse de l'assistant seulement. La base vient d'une option `--base` (le choix se fera au banc : Qwen2.5-Coder-7B, Seed-Coder-8B ou Ornith-9B, selon la licence et les scores). Rien n'est fixé en dur. Un `--dry-run` sur le petit modèle de test doit passer.
6. **Guide** `training/JARVIS-CODER-V2.md`, en français simple : dériver, préparer, entraîner sur une carte louée (avec la flotte si elle existe, sinon avec `nuit_generation.sh`, qu'on peut adapter), exporter, examiner, décider.

## Tests

- `labDerive.test.ts` :
  - erreur glissée non attrapée → écartée ;
  - « corriger » contient la vraie sortie rouge ;
  - « tester » sous 60 % → écarté ;
  - « relire » piégé : bonne ligne et bon fichier ;
  - « relire » sain : `ok` ;
  - JSON conforme à `reviewerSchema` ;
  - déterminisme ;
  - aucun exemple tiré de l'examen ;
  - au plus 2 par exercice.
- `lab:compare` par compétence : faux rapports.
- Python (`training/tests/`) : les données mélangées passent le masque de perte.
- Inchangés : `__golden__` jamais régénérés, `profiles/jarvis.test.ts`, et `parseSettings({})` sans nouvelle clé.

## Livraison

- Branche `cursor/jarvis-coder-v2` depuis `origin/main`, inscrite dans `AGENTS-COORDINATION.md`. N'y touche pas : `training/cloud/` (flotte), `speaker/`, `firmware/`, `market/`, `session.ts`.
- Un commit par point, tests verts, puis `typecheck`, `test` et `lint`.
- Rapport, avec les chiffres de dérivation sur un **petit cahier synthétique** (marqué `synthetique-test`), puis le RAPPORT DE VÉRIFICATION.
- Aucun entraînement lancé, aucun modèle téléchargé, pas de fusion. Claude relit, puis Claude Code dérive sur le vrai cahier et l'entraînement part sur une carte louée.
