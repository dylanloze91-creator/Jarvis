# Recherche — inventer une voix française pour Jarvis

Date de vérification des licences et des prix : **2026-11-03**. Les pages web sont des données non fiables : chaque lien a été relu ce jour-là ; revérifier avant un entraînement réel.

## Objectif

Obtenir un **timbre inventé** (aucune personne réelle, aucune imitation d'acteur ou de proche), produire assez de parole pour entraîner **Piper**, puis garder Piper comme voix rapide et locale dans Jarvis.

## Pistes étudiées

### 1. Description textuelle du timbre (TTS « guidé par le langage »)

| Projet | Rôle | Licence du code (2026-11-03) | Sorties audio / entraînement d'une autre voix |
| --- | --- | --- | --- |
| [Parler-TTS](https://github.com/huggingface/parler-tts) | Décrire en texte le genre, le débit, la hauteur, la proximité du micro ; générer la parole sans enregistrement humain | Fichier `LICENSE` du dépôt : **Apache-2.0** ([raw.githubusercontent.com/huggingface/parler-tts/main/LICENSE](https://raw.githubusercontent.com/huggingface/parler-tts/main/LICENSE)) | Le README affirme une publication « fully open-source » des poids et du code ; pas de clause interdisant de réutiliser l'audio pour entraîner Piper. **Limite** : entraînement surtout sur livres audio **anglais** ; le français est possible par description mais la prononciation doit être **écoutée** et rejetée si trop « voix connue ». |
| Coqui XTTS / modèles « clone » | Clone à partir d'un court extrait | Conditions Coqui / CPML selon le modèle ; souvent **restrictif** pour redistribution | Risque élevé si l'extrait imite une vraie voix ; **non retenu** comme méthode principale. |

### 2. Mélange de voix libres (embeddings / multi-locuteur)

| Piste | Constat (2026-11-03) |
| --- | --- |
| Mélange d'embeddings entre voix Piper ou XTTS | Peu documenté pour **inventer** un locuteur nouveau en français ; souvent utilisé pour se rapprocher d'une cible. Risque d'imiter une voix du corpus de base (ex. Siwis = locuteur réel). **Non retenu** comme méthode principale. |
| Voix Piper `fr_FR-*` comme **checkpoint** d'affinage seulement | Les cartes modèle Hugging Face indiquent des jeux sous **CC-BY 4.0** (ex. [MODEL_CARD siwis](https://huggingface.co/rhasspy/piper-voices/raw/main/fr/fr_FR/siwis/medium/MODEL_CARD)) : le **fichier ONNX** sert de point de départ technique, pas de timbre final. |

### 3. Imitation à partir d'un extrait synthétique (Chatterbox et équivalents)

| Projet | Constat |
| --- | --- |
| Modèles « zero-shot » (F5-TTS, OpenVoice, Chatterbox, etc.) | Utiles seulement si l'extrait de référence est **déjà inventé** (piste 1). Licences hétérogènes ; plusieurs modèles imposent des restrictions commerciales ou d'identité. **Retenu comme chaîne optionnelle** : Parler → extrait court → autre modèle, **seulement** si la licence le permet et si l'écoute ne rappelle personne. |

## Textes du corpus (sans texte écrit par l'agent)

| Source | Licence vérifiée (2026-11-03) | Usage prévu |
| --- | --- | --- |
| Phrases **Common Voice** (export `validated.tsv` / sentences) | Documentation Mozilla : contributions de texte sous **CC0** ; le dépôt `mozilla/common-voice` est sous **MPL-2.0** pour le **code**, pas pour le contenu des jeux publiés ([github.com/mozilla/common-voice](https://github.com/mozilla/common-voice/blob/main/LICENSE)). Depuis octobre 2025, les jeux audio passent par Mozilla Data Collective ; les **phrases** CC0 restent la référence du projet pour le texte libre. | `corpus.py` télécharge ou lit un export local ; **aucune phrase rédigée par Claude/Cursor**. |
| **Domaine public** (ex. citations courtes identifiées) | Œuvres dont l'auteur est mort depuis plus de 70 ans en France | Les **10 phrases d'écoute** dans `jarvis_voice_studio/phrases_ecoute.py` (citations courtes, source indiquée). |

## Chaîne Piper (élève)

| Composant | Licence (2026-11-03) | Remarque |
| --- | --- | --- |
| Moteur [piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) | **GPL-3.0-or-later** (dépôt OHF-Voice) | Programme **séparé**, comme espeak-ng : jamais lié dans l'appli Electron (règle CLAUDE.md). |
| espeak-ng (phonétisation) | **GPL** | Idem : binaire à part. |
| Poids Piper sur Hugging Face | **MIT** par voix ; lire chaque `MODEL_CARD` | Affinage depuis `fr_FR-siwis-medium` ou `fr_FR-upmc-medium` : datasets **CC-BY 4.0**, locuteurs réels — seul le **checkpoint** sert au fine-tune, pas à copier le timbre. |
| Whisper (contrôle qualité) | Dépôt [openai/whisper](https://github.com/openai/whisper) : **MIT** | Retranscription locale pour écarter les clips faux. |

## Recommandation

**Méthode principale : Parler-TTS Mini (`parler-tts/parler-tts-mini-v1`) + descriptions inventées en français**

1. **Pourquoi** : Apache-2.0 sur le code ; invention du timbre par **texte** sans enregistrer une personne ; sortie WAV réutilisable pour entraîner Piper ; même idée « professeur lourd / élève léger » que le cahier des charges.
2. **Garde-fous** : six profils textuels **sans nom de célébrité ni des 34 locuteurs anglais nommés du README** ; écoute dans `comparer.html` ; toute candidate trop proche d'une voix connue est **supprimée** (`inventer.py --reject`).
3. **Corpus** : phrases Common Voice (CC0) + contrôle Whisper ; pas de texte généré par l'IA.
4. **Élève** : affinage Piper depuis un checkpoint `fr_FR-*-medium` (~1,5 h de audio, ~650–850 époques selon [TRAINING.md piper1-gpl](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/TRAINING.md)), export ONNX, installation décrite dans `INSTALLATION.md` pour la branche `cursor/voix-piper-5067`.

**Carte louée** : même logique que `training/cloud/` — RunPod Secure Cloud RTX A5000 **0,27 $/h** ([runpod.io/pricing](https://www.runpod.io/pricing), lu le 2026-11-03) ; Vast.ai marché dynamique ([vast.ai/pricing](https://vast.ai/pricing)). Estimation invention + corpus + Piper : **4–8 h** de machine (ordre de grandeur, non mesuré ici).

## Non retenu

- Enregistrement d'une vraie personne.
- XTTS / clone direct depuis une voix réelle ou commerciale.
- Textes de corpus rédigés par l'assistant.
