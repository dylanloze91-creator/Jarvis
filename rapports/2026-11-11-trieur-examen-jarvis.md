# Trieur : examen avec les vraies phrases Jarvis — 11 novembre 2026

Branche `claude/trieur-examen-reel` (à partir de `origin/claude/trieur-entrainement-1`), fusionnée par `claude/integration-5075`. Chiffres seulement : aucune phrase de l'utilisateur dans ce rapport ni dans le dépôt. Trieur **non activé**.

## Examen

| | |
| --- | --- |
| Source | conversations Jarvis du PC (`%APPDATA%\@jarvis\desktop\conversations`), par `trieur:extraire` sans l'export claude.ai |
| Phrases disponibles | 220 (texte tapé et dictées), dont 96 écartées à la main (transcriptions sans sens, mots isolés, boucles de Whisper, variantes d'une même demande d'image) |
| Fichier d'examen | `C:\dev\jarvis-data\trieur\examen-jarvis.jsonl` (hors dépôt), 124 phrases triées à la main par l'utilisateur sur la page `trieur:trier --examen jarvis` (publiée sur son téléphone par `tailscale serve`) |
| Phrases pour le banc | 108 : les 11 « pas une demande » et les 5 « je ne sais pas » sont écartées par `filterExamForBench`, comme pour l'examen principal |
| Protection | `trieur:generer` et `trieur:preparer` lisent tous les `examen*.jsonl` du dossier (`listExamFiles`) : ces phrases n'entrent jamais dans le cahier d'entraînement |

Répartition des 108 phrases : images 19, web 19, musique 18, PC 16, conversation 15, code 10, Google 7, mémoire 2, concentration 1, fichiers 1. Google, mémoire, concentration et fichiers ont trop peu de phrases pour une mesure par équipe.

## Correction du banc, avant la mesure

Le premier passage du banc donnait 0/19 en images et 0/18 en musique pour les quatre modèles. Cause, dans `packages/core/src/trieur/bench.ts` : la liste d'outils fictifs qui rend les équipes « disponibles » contenait `play_spotify`, qui ne satisfait pas le motif `spotify_*` de l'équipe Musique, et aucun `generer_image` pour l'équipe Images. Le modèle ne voyait donc que 8 équipes sur 10, et 37 phrases sur 108 étaient perdues d'avance. Corrigé (`BENCH_TOOLS`, test `bench.test.ts` : les 10 équipes du chef d'orchestre sont proposées). Les scores publiés avant cette correction (53/140 et 36/140 dans `rapports/2026-11-11-trieur-entrainement-1.md`) portaient le même biais ; voir « Ancien examen, banc corrigé » plus bas.

Avant correction, pour mémoire : `qwen2.5:7b` 42/108, `qwen2.5:3b` 31/108, `jarvis-trieur` 22/108, `qwen2.5:1.5b` 22/108.

## Résultats (banc corrigé, 108 phrases, tri à froid)

Commande : `npm run trieur:banc --workspace @jarvis/core -- --dir C:\dev\jarvis-data\trieur --examen jarvis --model qwen2.5:7b,jarvis-trieur,qwen2.5:3b,qwen2.5:1.5b`. Rapport brut : `rapports/2026-11-11-trieur-banc-jarvis.json` / `.txt`. Même consigne que le cerveau du chef d'orchestre (`routerSystemPrompt`), température 0, 12 jetons.

| Modèle | Entraîné | Justes | Illisibles | Chargement | Par phrase | Carte |
| --- | --- | --- | --- | --- | --- | --- |
| `qwen2.5:7b` (cerveau actuel) | non | **76/108 (70 %)** | 0 | 16,4 s | 420 ms | 79 % |
| `qwen2.5:3b` | non | 60/108 (56 %) | 5 | 2,1 s | 93 ms | 100 % |
| `jarvis-trieur` (Qwen2.5-1.5B + QLoRA) | **oui** | 45/108 (42 %) | 0 | 3,3 s | 81 ms | 100 % |
| `qwen2.5:1.5b` (sa base) | non | 38/108 (35 %) | 14 | 1,7 s | 66 ms | 100 % |

Par équipe (justes / phrases) :

| Équipe | Phrases | `qwen2.5:7b` | `jarvis-trieur` | `qwen2.5:3b` | `qwen2.5:1.5b` |
| --- | --- | --- | --- | --- | --- |
| Images | 19 | 19 | 10 | 15 | 13 |
| Web | 19 | 15 | 0 | 11 | 6 |
| Musique | 18 | 15 | 12 | 8 | 4 |
| PC | 16 | 9 | 6 | 9 | 4 |
| Conversation | 15 | 7 | 9 | 10 | 9 |
| Code | 10 | 7 | 7 | 5 | 0 |
| Google | 7 | 3 | 0 | 1 | 0 |
| Mémoire | 2 | 1 | 1 | 1 | 1 |
| Concentration | 1 | 0 | 0 | 0 | 1 |
| Fichiers | 1 | 0 | 0 | 0 | 0 |

Ce que l'entraînement a apporté (`jarvis-trieur` contre `qwen2.5:1.5b`, même taille) : +7 phrases justes (45 contre 38), plus aucune réponse illisible (0 contre 14), Musique 12 contre 4, Code 7 contre 0. Ce qu'il a coûté : Web 0 contre 6 (ses 19 phrases web partent en Google 6, conversation 6, PC 5, code 2), Images 10 contre 13.

Lecture des confusions principales :

- `qwen2.5:7b` : PC → fichiers 6 fois (le seul vrai trou), conversation éparpillée (7/15), Google → conversation ou PC 4 fois.
- `jarvis-trieur` : Web jamais reconnu (0/19), Google → mémoire 5 fois, PC → conversation 7 fois, Images → musique 4 fois.
- `qwen2.5:3b` : Musique → conversation 5 et web 4, PC → fichiers 5, 5 réponses illisibles.
- `qwen2.5:1.5b` : 14 réponses illisibles, Code → conversation 6, Musique éparpillée (4/18).

## Ancien examen, banc corrigé

Le banc corrigé repassé sur l'examen principal (`examen.jsonl`, 140 phrases de l'export claude.ai, plus 10 validées en direct ; rapport brut `rapports/2026-11-11-trieur-banc-corrige.json`) :

| Modèle | Avant correction (rapport du matin) | Banc corrigé | Illisibles | Validées en direct |
| --- | --- | --- | --- | --- |
| `qwen2.5:7b` | 53/140 | 51/140 (36 %) | 0 | 8/10 |
| `jarvis-trieur` | 36/140 | 35/140 (25 %) | 1 | 7/10 |
| `qwen2.5:3b` | — | 56/140 (40 %) | 0 | 4/10 |
| `qwen2.5:1.5b` | — | 59/140 (42 %) | 0 | 1/10 |

Deux choses se lisent. D'abord, la correction du banc change peu les scores sur cet examen-là : les phrases de l'export claude.ai sont presque toutes de la discussion et des questions, sans musique ni image. Ensuite, sur cet examen le petit modèle non entraîné fait mieux que le cerveau 7B, à l'inverse de l'examen Jarvis : ses 44 phrases classées « web » sont pour la plupart des questions de discussion, que le 7B envoie en conversation (39 erreurs sur 44 relevées à l'écran le matin). Cet examen mesure donc surtout la règle « web ou conversation » du classement, pas le modèle. L'examen Jarvis (vraies phrases dites ou tapées à Jarvis, triées par l'utilisateur) est la mesure à garder ; la règle à retenir pour « web » reste à fixer par l'utilisateur (proposition : web seulement si la personne veut une recherche sur Internet), et les 44 lignes de l'ancien examen à reclasser ensuite.

## Décision

- Le trieur reste **non activé** (`orchestra.router` absent) : `jarvis-trieur` fait 5 fois plus vite que le cerveau mais se trompe presque deux fois plus souvent (42 % contre 70 %), et ne reconnaît aucune demande web.
- Le cahier d'entraînement (`entrainement.jsonl`, phrases du professeur `qwen2.5:7b`) ne ressemble pas assez aux vraies phrases : les transcriptions Whisper, les demandes d'image et les questions web de l'utilisateur sont sous-représentées. Prochaine étape raisonnable : une nouvelle nuit de `trieur:generer` qui tire aussi des phrases Images et des tournures orales, puis un second entraînement ; l'examen Jarvis reste à part et sert de mesure.
- Le cerveau actuel (`qwen2.5:7b`) perd surtout sur PC → fichiers : à regarder dans la consigne des deux équipes (`TEAM_SPECS`) avant de toucher au modèle.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npm run build -w @jarvis/core ; banc lancé sur les 4 modèles, 2 passages)
Types     : OK (0 erreur, repris par release.sh pour la 5.0.75)
Style     : OK (0 avertissement)
Tests     : OK (bench.test.ts 3/3 dont le nouveau ; files.test.ts 4/4 ; sortServer.test.ts ; suite complète par release.sh)
Secrets   : OK (aucune phrase de l'utilisateur dans le dépôt : rapports JSON et Markdown chiffres seulement, examen dans C:\dev\jarvis-data\trieur)
Fichiers modifiés : packages/core/src/trieur/{files,bench,sortServer}.ts et tests, packages/core/scripts/trieur-{extraire,trier,banc,generer,preparer}.mjs, rapports/2026-11-11-trieur-banc-jarvis.{json,txt}, rapports/2026-11-11-trieur-banc-corrige.{json,txt}, ce rapport, CLAUDE.md, AGENTS-COORDINATION.md
Prêt à fusionner : FAIT (par claude/integration-5075, voir rapports/2026-11-11-publication-5075.md)
À corriger : rien pour le trieur ; le trieur n'est pas activé
Testé en vrai (à la voix, sur le PC) : PAS FAIT (le banc rejoue les phrases hors de Jarvis ; aucun réglage de Jarvis ne change)
```
