# Nuit de génération du trieur — 9 novembre 2026

Branche `claude/trieur-nuit-1`. Aucun code de l'application modifié, pas de fusion, pas de publication, pas d'entraînement. Les données vivent dans `C:\dev\jarvis-data\trieur\` (jamais commitées) ; ce rapport ne contient que des chiffres, aucune phrase.

## Ce qui a été fait

1. Contrôles : Jarvis fermé (après demande à l'utilisateur, il tournait au premier passage), `ollama ps` vide, `examen.jsonl` présent (151 lignes), ressource GPU réservée dans `AGENTS-COORDINATION.md` (commit poussé avant le lancement).
2. Génération avec le professeur `qwen2.5:7b`, objectif 2000 exemples.
3. Préparation train / validation (`trieur:preparer`).
4. Ressource GPU libérée.

## Problème rencontré : `trieur:generer` ne peut rien produire tel quel

Le script `packages/core/scripts/trieur-generer.mjs` construit le professeur avec `ollamaRouterModel` (`packages/core/src/trieur/ollamaRouter.ts`), c'est-à-dire le client prévu pour le **routeur**, qui répond par un nom d'équipe : il est plafonné à `ROUTER_MAX_TOKENS = 12` jetons et à la température 0 (`packages/core/src/trieur/bench.ts`). La réponse JSON du professeur (`{"phrase": …, "context": …, "team": …}`) est donc coupée après quelques mots et refusée « JSON illisible » à chaque essai.

Constat sur le PC : 69 essais, 69 refus « JSON illisible » en deux minutes, zéro exemple. Les 69 lignes correspondantes sont restées en tête de `rejets.jsonl` (rien n'a été supprimé dans `jarvis-data`).

Décision prise pour ne pas perdre la nuit, sans toucher au code du dépôt : une **copie du script** a été placée hors du dépôt (dossier de travail temporaire de la session) et lancée à la place. Elle importe exactement les mêmes modules compilés de `packages/core/dist/` (graines `seedFor`, consigne `teacherPrompt`, lecture `parseTeacherJson`, contrôles `validateGenerated`, clé `exactKey`, noms de fichiers, reprise sans doublon, examen obligatoire). Deux différences seulement, toutes deux sur le professeur :

- budget de réponse : 400 jetons au lieu de 12 ;
- température : 0,7 (la valeur du professeur de `lab:generate`) au lieu de 0, pour que les mêmes graines ne redonnent pas toujours la même phrase.

Un sondage préalable (6 exemples demandés) a donné 6 acceptés sur 7 essais.

**À corriger dans le dépôt** (autre branche, avec test) : donner au générateur son propre client Ollama (`maxTokens` ≥ 400, température réglable, par défaut 0,7) au lieu de `ollamaRouterModel`. Le banc (`trieur:banc`) garde ses 12 jetons : c'est lui qui juge un routeur.

## Génération

| Mesure | Valeur |
| --- | --- |
| Début / fin | 07:29 → 12:56 (9 novembre 2026) |
| Durée | 5 h 27 (327 min) |
| Exemples acceptés | 2000 (objectif atteint ; 6 du sondage + 1994) |
| Essais | 5801 (plafond 8000) |
| Taux d'acceptation | 34 % |
| Rythme | ≈ 3,4 s par essai, ≈ 9,8 s par exemple accepté |
| Professeur | `qwen2.5:7b`, 21 % processeur / 79 % carte, contexte 8192 |
| Modèle dans `meta.model` | `qwen2.5:7b` pour les 2000 |

### Exemples acceptés par équipe

| Équipe | Acceptés |
| --- | --- |
| pc | 301 |
| code | 281 |
| google | 269 |
| web | 256 |
| memoire | 210 |
| concentration | 181 |
| musique | 171 |
| conversation | 167 |
| fichiers | 164 |

Styles demandés par les graines (répartis sur les acceptés) : piège 459, suite 371, « Jarvis » 346, parlé 289, court 280, question 255.

**Équipes qui manquent de phrases** : `fichiers` (164), `conversation` (167) et `musique` (171) sont les plus basses ; `pc` en a presque le double (301). Les graines tirent les équipes à tour de rôle, donc l'écart vient des refus : `fichiers` perd 470 essais en quasi-doublons (le professeur tourne autour des mêmes demandes de dossiers et de fichiers) ; `conversation` perd 195 essais parce que le professeur écrit un autre nom que `conversation` dans le champ `team` (« équipe inconnue »). Pour la prochaine nuit : montrer au professeur les phrases déjà acceptées sur l'équipe (comme le fait le générateur d'exercices avec les objectifs du même thème) et rappeler la liste exacte des neuf noms d'équipe dans la consigne.

### Refus par cause (hors les 69 du script tronqué)

| Cause | Refus |
| --- | --- |
| Quasi-doublon (similarité ≥ 0,40 avec un exemple accepté) | 2457 |
| Désaccord avec les règles express (`expressTeam` désigne une autre équipe) | 664 |
| JSON illisible | 415 |
| Équipe inconnue (nom hors des neuf) | 271 |
| Trop proche de l'examen (contamination, similarité 0,40) | 1 |
| **Total** | **3808** |

Le contrôle de contamination n'a quasiment rien eu à écarter : le professeur n'a pas reproduit les phrases de l'examen.

Désaccords express les plus fréquents (équipe demandée → équipe désignée par les règles) : google → web 197, memoire → google 168, pc → web 62, concentration → google 60, musique → web 51, conversation → web 36. Lecture : quand on lui demande une phrase `google`, le professeur écrit souvent « cherche sur Google… », que la règle express envoie à `web` ; quand on lui demande `memoire`, il parle de rappels ou de rendez-vous, que la règle envoie à `google`. Ces refus sont corrects : l'exemple contredirait une règle fixe du chef d'orchestre.

## Préparation train / validation

Commande : `npm run trieur:preparer --workspace @jarvis/core -- --dir C:\dev\jarvis-data\trieur`.

| Mesure | Valeur |
| --- | --- |
| Lignes gardées | 2004 (2000 générées + 4 validées à la main allant à l'entraînement) |
| Entraînement (`preparation/train.jsonl`) | 1807 |
| Validation (`preparation/validation.jsonl`) | 197 |
| Phrases validées à la main versées à l'examen (`examen-valide.jsonl`) | 10 |
| Écartées | 0 (aucun fichier `ecartes.jsonl` produit) |
| Options | `maxTokens` 512, part de validation 0,1, graine 5068, minimum 80 |
| Empreinte de l'examen | notée dans `preparation/resume.json` (contrôlée par `train_lora.py`) |

Répartition par équipe : entraînement — pc 271, code 254, google 243, web 231, memoire 189, concentration 163, conversation 154, musique 154, fichiers 148 ; validation — pc 30, code 28, google 26, web 25, memoire 21, concentration 18, musique 17, conversation 16, fichiers 16.

Pas d'entraînement cette nuit : l'étape 6 de `training/TRIEUR.md` reste à lancer quand l'utilisateur le décidera.

## Fichiers dans `C:\dev\jarvis-data\trieur\` après la nuit

`entrainement.jsonl` (2000 lignes), `rejets.jsonl` (3877 lignes, dont 69 du script tronqué), `preparation/train.jsonl`, `preparation/validation.jsonl`, `preparation/examen-valide.jsonl`, `preparation/resume.json`. `a-trier.jsonl`, `examen.jsonl`, `valide.jsonl` et `trier.log` n'ont pas été modifiés. Rien n'a été supprimé.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : ÉCHEC (2913/2914 réussis, 8 ignorés ; cœur 2239/2239, bureau 674/675)
Secrets   : OK (0 trouvé)
Fichiers modifiés : AGENTS-COORDINATION.md, rapports/2026-11-09-trieur-nuit-1.md (aucun fichier de code)
Prêt à fusionner : NON
À corriger : (1) `trieur:generer` emprunte le client du routeur (12 jetons, température 0) : aucune réponse du professeur ne passe ; lui donner son propre client Ollama (voir plus haut). (2) `apps/desktop/src/main/developer/task/taskWorkflow.test.ts` « validé : copie isolée, … » a échoué une fois dans la suite complète (l'étape `pause-1:done` manquait, 23 s sous charge) et passe seul (6/6, 8 s) : test sensible au temps, à rendre déterministe. Aucun des deux n'est lié à cette nuit ; ce rapport est une branche de documentation et de coordination, rien à fusionner dans le code.
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```

Rien à tester à la voix : la nuit n'a produit que des données hors du dépôt et aucun réglage de Jarvis n'a changé (`orchestra.router` reste absent, le trieur n'existe pas encore). Le test en vrai viendra après l'entraînement (`training/TRIEUR.md`, étapes 6 à 8) : « Jarvis, mets de la musique » → équipe musique ; « Jarvis, ouvre le bloc-notes » → équipe pc ; « Jarvis, qu'est-ce que tu sais de moi ? » → équipe memoire, avec la pastille « choisi par le trieur ».

## Pour l'utilisateur, en simple

- La nuit a produit **2000 phrases d'entraînement** vérifiées pour le trieur, en 5 h 27, à partir du professeur local `qwen2.5:7b`. Elles sont prêtes dans `C:\dev\jarvis-data	rieur\preparation\` (1807 pour apprendre, 197 pour contrôler).
- Le script fourni par la version 5.0.68 ne pouvait rien produire (réponse coupée à 12 jetons) : une copie corrigée hors du dépôt a été utilisée ; le correctif dans Jarvis reste à faire.
- Les équipes les moins fournies sont **fichiers**, **conversation** et **musique** (environ 165 phrases chacune contre 300 pour **pc**) : une seconde nuit, avec la consigne améliorée, les rééquilibrerait.
- Rien n'a été entraîné, rien n'a été supprimé, Jarvis n'a pas changé.

