# Spotify — choix d’appareil à la voix

Date : 2026-11-07. Branche : `cursor/spotify-voix-appareil`. Base finale : `origin/main` **5.0.70** (démarrage sur 5.0.69, fusion `--no-ff` en fin de travail).

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

## Corrections de relecture

Deux trous du premier jet, corrigés sur la même branche (pas de fusion dans `main`).

1. **Nom d’appareil.** Un indice `named` n’est gardé que s’il correspond à un appareil Spotify Connect visible, avec la même comparaison que `pickNamedConnectDevice` (casse, accents, nom partiel). Sinon l’indice est ignoré : la recherche part avec la phrase entière (« Il pleut sur la ville ») et la lecture va sur l’appareil habituel (`spotifyDeviceName`, sinon le PC). Ça vaut pour `spotify_play` quand l’agent force l’appel et quand le modèle passe la requête directement. `spotify_transfer` vers un nom inconnu répond `Je ne vois pas d'appareil appelé X`, n’appelle pas `transferPlayback`, donc pas de PUT. « l’enceinte », « le PC » et « l’ordinateur » restent des cibles (l’élision `l’ordinateur` n’était pas reconnue ; elle l’est maintenant, comme le PC). Le choix enceinte (réglage, seule enceinte, ou question s’il y en a plusieurs) n’a pas été modifié dans `SpotifyProvider`.

2. **Indice de tour.** `stashSpotifyPlayDeviceHint` est effacé au début de `Agent.run` et dans un `finally` (succès, arrêt, erreur). Il n’est lu que par le `spotify_play` du même tour. Un tour arrêté avant l’outil ne laisse plus la Devialet au « mets Jul » suivant.

Règles gelées : `catalogue-modele.json` et `reglages-par-defaut.json` sont identiques à `origin/main` (mêmes SHA git `6ca8dd89` et `71494b6c`). `parseSettings` n’a pas été touché. La description catalogue de `spotify_play` est inchangée. `spotify_transfer` reste absent du catalogue sans enceinte réglée.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npm test, pas d’appli lancée)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : OK — cœur 2246, bureau 679 réussis et 6 ignorés (preuves live)
            chat-unchanged 6/6, ollama-unchanged 3/3, golden non régénéré
            dotnet : pas de SDK sur cette machine (dotnet absent).
            dotnetProject.test.ts et windowsDesktopMissionPath.test.ts
            sont verts : le vrai SDK est sauté quand installedDotnetTarget()
            est null ; le chemin simulé (ENOENT) n’a pas été affaibli.
Secrets   : rien dans le diff (pas de jeton, pas de clé)
Diff      : relu — requête entière si le nom n’est pas visible ;
            transfert inconnu sans PUT ; indice effacé en début et fin de tour
Fichiers modifiés : AGENTS-COORDINATION.md,
            packages/core/src/media/playIntent.ts,
            packages/core/src/media/playIntent.test.ts,
            packages/core/src/media/spotifyDeviceVoice.ts,
            packages/core/src/index.ts,
            packages/core/src/agent/agent.ts,
            packages/core/src/agent/agent.test.ts,
            apps/desktop/src/main/tools/spotify.ts,
            apps/desktop/src/main/tools/spotify.test.ts,
            rapports/2026-11-07-spotify-voix-appareil.md
Prêt à fusionner : OUI sur la branche, pas dans main
À corriger : rien côté CI cloud
Testé en vrai (à la voix, sur le PC) : PAS FAIT
Phrases à essayer :
  - « mets Il pleut sur la ville »
  - « mets Daft Punk sur l'enceinte »
```
