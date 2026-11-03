# Studio de voix inventée — chantier 2 (5.0.67)

Date : **2026-11-03**. Branche : `cursor/studio-voix` (depuis `origin/main`). Cahier : `docs/specs/voix-jarvis.md` (lu sur `origin/claude/specs-voix`). **Aucune fusion dans `main`, aucune publication.** Aucun modèle lourd exécuté ici : pas de Parler ni Piper réel sur GPU dans cette session.

## Ce que le cahier demandait (chantier 2 seul)

1. `voice-studio/RECHERCHE.md` — méthodes, licences, recommandation.
2. `inventer.py` — 6 candidates, 10 phrases identiques, `candidates/comparer.html`.
3. `corpus.py` — ~1 h 30, textes CC0 / domaine public, QC Whisper, volume, silences, écarts listés.
4. `entrainer_piper.py` + guide carte louée — affinage Piper, export ONNX, coûts/durées vérifiés sur pages officielles.
5. Installation voix « Jarvis » dans la liste Piper du chantier 1.
6. `LICENCES.md` + tests pytest + rapport + coordination.

## Commits (ordre)

| Hash | Message |
| --- | --- |
| `fc5dab0` | coordination: inscription branche cursor/studio-voix (chantier 2) |
| `32d173e` | voice-studio: recherche et socle Python (étape 1) |
| `89da851` | voice-studio: inventer.py et page comparer (étape 2) |
| `4b04cea` | voice-studio: corpus.py avec contrôle qualité (étape 3) |
| `375ee2f` | voice-studio: entrainer_piper.py et guide carte louée (étape 4) |
| `7b7ddfd` | voice-studio: installation voix Jarvis dans Piper (étape 5) |
| `dce9075` | voice-studio: LICENCES.md (étape 6) |
| *(final)* | CLAUDE.md, eslint ignore `.venv`, rapport, coordination terminé |

## Fichiers livrés (`voice-studio/`)

| Fichier / dossier | Rôle |
| --- | --- |
| `RECHERCHE.md` | Pistes vérifiées le 2026-11-03 ; recommandation Parler-TTS + Piper |
| `README.md` | Guide d'usage |
| `LICENCES.md` | Tableau licences + prix GPU |
| `requirements.txt`, `pytest.ini` | Dépendances légères + pytest |
| `jarvis_voice_studio/` | 7 modules Python (phrases PD, candidates, corpus, qualité, audio) |
| `inventer.py` | 6 profils inventés, `--dry-run` ou `--backend parler` |
| `corpus.py` | Corpus cible 1,5 h, `--sentences-file` (TSV Common Voice) |
| `entrainer_piper.py` | Fine-tune Piper, `--dry-run` |
| `INSTALLATION.md` | Copie vers `voice-assets/piper/models/` (branche voix-piper) |
| `cloud/README.md`, `cloud/run_remote.sh` | Carte louée |
| `tests/` | 10 tests pytest |

`.gitignore` racine : `voice-studio/candidates/`, `corpus/`, `export/`, `checkpoints/`, `.venv/`.

## Comptes

| Élément | Nombre |
| --- | --- |
| Voix candidates | **6** |
| Phrases d'écoute (identiques pour chaque candidate) | **10** (domaine public) |
| Profils textuels inventés | **6** |
| Tests pytest `voice-studio` | **10** |
| Modules `jarvis_voice_studio` | **7** |
| Fichiers Python / shell versionnés sous `voice-studio/` | **22** (hors `.venv`) |

## Méthode retenue

**Parler-TTS Mini** (Apache-2.0) avec descriptions françaises inventées → corpus WAV → affinage **Piper** depuis `fr_FR-siwis-medium` (checkpoint MIT, jeu Siwis CC-BY 4.0 pour la base technique seulement) → `fr_FR-jarvis-medium.onnx`.

## Licences et prix (vérifiés 2026-11-03)

Voir `voice-studio/LICENCES.md`. Synthèse :

| Composant | Licence / prix |
| --- | --- |
| Parler-TTS | Apache-2.0 |
| Piper (piper1-gpl) | GPL-3.0-or-later (binaire séparé) |
| espeak-ng | GPL (binaire séparé) |
| Poids Piper fr | MIT + jeu d'entraînement CC-BY 4.0 (carte MODEL_CARD) |
| Texte Common Voice | CC0 (phrases du projet) |
| Whisper (QC) | MIT |
| RunPod A5000 24 Go Secure | **0,27 $/h** |
| RunPod 3090 Secure | **0,50 $/h** |
| Vast.ai 3090 (médian page) | **~0,20 $/h** (marché) |

## Contrôles (après commits voice-studio, avant clôture)

- `npm run typecheck` : vert.
- `npm run lint` : vert (ignore `voice-studio/.venv/` ajouté à `eslint.config.js`).
- `npm test` : cœur **2130** passés ; bureau **620** passés, 6 ignorés ; tests `dotnet` passés dans cette VM (SDK présent).
- `chat-unchanged.test.ts` : **6/6** ; `ollama-unchanged.test.ts` : **3/3** ; aucun golden régénéré.
- `python -m pytest voice-studio` : **10/10**.

Scripts `--dry-run` exécutés : `inventer.py`, `corpus.py`, `entrainer_piper.py`.

## Ce qui n'a PAS été fait

- Aucune génération Parler/Piper réelle sur GPU ; aucun WAV commité.
- Aucune intégration dans `piperAssets.ts` (chantier 1 non fusionné) : seulement `INSTALLATION.md`.
- Téléchargement automatique des phrases Common Voice : **non** (pas d'URL stable ; l'utilisateur fournit `--sentences-file` depuis [commonvoice.mozilla.org/fr/datasets](https://commonvoice.mozilla.org/fr/datasets)).

## Questions pour l'utilisateur

1. Quelle candidate (`candidate-01` … `06`) préfères-tu après écoute de `comparer.html` ?
2. As-tu un export TSV de phrases françaises Common Voice prêt pour `corpus.py` ?
3. Veux-tu affiner depuis **siwis** ou **upmc** comme checkpoint Piper ?

---

## RAPPORT DE VÉRIFICATION

**Testé en vrai : PAS FAIT**

- Parler-TTS Mini sur GPU : non exécuté.
- Corpus 1 h 30 + Whisper réel : non exécuté.
- Affinage Piper + export ONNX utilisable : non exécuté.
- Écoute de la voix « Jarvis » dans l'appli : non (chantier 1 non fusionné ici).

**Testé en automatique : FAIT** — pytest 10/10, `--dry-run` des trois scripts, `npm run typecheck`, `npm run lint`, `npm test`, tests figés chat/ollama.
