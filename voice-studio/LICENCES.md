# Licences — studio de voix Jarvis

Vérification des pages officielles le **2026-11-03**. Revérifier avant tout entraînement ou publication.

| Composant | Usage | Licence | Lien |
| --- | --- | --- | --- |
| Parler-TTS (code) | Invention des candidates + synthèse corpus | **Apache-2.0** | [github.com/huggingface/parler-tts/LICENSE](https://github.com/huggingface/parler-tts/blob/main/LICENSE) |
| Parler-TTS Mini v1 (poids) | Modèle `parler-tts/parler-tts-mini-v1` | Open weights (README : open-source ; pas de CPML) | [huggingface.co/parler-tts/parler-tts-mini-v1](https://huggingface.co/parler-tts/parler-tts-mini-v1) |
| Piper (piper1-gpl) | Affinage + inférence ONNX | **GPL-3.0-or-later** | [github.com/OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) |
| espeak-ng | Phonétisation (binaire séparé) | **GPL** | [github.com/espeak-ng/espeak-ng](https://github.com/espeak-ng/espeak-ng) |
| Checkpoint `fr_FR-siwis-medium` | Point de départ fine-tune | Poids **MIT** ; jeu Siwis **CC-BY 4.0** | [MODEL_CARD siwis](https://huggingface.co/rhasspy/piper-voices/raw/main/fr/fr_FR/siwis/medium/MODEL_CARD) |
| Checkpoint `fr_FR-upmc-medium` | Alternative | Poids **MIT** ; jeu **CC-BY 4.0** | [MODEL_CARD upmc](https://huggingface.co/rhasspy/piper-voices/raw/main/fr/fr_FR/upmc/medium/MODEL_CARD) |
| Phrases Common Voice (texte) | Corpus `corpus.py` | **CC0** (contributions texte du projet) | [commonvoice.mozilla.org/fr/datasets](https://commonvoice.mozilla.org/fr/datasets) |
| Citations domaine public | 10 phrases d'écoute | **Domaine public** (auteurs décédés > 70 ans) | `jarvis_voice_studio/phrases_ecoute.py` |
| OpenAI Whisper | Contrôle qualité (optionnel) | **MIT** | [github.com/openai/whisper](https://github.com/openai/whisper/blob/main/LICENSE) |

## Droits sur les sorties

- **Interdit** : imiter une personne réelle ; enregistrer une vraie voix ; committer des WAV.
- **Corpus synthétique** : produit par Parler à partir de descriptions inventées + textes CC0 ; sert à entraîner une voix Piper **nouvelle** (`fr_FR-jarvis-medium`).
- **Checkpoint Siwis/UPMC** : seulement poids techniques de départ ; le timbre final doit être validé à l'écoute (`comparer.html`).

## Prix cartes louées (2026-11-03)

| Fournisseur | Carte | $/h |
| --- | --- | --- |
| RunPod Secure Cloud | RTX A5000 24 Go | **0,27** |
| RunPod Secure Cloud | RTX 3090 24 Go | **0,50** |
| Vast.ai | RTX 3090 (médian page) | **~0,20** (marché ; on-demand recommandé) |

Sources : [runpod.io/pricing](https://www.runpod.io/pricing), [vast.ai/pricing](https://vast.ai/pricing).

## Fichiers non commités

Voir `.gitignore` : `voice-studio/candidates/`, `corpus/`, `export/`, `checkpoints/`, `.venv/`, caches.
