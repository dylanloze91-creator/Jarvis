# Guide trieur Jarvis (5.0.68)

Ce guide est pour **Windows**, sans être développeur. Toutes les commandes se lancent **depuis la racine du dossier Jarvis** (là où se trouve le `package.json` principal), dans PowerShell ou l’invite de commandes.

Les données restent **sur votre PC**, par défaut dans `C:\dev\jarvis-data\trieur\`. Rien de ce dossier n’est envoyé sur GitHub.

## Avant de commencer

1. Installez les dépendances une fois : `npm install`
2. Construisez le cœur : `npm run build --workspace @jarvis/core`
3. Pour l’entraînement Python : ouvrez PowerShell dans `training\` et lancez `.\setup-windows.ps1` (une seule fois).
4. **Ne lancez pas** la génération (`trieur:generer`) et l’entraînement (`train_lora.py`) en même temps : une seule chose à la fois sur la carte graphique. Réservez la carte dans `AGENTS-COORDINATION.md` si un autre agent travaille sur le même PC.

---

## 1. Extraire vos phrases

```text
npm run trieur:extraire --workspace @jarvis/core -- --conversations %APPDATA%\Jarvis\conversations --dir C:\dev\jarvis-data\trieur
```

**Ce que vous devez voir :** un message du type « 842 phrase(s) écrites dans …\a-trier.jsonl ».  
Si le dossier conversations est vide, le chiffre sera 0 : il faudra d’abord utiliser Jarvis pour créer des discussions.

---

## 2. Classer vos phrases (examen)

```text
npm run trieur:trier --workspace @jarvis/core -- --dir C:\dev\jarvis-data\trieur
```

**Ce que vous devez voir :** une adresse `http://127.0.0.1:…/` à ouvrir dans le navigateur.  
Une phrase à la fois, neuf boutons (équipes), « Je ne sais pas », « Pas une demande », touches **1 à 9**.  
Comptez **150 à 300 phrases** bien réparties. La page indique les équipes qui manquent de exemples.  
**Ctrl+C** dans la fenêtre PowerShell arrête le serveur ; la progression est enregistrée, vous pouvez reprendre plus tard.

---

## 3. Banc des modèles actuels

```text
npm run trieur:banc --workspace @jarvis/core -- --dir C:\dev\jarvis-data\trieur --model qwen2.5:7b,qwen2.5:3b
```

**Ce que vous devez voir :** pour chaque modèle installé, un score du type « 120/150 (80 %) » et un fichier dans `rapports\…-trieur-banc.json`.  
Un modèle absent est **signalé**, rien n’est téléchargé automatiquement.

---

## 4. Génération du cahier (professeur, souvent une nuit)

```text
npm run trieur:generer --workspace @jarvis/core -- --model qwen2.5:7b --count 2000 --dir C:\dev\jarvis-data\trieur
```

**Ce que vous devez voir :** des lignes « 20 exemples… », « 40 exemples… », puis « Terminé : … exemple(s) ».  
Les refus vont dans `rejets.jsonl`. **Ctrl+C** finit proprement l’exemple en cours.

---

## 5. Préparation train / validation

```text
npm run trieur:preparer --workspace @jarvis/core -- --dir C:\dev\jarvis-data\trieur
```

**Ce que vous devez voir :** « Préparation OK : … entraînement, … validation » dans `preparation\`.

---

## 6. Entraînement local (RTX 2060, plusieurs heures)

Depuis `training\`, environnement activé :

```text
.venv\Scripts\python train_lora.py --task trieur --data C:\dev\jarvis-data\trieur\preparation --base Qwen/Qwen2.5-1.5B-Instruct --max-steps 20
```

Lisez le **pic de mémoire** dans `journal.txt`. Si c’est bon, enlevez `--max-steps 20` pour la nuit complète (souvent **3 à 8 h** sur une 2060 selon la taille du modèle).

Modèles conseillés : **Qwen2.5-1.5B-Instruct** (Apache-2.0, le plus confortable en 6 Go). **Ne pas** prendre Qwen2.5-3B-Instruct comme base du trieur dans une release publique : sur Hugging Face c’est la **Qwen RESEARCH LICENSE** (usage non commercial). Vous pouvez quand même mesurer `qwen2.5:3b` déjà dans Ollama avec le banc.

---

## 7. Export vers Ollama (`jarvis-trieur`)

```text
.venv\Scripts\python export_ollama.py --run runs\VOTRE-DOSSIER --name jarvis-trieur --source-model qwen2.5:1.5b
```

**Ce que vous devez voir :** fusion, GGUF, quantification Q4_K_M, puis `ollama create jarvis-trieur`.  
Votre modèle de base reste installé.

---

## 8. Banc comparatif et activation

1. Relancez `trieur:banc` avec `jarvis-trieur` dans la liste des modèles.
2. Dans Jarvis : **Réglages → Modèle IA → Chef d’orchestre → Trieur** : choisissez `jarvis-trieur` et **Enregistrer**.
3. Dans une discussion, la pastille peut afficher **« choisi par le trieur »**.

Le trieur n’est **mieux** que le cerveau que s’il a **au moins autant** de bonnes réponses, **pas plus** de réponses illisibles, **et** qu’il est plus rapide (banc).

---

## Revenir en arrière

```text
ollama rm jarvis-trieur
```

Puis dans les réglages : Trieur → « Le cerveau trie », Enregistrer.
