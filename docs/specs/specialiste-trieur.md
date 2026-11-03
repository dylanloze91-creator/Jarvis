# Cahier des charges — Le premier petit spécialiste : le trieur (5.0.68)

Rédigé par Claude pour Cursor, le 2 novembre 2026. Mission longue, à faire d'une traite. Lire `CLAUDE.md` en entier, en particulier 5.0.55 à 5.0.61 (examen, générateur, règle des données), 5.0.60 (chef d'orchestre), 5.0.62 (vérification du destinataire), 5.0.65 (outils d'entraînement, dossier `training/`).

## Pourquoi

Étape 4 bis de la feuille de route de l'utilisateur : des petits modèles très spécialisés, un par tâche, qui lui appartiennent. On commence par **le trieur du chef d'orchestre** : à chaque phrase, il choisit l'équipe (`conversation`, `pc`, `fichiers`, `web`, `musique`, `concentration`, `memoire`, `google`, `code`). Aujourd'hui c'est le cerveau (`qwen2.5:7b`, 4,7 Go sur la carte) qui le fait, en lisant `routerSystemPrompt` : lent au premier chargement et lourd pour un seul mot de réponse. Un petit modèle affiné (1 à 4 milliards de paramètres) peut faire aussi bien, plus vite, et s'entraîner **sur la RTX 2060 de l'utilisateur, sans carte louée**.

Cette mission livre **tout l'outillage** et le branchement dans Jarvis, **désactivé par défaut**. Rien n'est entraîné ni téléchargé par Cursor : l'utilisateur lancera chaque étape sur son PC.

## Règles qui ne se discutent pas

1. **Aucun texte écrit par Claude ni par Cursor dans les données d'entraînement ni dans l'examen.** Les phrases d'entraînement viennent d'un modèle ouvert (le professeur) ; les phrases de l'examen viennent des **vraies conversations de l'utilisateur**. Les tests utilisent des exemples synthétiques minuscules marqués `synthetique-test`, jamais copiés dans un cahier.
2. **L'examen ne fuit jamais dans l'entraînement** : chaque exemple généré est comparé aux phrases de l'examen (même méthode de proximité que `exerciseSimilarity` / `noveltyCheck`, seuil documenté) ; un exemple trop proche est écarté et listé.
3. **Rien de personnel dans le dépôt** (dépôt public) : ni phrase de l'utilisateur, ni conversation, ni chemin. Tout vit dans un dossier de données choisi par l'utilisateur (par défaut `C:\dev\jarvis-data\trieur\`), jamais commité.
4. **Le trieur ne remplace rien tout seul.** Il s'ajoute dans Ollama ; l'utilisateur le choisit dans les réglages après l'examen comparatif.
5. **Chat sans orchestre, et orchestre sans trieur choisi : comportement d'avant à l'identique** (`chat-unchanged.test.ts`, `ollama-unchanged.test.ts`, `orchestra-session.test.ts` verts sans régénération ; `parseSettings({})` ne gagne aucune clé).
6. **Licences vérifiées en ligne, jamais de mémoire** : modèle de base (attention : toutes les tailles de Qwen n'ont pas la même licence ; vérifier sur chaque fiche Hugging Face), professeur, bibliothèques. Noter chaque licence et son lien dans le rapport et dans `CLAUDE.md`.

## À livrer

### 1. Examen du trieur (phrases réelles, tri par l'utilisateur)

- `npm run trieur:extraire --workspace @jarvis/core -- --conversations <dossier conversations de Jarvis> --dir C:\dev\jarvis-data\trieur` : lit les conversations enregistrées (format de `conversations/*.json`), garde chaque **message de l'utilisateur** avec ses 4 derniers échanges (comme `routerUserPrompt`), retire doublons et phrases vides, écrit `a-trier.jsonl`. Si la conversation contient l'équipe choisie à l'époque (événement `route`), elle est gardée comme **suggestion**, jamais comme réponse.
- **Page de tri locale** (`npm run trieur:trier … -- --dir …`) : petit serveur sur `127.0.0.1` seulement (port libre, comme le jumelage du téléphone : jamais une plage réservée par Windows), page sans bibliothèque, texte affiché par `textContent`. Une phrase à la fois, son contexte, 9 gros boutons (une équipe chacun, libellés en français simple), « Je ne sais pas » et « Pas une demande » ; raccourcis clavier 1 à 9 ; compteur ; reprise là où on s'est arrêté. Écrit `examen.jsonl` (phrase, contexte, équipe donnée par l'utilisateur). But : **150 à 300 phrases**, réparties sur les équipes ; la page dit quelles équipes manquent de phrases.
- Si l'utilisateur n'a pas assez de vraies phrases pour une équipe, la page le dit ; **on ne complète jamais l'examen avec des phrases inventées**.

### 2. Banc du trieur (mesure avant et après)

`npm run trieur:banc --workspace @jarvis/core -- --dir … --model qwen2.5:7b,qwen2.5:3b,…` : passe l'examen à chaque modèle **avec la consigne et la lecture actuelles** (`routerSystemPrompt`, `routerUserPrompt`, `parseRouterReply`, température 0, 12 jetons — réutiliser le code, ne pas le recopier). Mesures : bonnes réponses (total et par équipe), tableau des confusions, réponses illisibles (qui renverraient au chat d'avant), temps de chargement et temps par phrase, part sur la carte (`/api/ps`). Rapport JSON + résumé lisible dans `rapports/` (chiffres seulement, aucune phrase). Rien n'est téléchargé : un modèle absent est signalé.

### 3. Cahier d'entraînement du trieur (professeur ouvert)

`npm run trieur:generer --workspace @jarvis/core -- --model <professeur> --count 2000 --dir …` (même esprit que `lab:generate`) :

- Graines variées : équipe, style (ordre court, question, phrase parlée transcrite par Whisper avec ses fautes, phrase avec « Jarvis » en tête), longueur, suivi d'un échange précédent (« et ferme-le », « et demain ? »), et **cas pièges** entre équipes voisines (musique / web, mémoire / conversation, fichiers / pc, google / web, code / conversation).
- Le professeur écrit la phrase et le contexte **et** l'équipe ; Jarvis contrôle sans modèle : format, équipe existante, cohérence avec `expressTeam` quand une règle express s'applique (désaccord = écarté), doublons et quasi-doublons, proximité de l'examen (règle 2), équilibre des équipes. Écrit `entrainement.jsonl` (format conversation : consigne `routerSystemPrompt`, demande `routerUserPrompt`, réponse = le nom de l'équipe) et `rejets.jsonl` avec la raison. Reprise sans doublon, Ctrl+C propre.
- Choix du professeur : un modèle ouvert déjà proche de l'utilisateur (il a `qwen3-coder:30b` et `qwen2.5:7b`) ou mieux adapté au français ; vérifier sa licence pour cet usage et le justifier. Ne rien télécharger.

### 4. Entraînement local sur la RTX 2060 (réutiliser `training/`)

- Étendre `training/` (sans casser l'élève de code ni ses 37 tests) pour un **mode classification** : exemples sans outils, perte seulement sur le nom de l'équipe, longueur courte. Préparation (`trieur:preparer`) : découpe train / validation déterministe, contrôle de contamination, refus sous un minimum documenté.
- **Modèle de base** : proposer 2 ou 3 candidats de 1 à 4 milliards de paramètres sous licence permissive (vérifiée), qui tiennent **en QLoRA dans 6 Go** (fp16, pas de bf16 sur la RTX 2060) ; mesurer en `--dry-run` sur processeur ce qui est mesurable et estimer la mémoire du reste. Le banc (point 2) sur les modèles de base aide à choisir.
- Export vers Ollama sous le nom `jarvis-trieur` (même chemin que `export_ollama.py` : fusion, GGUF, Q4_K_M, Modelfile repris de `ollama show --modelfile` du modèle de base), puis examen comparatif contre le cerveau actuel. Verdict « meilleur » seulement si le trieur fait **au moins aussi bien que le cerveau en bonnes réponses, sans plus d'illisibles, et plus vite**.

### 5. Branchement dans Jarvis (coupé par défaut)

- Réglage `orchestra.router` (facultatif, **sans défaut Zod**) : `{ model, place }`. Absent = le cerveau trie, comme avant. Présent = ce modèle trie ; le cerveau garde la conversation et les équipes sans modèle. Même repli qu'aujourd'hui : réponse illisible, Ollama arrêté ou délai → le chat d'avant, jamais une équipe devinée.
- Interface : Réglages → Modèle IA → Chef d'orchestre → « Trieur » (liste des modèles installés, emplacement carte / processeur), avec une phrase d'explication simple. Pastille de la discussion : « choisi par le trieur ».
- Tests : réglage absent = chemins et requêtes identiques à avant (comparer aux sorties actuelles), trieur choisi = la requête de tri part vers ce modèle avec les mêmes consignes, repli sur réponse illisible.

### 6. Guide pour l'utilisateur (`training/TRIEUR.md`, français simple)

Non-développeur, Windows. Dans l'ordre, chaque commande à copier avec ce qu'on doit voir : extraire, trier ses phrases (combien, combien de temps), banc des modèles actuels, génération de nuit du cahier, préparation, entraînement local (durée estimée sur une RTX 2060), export, examen, activer le trieur, revenir en arrière (`ollama rm jarvis-trieur` et retirer le réglage). Rappeler : ne pas lancer la génération et l'entraînement en même temps ; réserver la carte dans `AGENTS-COORDINATION.md`.

## Tests

- Vitest (dans `npm test`) : extraction (contexte, doublons, suggestion jamais prise pour réponse), page de tri (hôte refusé hors 127.0.0.1, écriture, reprise, raccourcis), contrôles du générateur (chaque cause de refus, contamination de l'examen détectée), banc (faux Ollama), branchement (réglage absent identique, trieur choisi, repli).
- pytest (`training/tests/`) : mode classification en `--dry-run` sur processeur (gabarit, masque de la perte sur le seul nom d'équipe, découpe), et les 37 tests existants toujours verts.

## Livraison

- Branche `cursor/trieur-5068` depuis `origin/main`, inscrite dans `AGENTS-COORDINATION.md`. Ne touche pas aux fichiers de `cursor/voix-piper-5067` ni de `claude/revue-correctifs-windows` (voir la coordination) ; dans `CLAUDE.md`, ajoute seulement ta section « 5.0.68 — le trieur, premier petit spécialiste » et tes lignes dans « Ce qu'il ne faut pas casser ».
- Avant de pousser : `npm run typecheck`, `npm test`, `npm run lint` (seuls les 5 échecs dotnet sont attendus sur une machine sans SDK .NET), pytest de `training/`.
- Commits petits et nommés, un par partie. Pas de fusion dans `main`, pas de publication : Claude relit d'abord.
- Rapport `rapports/2026-11-0X-trieur-5068.md` : fait, testé, non testé (rien n'a tourné sur la carte de l'utilisateur), licences vérifiées avec liens, candidats proposés et pourquoi, questions pour l'utilisateur. Puis le RAPPORT DE VÉRIFICATION.
