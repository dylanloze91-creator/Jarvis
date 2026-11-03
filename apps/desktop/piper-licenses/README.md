Licences embarquées avec Piper (release 2023.11.14-2)
======================================================

Ce dossier est recopié dans `voice-assets/piper/licenses/` par `setup-piper.mjs`, puis dans l'installateur via `extraResources`.

## espeak-ng (GPL-3.0)

Le binaire Piper précompilé inclut **espeak-ng** et `espeak-ng-data` (phonétiseur). Licence : **GNU GPL version 3**.

- Texte intégral de la licence : `GPL-3.0.txt` (texte officiel de la FSF, https://www.gnu.org/licenses/gpl-3.0.txt)
- Version embarquée dans les binaires `rhasspy/piper` **2023.11.14-2** : bibliothèque `libespeak-ng.so.1.52.0.1` (voir l'archive `piper_linux_x86_64.tar.gz` / `piper_windows_amd64.zip`).
- **Code source correspondant** : la release Piper `2023.11.14-2` (14 novembre 2023) compile `piper-phonemize` depuis sa branche `master`, qui compile elle-même le fork `rhasspy/espeak-ng` depuis sa branche `master`. État de ces branches à cette date (relevé le 3 novembre 2026 dans l'historique git) :
  - espeak-ng (fork rhasspy) : https://github.com/rhasspy/espeak-ng/tree/0f65aa301e0d6bae5e172cc74197d32a6182200f (dernier commit avant le 15 novembre 2023 ; le suivant date du 27 novembre 2023)
  - piper-phonemize : https://github.com/rhasspy/piper-phonemize/tree/fccd4f335aa68ac0b72600822f34d84363daa2bf
  - Piper : https://github.com/rhasspy/piper/tree/2023.11.14-2
- Projet d'origine : https://github.com/espeak-ng/espeak-ng

Jarvis **n'intègre pas** espeak-ng dans l'application Electron : seul le **processus Piper séparé** l'utilise.

## piper-phonemize (MIT)

- https://github.com/rhasspy/piper-phonemize (version : voir ci-dessus)
- Inclus dans le binaire Piper 2023.11.14-2 (`libpiper_phonemize.so`).

## Piper (MIT)

- https://github.com/rhasspy/piper/blob/v2023.11.14-2/LICENSE.md

## Voix ONNX

Voir `MODEL_CARD-siwis.md` et `MODEL_CARD-upmc.md`.
