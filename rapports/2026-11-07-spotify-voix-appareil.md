# Spotify — choix d’appareil à la voix

Date : 2026-11-07. Branche : `cursor/spotify-voix-appareil`. Base : `origin/main` (5.0.69 au démarrage, rebase sur 5.0.70 en fin de travail).

## Objectif

Sur la base de `spotifyDeviceName` (inchangé comme défaut bureau) :

- Phrases du type « mets X sur l’enceinte / sur la Devialet / sur le PC » : la partie « sur … » est retirée de la recherche ; l’appareil ne s’applique qu’à cette lecture.
- « l’enceinte » → enceinte des réglages, sinon la seule enceinte Connect visible, sinon question si plusieurs.
- « passe / transfère / mets-la sur … » : outil `spotify_transfer` (PUT `/me/player`, `play: true`, vérification de lecture sur l’appareil, plafond volume enceinte).
- Express orchestre → équipe Musique sans cerveau (inchangé, `isMusicIntent`).
- `spotify_transfer` dans le catalogue **uniquement** si une enceinte Connect autre que le PC est réglée ; sans réglage, `catalogue-modele.json` et `reglages-par-defaut.json` restent byte-identiques au golden.
- `parseSettings({})` : aucune clé nouvelle.

## Fichiers touchés

- `packages/core/src/media/spotifyDeviceVoice.ts` — suffixe appareil, transfert, tampon voix → exécution.
- `packages/core/src/media/playIntent.ts` — retrait suffixe dans `extractSpotifyPlayQuery`.
- `packages/core/src/agent/agent.ts` — forçage `spotify_play` / `spotify_transfer`.
- `packages/core/src/providers/mock.ts` — mock aligné.
- `apps/desktop/src/main/media/SpotifyProvider.ts` — lecture avec cible ponctuelle, `transferPlayback`.
- `apps/desktop/src/main/media/spotifyDevices.ts` — `listConnectSpeakers`.
- `apps/desktop/src/main/tools/spotify.ts` — transfert conditionnel, lecture avec indice appareil.

## Contrôles automatisés

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm test` (cœur + bureau) | OK (2232 + 673 tests, golden non régénéré) |
| `chat-unchanged.test.ts` | OK |
| `ollama-unchanged.test.ts` | OK (inclus dans la suite bureau) |

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (tests npm)
Types     : OK
Style     : OK
Tests     : OK (cœur + bureau, golden inchangé)
Fichiers modifiés : voir section Fichiers touchés
Prêt à fusionner : OUI (sur branche dédiée, pas dans main)
À corriger : rien côté CI cloud
Testé en vrai (à la voix, sur le PC) : PAS FAIT
Essais vocaux non faits sur le PC :
  - « mets Daft Punk sur l’enceinte »
  - « Sur la route de Memphis » (titre seul)
  - « mets Sur la route de Memphis sur l’enceinte »
  - « passe la musique sur le PC »
  - « mets-la sur la Devialet »
  - transfert avec enceinte absente / plusieurs enceintes
```
