# Programme de l'enceinte

Ce dossier reçoit les fichiers que Jarvis écrit sur la carte. Ils ne sont **pas** dans git
(trop gros, et ils changent à chaque compilation).

Pour les fabriquer, sur un PC où PlatformIO est installé :

```bash
npm run setup:speaker-firmware
```

Sans ces fichiers, Jarvis le dit et propose la section « Avancé » (PlatformIO).
L'application, elle, démarre quand même.

`LICENCES.md` dit d'où viennent ESP-IDF, ESP-SR, le modèle de réveil et les outils.
