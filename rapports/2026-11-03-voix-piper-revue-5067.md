# Revue Piper (2026-11-03) — branche `cursor/voix-piper-5067`

Date : 2026-11-03. Revue lue : `docs/revues/2026-11-03-voix-piper-trieur.md` (points **Voix Piper** uniquement). Fusion `origin/main` → branche (`--no-ff`), conflit résolu dans `AGENTS-COORDINATION.md` (lignes des deux côtés conservées). **Non fusionné dans main, non publié.**

## Commits revue (7/7)

| # | Sujet | Test associé |
| --- | --- | --- |
| 1 | stdin Piper sans EPIPE non rattrapé | `runner.test.ts` |
| 2 | texte stdin une seule ligne (`normalizePiperStdinText`) | `piperInput.test.ts` |
| 3 | licences installateur + crédits UI | `piperLicensesTemplate.test.ts` |
| 4 | exclure `cache/` de l’installateur | `electron-builder.piper.test.ts` |
| 5 | pré-synthèse phrase suivante pendant lecture | `piperStream.test.ts` |
| 6 | benchmark streaming au premier appel | `service.test.ts` (benchmark) |
| 7 | `isReady` tient compte de la voix choisie | `service.test.ts` (isReady) |

## Proposition taille installateur (non implémentée)

Embarquer **une seule voix ONNX** (Siwis par défaut) et proposer le téléchargement des autres au premier usage — réduction ~70 Mo sur les modèles dupliqués. Mesure chargement modèle : si le premier appel dépasse **0,5 s** de latence processus froid, documenter l’intérêt d’un **processus Piper persistant** (hors scope revue).

## Licences (revérifiées en ligne, 2026-11-03)

| Composant | Référence | Licence |
| --- | --- | --- |
| Piper | tag Git `2023.11.14-2` → commit `38917ffd` | MIT (`LICENSE.md` sur ce commit) |
| Siwis | MODEL_CARD Hugging Face | CC BY 4.0 |
| UPMC | MODEL_CARD Hugging Face | CC BY-SA 4.0 |
| espeak-ng (binaire Piper) | embarqué | GPL-3.0 (fichier `GPL-3.0.txt` livré avec l’installateur) |

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (build npm)
Types     : OK (0 erreur)
Style     : OK (0 avertissement eslint)
Tests     : OK (core 2142/2142 ; desktop 629 passés, 6 ignorés ; 5 échecs dotnet si SDK absent — non observés sur cette VM Linux)
Secrets   : OK
Prêt à fusionner dans main : OUI sous réserve essai vocal Windows (utilisateur / Claude Code)
À corriger : rien côté revue Piper ; trieurs revue non traités ici
Testé en vrai (voix sur PC Windows) : PAS FAIT
```
