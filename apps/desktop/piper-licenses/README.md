Licences embarquées avec Piper (release 2023.11.14-2)
======================================================

Ce dossier est recopié dans `voice-assets/piper/licenses/` par `setup-piper.mjs`, puis dans l'installateur via `extraResources`.

## espeak-ng (GPL-3.0)

Le binaire Piper précompilé inclut **espeak-ng** et `espeak-ng-data` (phonétiseur). Licence : **GNU GPL version 3**.

- Projet : https://github.com/espeak-ng/espeak-ng
- Texte intégral de la GPL-3.0 : https://www.gnu.org/licenses/gpl-3.0.txt
- Copie locale : `GPL-3.0.txt` (même texte que la FSF)
- Version embarquée dans les binaires `rhasspy/piper` **2023.11.14-2** : bibliothèque `libespeak-ng.so.1.52.0.1` (voir l'archive `piper_linux_x86_64.tar.gz` / `piper_windows_amd64.zip`).

Jarvis **n'intègre pas** espeak-ng dans l'application Electron : seul le **processus Piper séparé** l'utilise.

## piper-phonemize (MIT)

- https://github.com/rhasspy/piper-phonemize
- Inclus dans le binaire Piper 2023.11.14-2 (`libpiper_phonemize.so`).

## Piper (MIT)

- https://github.com/rhasspy/piper/blob/v2023.11.14-2/LICENSE.md

## Voix ONNX

Voir `MODEL_CARD-siwis.md` et `MODEL_CARD-upmc.md`.
