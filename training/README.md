# Entraîner l'élève de Jarvis (5.0.65)

Ce dossier sert à **apprendre à l'élève** (`qwen2.5-coder:7b`, le petit modèle de code local) à partir du cahier
d'exercices que le labo remplit la nuit (`entrainement.jsonl`). Le résultat est un deuxième modèle dans Ollama,
`jarvis-coder`, qui **s'ajoute** à côté de l'actuel. Rien n'est remplacé : c'est toi qui choisis, après l'examen.

Tout se passe sur ton PC (ou, en option, sur une carte louée à l'heure). Rien n'est envoyé à Claude, à Cursor
ni à personne. Aucun texte écrit par Claude ou Cursor n'entre dans l'apprentissage : seulement les exercices
que l'élève a réussis et que les vérifications ont validés.

## Quand lancer

- Quand le cahier compte **400 exercices ou plus** (`npm run lab:prepare` affiche le compte ; en dessous de 100 il refuse).
  Avant, il vaut mieux laisser la génération de nuit continuer.
- Quand **rien d'autre n'utilise la carte graphique** (pas de génération, pas de discussion avec Jarvis) : l'entraînement
  prend toute la mémoire de la carte pendant des heures. La carte se réserve dans `AGENTS-COORDINATION.md` comme pour
  le reste.

## Vue d'ensemble

| Étape | Commande (depuis le dossier du dépôt) | Où | Durée |
|---|---|---|---|
| 1. Préparer | `npm run lab:prepare --workspace @jarvis/core -- --dir <dossier jarvis-data>` | PC | 1 min |
| 2. Mettre en place (une fois) | `powershell -ExecutionPolicy Bypass -File training\setup-windows.ps1` | PC | 10–30 min (téléchargements) |
| 3. Entraîner | `training\.venv\Scripts\python training\train_lora.py --data <dossier jarvis-data>\preparation` | PC (carte) ou carte louée | une nuit (estimation) |
| 4. Exporter vers Ollama | `training\.venv\Scripts\python training\export_ollama.py --run training\runs\<date>` | PC | 30–60 min |
| 5. Examiner | `npm run lab:compare --workspace @jarvis/core -- --base qwen2.5-coder:7b --candidate jarvis-coder --runs 3` | PC | 1–2 h |
| 6. Décider | lire le verdict ; garder ou `ollama rm jarvis-coder` | toi | — |

`<dossier jarvis-data>` est le dossier où le labo range déjà `entrainement.jsonl` et `exercices.jsonl` (celui
que tu passes à `lab:generate`).

## 1. Préparer les données

```powershell
npm run lab:prepare --workspace @jarvis/core -- --dir <dossier jarvis-data>
```

Ce que ça fait : lit le cahier, **écarte** ce qui ne doit pas servir (lignes illisibles, exemples sans fichier écrit,
doublons, exemples trop longs, et surtout tout exemple qui ressemble à une des 29 missions de l'examen — l'examen ne
doit jamais fuir dans l'apprentissage), puis coupe en deux : 90 % pour apprendre (`train.jsonl`), 10 % pour vérifier
(`validation.jsonl`), même proportion à chaque niveau.

Ce qu'on doit voir : un `RÉSUMÉ` avec le nombre de lignes lues, gardées, écartées (et pourquoi), la répartition par
niveau, puis `Fichiers écrits dans <dossier jarvis-data>\preparation`. Si le message est **« Préparation refusée : … il faut
encore des nuits de génération »**, rien n'est écrit : il faut attendre d'avoir plus d'exercices.

Fichiers produits dans `preparation\` : `train.jsonl`, `validation.jsonl`, `ecartes.jsonl` (chaque ligne écartée
avec sa raison), `resume.json` (les comptes). Options : `--max-tokens 3072` (plafond de longueur), `--validation 0.1`,
`--seed 5065`, `--min 100`.

## 2. Mettre en place l'environnement (une seule fois)

```powershell
powershell -ExecutionPolicy Bypass -File training\setup-windows.ps1
```

Ce que ça fait : vérifie Python (3.10 à 3.13) et le pilote NVIDIA, crée un environnement Python à part dans
`training\.venv` (jamais dans le dépôt git), installe torch pour CUDA et les bibliothèques épinglées
(`requirements.txt`), vérifie que torch voit la carte **et que bitsandbytes tourne dessus** (`controle_carte.py` crée
une couche 4 bits sur la carte et la traverse : si ça échoue ici, l'entraînement QLoRA échouerait au chargement du
modèle), puis télécharge `llama.cpp` à la version fixée (`b12032`) pour la conversion. Compte plusieurs Go de téléchargement.

Ce qu'on doit voir : des lignes `==> …` puis `OK …` en vert, et à la fin `Terminé. Prochaines étapes`. Une ligne
`!!` en jaune signale un problème qui n'empêche pas de continuer (par exemple « torch ne voit pas la carte » : alors
seuls la vérification `--dry-run` et l'export sont possibles, et l'entraînement se fait sur une carte louée).

Si Python manque : [python.org/downloads/windows](https://www.python.org/downloads/windows/), cocher « Add python.exe to PATH ».
Si le pilote est trop ancien pour CUDA 12.8 : mettre à jour le pilote NVIDIA, ou relancer avec `-CudaIndex cu126`.

### Vérifier le circuit sans la carte (facultatif, 1 minute)

```powershell
training\.venv\Scripts\python training\train_lora.py --dry-run --data <dossier jarvis-data>\preparation
```

Ce que ça fait : joue tout l'entraînement sur un **modèle minuscule et aléatoire**, sur le processeur. Ça ne produit
rien d'utile ; ça prouve que l'installation et les données sont bonnes. On doit voir `DRY-RUN terminé : le circuit
fonctionne.`

## 3. Entraîner sur le PC (RTX 2060, 6 Go)

```powershell
training\.venv\Scripts\python training\train_lora.py --data <dossier jarvis-data>\preparation
```

Ce que ça fait : charge le modèle de base `Qwen/Qwen2.5-Coder-7B-Instruct` (celui dont `qwen2.5-coder:7b` est issu ;
15 Go téléchargés la première fois depuis Hugging Face) en 4 bits, et apprend un petit « adaptateur » (LoRA) sur les
exemples. Les textes sont mis exactement au format que le modèle voit dans Ollama (gabarit officiel, appels d'outils
compris) et seule la **réponse** de l'élève est apprise, pas la consigne ni la demande. À chaque époque, la perte sur
`validation.jsonl` est mesurée ; dès qu'elle remonte, l'entraînement s'arrête et garde le meilleur point.

Ce qu'on doit voir : `Exemples : N en entraînement …`, `Perte calculée sur … jetons de réponse`, `LoRA rang 16 …`, puis
des lignes `époque 0.12 · pas 5 · perte 1.2345` qui **baissent** au fil du temps, `perte de validation …` à chaque époque,
et à la fin `Adaptateur écrit dans training\runs\<date>\adaptateur`. Tout est aussi dans `training\runs\<date>\journal.txt`.
Si une perte devient `nan` (l'entraînement a divergé), le script s'arrête **proprement** : `ARRÊT : perte nan au pas …`,
aucun adaptateur ni point de reprise cassé n'est écrit, `bilan.json` note `arret`, code de sortie 6 ; relancer avec
`--lr 1e-4` (et `--fresh`).

**Durée (estimation, pas encore mesurée sur cette carte)** : pour 400 à 500 exemples et 3 époques au plus, compter
**une nuit** sur une RTX 2060. **Mémoire** : 6 Go, c'est juste ; en cas de `CUDA out of memory`, relancer avec
`--max-length 1536` (puis `1024`) ; si ça ne passe toujours pas, passer par la carte louée (`training\cloud\README.md`).

Réglages (tous visibles avec `--help`) : `--epochs 3`, `--rank 16`, `--alpha 32`, `--lr 2e-4`, `--grad-accum 16`,
`--max-length` : sans valeur, c'est **le plafond de la préparation** (`options.maxTokens` de `resume.json`, 3 072 par
défaut) : l'entraînement garde alors exactement les exemples que `lab:prepare` a gardés, rien de plus n'est laissé de
côté. Une valeur plus basse (pour la mémoire) écarte les exemples plus longs, les compte dans le journal, et le journal
signale l'écart avec la préparation.

**Coupure de courant, PC redémarré ?** Relancer la même commande avec `--out training\runs\<date>` (le dossier qui
existe déjà) : la reprise se fait au dernier point enregistré (à chaque époque). `--fresh` pour repartir de zéro.

### Ou bien : entraîner sur une carte louée

Si la carte ne suffit pas ou si tu veux que ce soit fait en deux heures : `training\cloud\README.md` (RunPod ou
Vast.ai, de l'ordre de 2 à 3 $ au total d'après leurs prix du 2 novembre 2026 ; aucune clé dans le dépôt).
On en revient avec un fichier `.gguf` à passer directement à l'étape 4 : `export_ollama.py --gguf <fichier>`.

## 4. Installer dans Ollama sous le nom `jarvis-coder`

```powershell
training\.venv\Scripts\python training\export_ollama.py --run training\runs\<date>
```

Ce que ça fait, en quatre temps : **fusion** de l'adaptateur dans le modèle de base (sur le processeur : compter
16 Go de mémoire vive libre et 15 Go de disque), **conversion** au format GGUF avec l'outil de llama.cpp, **compression**
Q4_K_M (la même que `qwen2.5-coder:7b`, ≈ 4,7 Go), puis un `Modelfile` et `ollama create jarvis-coder`.

Le `Modelfile` **reprend celui de `qwen2.5-coder:7b`** tel qu'Ollama le donne (`ollama show --modelfile qwen2.5-coder:7b`) :
gabarit de chat, paramètres d'arrêt, consigne, licence ; seule la ligne `FROM` pointe vers le nouveau fichier.
Pourquoi un modèle entier et pas juste l'adaptateur : la documentation d'Ollama (fichiers `docs/import.mdx` et
`docs/modelfile.mdx`, lus le 2 novembre 2026) décrit l'import d'un GGUF complet (`FROM /chemin/fichier.gguf`) et ne
propose pas d'instruction qui appliquerait un adaptateur LoRA séparé ; le modèle fusionné est donc la seule voie
documentée, et c'est celle qui reproduit à coup sûr ce que l'élève a appris.

Ce qu'on doit voir : `Modèle fusionné écrit dans …`, la commande de conversion puis de quantification avec leur
avancement, `Modelfile écrit : …`, et `Modèle « jarvis-coder » créé dans Ollama`. Vérifier : `ollama list` montre
`jarvis-coder` **et** toujours `qwen2.5-coder:7b`. Option `--clean` pour effacer les 30 Go intermédiaires.

## 5. L'examen

```powershell
npm run lab:compare --workspace @jarvis/core -- --base qwen2.5-coder:7b --candidate jarvis-coder --runs 3
```

Ce que ça fait : fait passer **les 29 missions de l'examen** aux deux modèles, trois fois chacun (c'est le banc
`lab-bench` existant), puis compare. Compte 1 à 2 heures ; la carte est occupée.

Ce qu'on doit voir : un tableau mission par mission (réussites sur 3 passages pour chacun), les totaux, et un
**verdict** : « meilleur », « pareil » ou « moins bon ». Le candidat est **conseillé** seulement s'il dépasse la base
au total **et** ne perd pas plus de 2 missions que la base réussissait (une mission est « réussie » par un modèle
quand il la passe à la majorité des passages). Le détail est écrit dans `rapports\<date>-examen-jarvis-coder-contre-qwen2.5-coder-7b.md`
(lisible) et `.json`, sans aucun exercice ni chemin personnel.

## 6. Décider

- **Conseillé** → dans Jarvis, panneau Développeur → onglet « Modèle de code » → choisir `jarvis-coder`.
  Rien ne change tant que tu ne l'as pas fait.
- **Pas conseillé** → garder `qwen2.5-coder:7b` et laisser le cahier grossir ; l'adaptateur reste dans `training\runs\`
  si tu veux comparer plus tard.

## Retour en arrière

```powershell
ollama rm jarvis-coder
```

C'est tout : `qwen2.5-coder:7b` n'a jamais été touché, le cahier non plus. Les dossiers `training\runs\`,
`training\export\`, `training\.venv\` et `training\llama.cpp\` peuvent être supprimés à la main pour récupérer la place ;
ils sont hors du dépôt git.

## Pour les curieux : ce qu'il y a dans ce dossier

- `train_lora.py` — l'entraînement (QLoRA 4 bits, fp16, lot de 1 avec accumulation, gradient checkpointing, arrêt sur la
  meilleure validation, reprise, journal). `jarvis_training/data.py` fait la mise au format et le masque de la perte ;
  `jarvis_training/runs.py` gère les dossiers `runs/<date>/`.
- `export_ollama.py` — fusion, GGUF, Q4_K_M, Modelfile, `ollama create`.
- `setup-windows.ps1`, `requirements.txt` — installation, versions fixées (torch 2.11.0, transformers 4.57.6, peft 0.21.2,
  bitsandbytes 0.50.2, datasets 4.8.5, accelerate 1.15.0, llama.cpp b12032).
- `cloud/` — la même chose sur une carte louée.
- `tests/` — tests `pytest` qui rejouent tout le circuit en `--dry-run` sur un modèle minuscule (format du gabarit avec
  appels d'outils, masque de la perte, lecture des fichiers préparés, reprise) :
  `training\.venv\Scripts\python -m pytest training\tests`. Les exemples qu'ils utilisent sont **synthétiques**, écrits
  pour les tests et marqués comme tels ; ils ne vont jamais dans le cahier.
