# Enregistrements vocaux réels

Ce dossier peut contenir des prises de voix réelles (MP3 / WAV), **jamais commitées** (`.gitignore`) puisqu'il s'agit de la voix d'une personne.

Pour vérifier une prise dans la vraie chaîne voix (openWakeWord, déclencheur « Jarvis » nu confirmé par Whisper, dictée) :

- **Dans l'appli** : Réglages → Commande vocale → « Tester la voix » → « Analyser un fichier audio ».
- **Depuis un terminal**, sur un build empaqueté (`npm run package:dir --workspace @jarvis/desktop`) :

```bash
node apps/desktop/scripts/check-voice-recordings.mjs \
  --app apps/desktop/release/linux-unpacked/@jarvisdesktop \
  apps/desktop/test-fixtures/ma-prise.mp3
```

Chaque ligne donne le score openWakeWord, ce que Whisper a entendu pour confirmer « Jarvis », si le réveil est reconnu, et la transcription.
