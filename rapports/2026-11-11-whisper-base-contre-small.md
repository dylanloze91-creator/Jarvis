# Whisper : `whisper-base` contre `whisper-small` sur les vraies phrases — 11 novembre 2026

Branche `claude/enceinte-micro-diagnostic` (suite de la 5.0.76). Chiffres seulement : les enregistrements et les transcriptions restent hors dépôt (`C:\dev\jarvis-data\enceinte-capture\comparaison\`). Pas de fusion, pas de publication.

## Protocole

- 20 phrases écrites d'avance (heure, date, Spotify, météo, image, question, PC, calcul, mémoire, actualités), lues par l'utilisateur **à l'enceinte « chambre »** puis **au PC**. Liste : `C:\dev\jarvis-data\enceinte-capture\phrases-comparaison.txt`.
- Enceinte : 10 phrases captées (3 par un enregistreur à la place du pont, 7 par un relais transparent devant Jarvis 5.0.76 qui répondait normalement). La séance a été interrompue une fois : la mise à jour 5.0.76 a relancé Jarvis pendant l'essai, l'enregistreur répondait « rien à dire » et l'utilisateur a cru l'enceinte en panne.
- PC : quatre micros enregistrés en même temps par ffmpeg (GoXLR chat et mix, webcam C922, casque Corsair) ; seule la webcam portait la voix. Découpage par silence : 14 segments gardés, qui mêlent les phrases lues et des mots dits à l'assistant pendant la séance.
- Transcription hors Jarvis, dans Electron 44 nu (même transformers.js 4.3, même runtime ONNX wasm, modèles q8 locaux), un passage par configuration sur les mêmes 24 fichiers, WAV de 2 à 10 s. Le premier appel de chaque passage paie l'initialisation et n'est pas compté.

## Vitesse (PC de l'utilisateur, i7 10e génération)

| Configuration | Chargement | Transcription médiane | Moyenne | Max |
| --- | --- | --- | --- | --- |
| `whisper-small` q8, 4 threads (réglage de la 5.0.76) | 3,3 s | **4,80 s** | 4,82 s | 5,85 s |
| `whisper-small` q8, 6 threads | 3,6 s | 4,58 s | 4,56 s | 5,45 s |
| `whisper-base` q8, 4 threads | 2,1 s | **1,94 s** | 1,94 s | 2,41 s |

6 threads au lieu de 4 : 5 % de mieux, pas de quoi changer le réglage (les 2 autres cœurs servent à Ollama et à l'interface). `base` est 2,5 fois plus rapide que `small`.

## Exactitude (juste, ou assez juste pour que Jarvis fasse la bonne chose)

| Jeu | Phrases | `small` 4 threads | `small` 6 threads | `base` 4 threads |
| --- | --- | --- | --- | --- |
| Enceinte (10 phrases lues) | 10 | **5** (heure, musique sur l'enceinte, pause, ouvre Chrome, 12 × 37) | 5 (mêmes) | **2** (12 × 37, musique) |
| PC, webcam (14 segments) | 14 | **9** dont les 3 questions d'heure et la demande de musique ; 3 segments rendus « … » | 9 | **6** : les 3 questions d'heure toutes fausses, la musique fausse, l'heure dite par Jarvis juste |

Lecture : sur les commandes courtes qui comptent (« quelle heure est-il », « mets de la musique sur la Devialet », « mets en pause »), `base` se trompe presque toujours là où `small` passe. Les phrases longues de conversation sont bonnes avec les deux. Les 5 ratés de `small` à l'enceinte sont des sons abîmés : saturation (jusqu'à 3,38 % d'échantillons écrêtés et 5,5 % au-dessus de 20 000 sur une phrase ratée, gain micro ×8) ou voix de loin.

## Décision

- **`whisper-small` reste le modèle par défaut**, 4 threads : `base` n'atteint pas son exactitude (règle 4 de la demande).
- **Réglage proposé, non fait** : « Transcription : précise (défaut) / rapide », `voice.whisperModel` facultatif, **sans défaut Zod** (absent = `small`), `whisper-base` livré à côté de `small` (+77 Mo dans l'installateur, +48 Mo compressés ; retiré de l'installateur 5.0.76 où il était passé par erreur), choix du dépôt dans `WHISPER_MODEL_REPO` → fonction du réglage, lu par le worker au chargement. Utile seulement si l'utilisateur préfère 2 s de latence à 2,5 fois plus d'erreurs sur les commandes courtes.
- **À faire d'abord sur la carte** : passer le gain micro à ×4 (`MIC_SHIFT 14`) pour supprimer la saturation, en gardant le passe-haut 60 Hz en deux étages qui préserve le mot de réveil ; puis vérifier le réveil avec l'utilisateur. C'est le son, pas le modèle, qui limite l'enceinte aujourd'hui.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (3 passages de transcription dans Electron nu, 24 fichiers chacun, 0 erreur)
Types     : OK (aucun code de Jarvis modifié par cette comparaison)
Style     : OK
Tests     : sans objet (mesure) ; firmware MIC_SHIFT 14 flashé sur la carte « chambre »
Secrets   : OK (enregistrements, transcriptions et liste lue hors dépôt ; aucune phrase de l'utilisateur dans ce rapport)
Fichiers modifiés : ce rapport, CLAUDE.md, firmware/jarvis-speaker/include/config.h (MIC_SHIFT 14)
Prêt à fusionner : PAS FAIT (demande : pas de fusion)
À corriger : réglage rapide/précise si l'utilisateur le veut
Testé en vrai (à la voix, sur le PC) : FAIT (mesure sur les phrases de l'utilisateur ; gain ×4 : réveil de loin 3/3, phrase de près et de loin comprises, dans la chambre)
```
