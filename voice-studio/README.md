# Studio de voix inventée de Jarvis (5.0.67, chantier 2)

Ce dossier sert à **inventer** un timbre de voix qui n'appartient à personne, à fabriquer un corpus d'environ **1 h 30** de paroles dans ce timbre, puis à **affiner une voix Piper** française pour que Jarvis parle vite et gratuitement sur le PC (chantier 1 : moteur `local-piper` sur la branche `cursor/voix-piper-5067`).

Rien ne tourne sur **ta** carte graphique pendant une génération de nuit : l'invention et le corpus se font sur une **carte louée** (comme `training/cloud/`), ou en `--dry-run` sur le processeur pour vérifier le circuit.

## Étapes

| Étape | Script | Sortie (hors dépôt git) |
| --- | --- | --- |
| 1. Lire la recherche | `RECHERCHE.md` | — |
| 2. Six voix candidates | `inventer.py` | `candidates/` + `candidates/comparer.html` |
| 3. Corpus ~1 h 30 | `corpus.py` | `corpus/` |
| 4. Affiner Piper | `entrainer_piper.py` | `export/` (ONNX + config) |
| 5. Installer dans Jarvis | `INSTALLATION.md` | copie vers `voice-assets/piper/models/` |
| Licences | `LICENCES.md` | — |

## Mise en place (une fois)

```powershell
python -m venv voice-studio\.venv
voice-studio\.venv\Scripts\pip install -r voice-studio\requirements.txt
```

Sur Linux (VM de dev) :

```bash
python3 -m venv voice-studio/.venv
voice-studio/.venv/bin/pip install -r voice-studio/requirements.txt
```

## Commandes typiques

```powershell
# Circuit sans modèle (tests et vérification)
voice-studio\.venv\Scripts\python voice-studio\inventer.py --dry-run
voice-studio\.venv\Scripts\python voice-studio\corpus.py --dry-run --candidate candidates\candidate-03
voice-studio\.venv\Scripts\python voice-studio\entrainer_piper.py --dry-run --corpus corpus\metadata.csv

# Vraie invention (carte NVIDIA louée, voir cloud/README.md)
voice-studio\.venv\Scripts\python voice-studio\inventer.py --backend parler --device cuda:0
# Ouvrir candidates/comparer.html dans le navigateur, choisir une candidate

voice-studio\.venv\Scripts\python voice-studio\corpus.py --candidate candidates\candidate-03 --hours 1.5
voice-studio\.venv\Scripts\python voice-studio\entrainer_piper.py --corpus corpus\metadata.csv
```

## Tests

```powershell
voice-studio\.venv\Scripts\python -m pytest voice-studio
```

Les fichiers audio, corpus, caches et exports sont listés dans `.gitignore` à la racine du dépôt ; seuls les scripts, la page d'écoute et la documentation restent versionnés.
