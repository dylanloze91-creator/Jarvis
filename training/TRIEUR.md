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

### Depuis Jarvis

```text
npm run trieur:extraire --workspace @jarvis/core -- --conversations %APPDATA%\Jarvis\conversations --dir C:\dev\jarvis-data\trieur
```

**Ce que vous devez voir :** un message du type « 842 phrase(s) écrites dans …\a-trier.jsonl ».  
Si le dossier conversations est vide, le chiffre sera 0 : il faudra d’abord utiliser Jarvis pour créer des discussions.

### Depuis claude.ai (export officiel)

1. Sur [claude.ai](https://claude.ai), ouvrez **Paramètres → Confidentialité → Exporter les données**. Anthropic envoie un lien de téléchargement (valable 24 h).
2. Téléchargez le fichier **.zip** (ou décompressez-le dans un dossier).
3. Lancez l’extraction en indiquant le **zip** ou le **dossier** qui contient `conversations.json` :

```text
npm run trieur:extraire --workspace @jarvis/core -- --export-claude C:\Users\Vous\Downloads\claude-export.zip --dir C:\dev\jarvis-data\trieur
```

Vous pouvez combiner Jarvis et claude.ai dans la même commande (les deux options `--conversations` et `--export-claude`).

**Ce que l’outil garde :** seulement **vos** messages (pas ceux de Claude), tels qu’exportés ; le contexte est votre **message utilisateur précédent** dans la même conversation. Les messages vides, les doublons, ceux de plus de 400 caractères et les blocs de code collés sont ignorés. Chaque ligne porte `"source":"claude.ai"` dans `a-trier.jsonl`.

**Ne commitez jamais** votre zip ni votre dossier d’export dans le dépôt Git : restez dans `C:\dev\jarvis-data\trieur\`.

---

## 2. Classer vos phrases (examen)

### Sur le PC (navigateur)

```text
npm run trieur:trier --workspace @jarvis/core -- --dir C:\dev\jarvis-data\trieur
```

Port local libre (affiché à l’écran). Pour un port fixe (conseillé **43160**, sous 49152 pour éviter les plages réservées Windows) :

```text
npm run trieur:trier --workspace @jarvis/core -- --dir C:\dev\jarvis-data\trieur --port 43160
```

**Ce que vous devez voir :** une adresse `http://127.0.0.1:…/` à ouvrir dans le navigateur.  
Une phrase à la fois, neuf boutons (équipes), « Je ne sais pas », « Pas une demande », touches **1 à 9**.  
Comptez **150 à 300 phrases** bien réparties. La page indique les équipes qui manquent de exemples.  
**Ctrl+C** dans la fenêtre PowerShell arrête le serveur ; la progression est enregistrée, vous pouvez reprendre plus tard.

### Sur l’iPhone (Tailscale, gros boutons)

1. Sur le PC, lancez le tri avec le port **43160** et le mode Tailscale :

```text
npm run trieur:trier --workspace @jarvis/core -- --dir C:\dev\jarvis-data\trieur --port 43160 --tailscale
```

2. **Une seule fois**, publiez ce port sur votre tailnet (le téléphone Jarvis reste sur `53130`) :

```text
tailscale serve --bg --https=8443 43160
```

3. Le PC affiche une adresse `https://<pc>.ts.net:8443/#t=…` et un **QR code** dans le terminal. Scannez-le avec l’iPhone (appareil photo ou Safari).

4. Sur l’iPhone : grille **3×3** de gros boutons, « Je ne sais pas », « Pas une demande », « Annuler la dernière », compteur — **sans clavier**.

**Pour arrêter la publication Tailscale** (le serveur local s’arrête avec Ctrl+C dans PowerShell) :

```text
tailscale serve reset
```

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
