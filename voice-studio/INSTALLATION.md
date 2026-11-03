# Installer la voix « Jarvis » dans Piper (chantier 1)

Cette voix s'ajoute à la liste Piper de Jarvis sur la branche **`cursor/voix-piper-5067`** (non fusionnée au moment de l'écriture). Rien ne change tant que le chantier 1 n'est pas intégré ; ces étapes préparent les fichiers.

## Fichiers produits

Après `entrainer_piper.py` (réel, sur carte louée) :

- `export/fr_FR-jarvis-medium.onnx`
- `export/fr_FR-jarvis-medium.onnx.json`

## Copie dans Jarvis

1. Copier les deux fichiers vers le dossier des modèles Piper de Jarvis :
   - en développement : `apps/desktop/voice-assets/piper/models/`
   - après installation : à côté de l'appli (même arborescence que `setup-piper.mjs`).

2. Sur la branche `cursor/voix-piper-5067`, ajouter une entrée dans `packages/core/src/speech/piperAssets.ts` (ou fichier équivalent) :

   - `onnx` : `fr_FR-jarvis-medium.onnx`
   - `json` : `fr_FR-jarvis-medium.onnx.json`
   - URLs Hugging Face **ou** hébergement perso + empreintes SHA-256 mesurées sur les fichiers finaux (comme pour `siwis` et `upmc`).

3. Relancer `npm run setup:voice` (ou le script `setup-piper.mjs` de la branche voix) pour vérifier les empreintes.

4. Dans Jarvis : Réglages → Voix → moteur **Piper local** → choisir **Jarvis** (libellé à afficher : « Jarvis (inventée) »).

## Essai d'écoute

```powershell
piper.exe -m apps\desktop\voice-assets\piper\models\fr_FR-jarvis-medium.onnx -f test.wav
# Taper une phrase, Ctrl+Z puis Entrée (Windows)
```

Ou le bouton « Écouter » des réglages une fois le chantier 1 fusionné.

## Licence

Conserver `voice-studio/LICENCES.md` et les attributions CC-BY du checkpoint de base (Siwis ou UPMC) en plus de la documentation du corpus CC0.
