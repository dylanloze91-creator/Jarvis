# Enceinte, oreilles et bouche — 10 novembre 2026

Cahier : `docs/specs/enceinte-oreilles-bouche.md` (branche `claude/specs-enceinte-bouche`). Version de l'application inchangée : **5.0.71**. Pas de fusion dans `main`, pas de publication. `firmware/jarvis-speaker/` n'a pas été touché (réservé, `cursor/enceinte-materiel` encore en cours).

**Non testé avec la vraie enceinte.**

## Partie 2 — Spotify « Devialet ou PC ? »

Branche `cursor/spotify-voix-appareil` (mise à jour depuis `origin/main` 5.0.71, sans `--force`).

Réglage facultatif `spotifyAskDevice`, sans défaut Zod : `parseSettings({})` ne gagne pas la clé. Réglages → Services → Musique : « Me demander où jouer la musique ». Absent ou faux : comme avant (enceinte du réglage `spotifyDeviceName`, sinon le PC).

Activé, et la phrase ne nomme pas d'appareil (« mets Daft Punk », « mets autre chose ») :

- si une musique joue déjà, on joue sur cet appareil, sans question ;
- sinon Jarvis demande avec les vrais noms, trois enceintes au plus : « Sur la Devialet ou sur le PC ? » ;
- la recherche est gardée 60 secondes dans la session (fenêtre, téléphone, chaque enceinte ont la leur).

Réponses sans « Jarvis » : « la Devialet », « l'enceinte », « sur le PC », « l'ordi », « l'ordinateur », le nom d'un appareil visible, « peu importe » / « comme d'habitude » (appareil du réglage). Réponse floue : une relance « Devialet ou PC ? », puis l'appareil du réglage, et c'est dit. Une phrase qui nomme déjà l'appareil ne pose pas la question. Express, sans modèle. `spotify_transfer` reste absent du catalogue tant qu'aucune enceinte Connect n'est choisie. « stop » et « pause » n'attendent jamais la question : pause tout de suite, la recherche en attente est annulée.

Depuis l'enceinte, la question met `X-Jarvis-Continue: 1` même si la fenêtre de suivi est à 0.

## Partie 1 — ce qui se regarde va sur l'écran du PC

Branche `cursor/enceinte-ecran-pc`, partie de `origin/main` (trop de fichiers pour la branche Spotify).

Une réponse d'enceinte qui contient une image générée, une liste ou un tableau, du code, des sources, un document, ou plus de trois phrases :

- la fenêtre du PC s'affiche avec `showInactive` (sans prendre le clavier ; si « masquer au clic ailleurs » est actif, elle reste jusqu'au prochain focus) sur la discussion de cette enceinte (« Salon · … ») ;
- l'enceinte dit une phrase courte : « C'est fait, l'image est sur l'écran du PC. », « Je t'ai mis la liste sur le PC. », ou deux ou trois phrases puis « Le détail est sur le PC. ».

Une demande d'image (« génère une image… ») ne bloque pas la carte : elle reçoit tout de suite « Je la prépare sur le PC, ça prend environ une minute. » Imager n'a pas de durée estimée avant le calcul, donc cette phrase fixe. Le calcul continue sur le PC. **Il n'existe pas de canal pour reparler à l'enceinte une fois la réponse HTTP partie : la phrase de fin n'est pas dite, elle est dans la discussion affichée sur le PC** (et l'image s'ouvre selon `openAfterGeneration`, comme avant). Le téléphone voit la même discussion dans l'historique du PC.

Une carte de confirmation reste refusée depuis l'enceinte (`SPEAKER_CONFIRMATION_REFUSAL`). Une mission n'est pas lancée : Jarvis dit de la valider sur le PC ou le téléphone, et la carte s'affiche sur le PC. Un tour tapé ou dit au PC ne change pas.

## Ce qui n'a pas bougé

`chat-unchanged`, `ollama-unchanged`, `orchestra-session` verts, `__golden__` non régénérés. Un seul modèle Ollama : aucun autre n'a été tiré. `npm run lab` et `npm run lab:generate` n'ont pas été lancés.

## Commandes (les deux branches, 10 novembre 2026)

| Commande | `cursor/spotify-voix-appareil` | `cursor/enceinte-ecran-pc` |
| --- | --- | --- |
| `npm run typecheck` | OK, 0 erreur | OK, 0 erreur |
| `npm test` | OK, 0 échec. Cœur 2295/2295. Bureau 700 réussis, 6 ignorés (706) | OK, 0 échec. Cœur 2282/2282. Bureau 698 réussis, 6 ignorés (704) |
| `npm run lint` | OK, 0 erreur, 0 avertissement | OK, 0 erreur, 0 avertissement |

`dotnet` est absent. Les contrôles qui lanceraient le vrai SDK (`.exe`) s'arrêtent avant (`installedDotnetTarget()` nul) : ils ne font pas échouer la suite. Aucun autre échec.

`npm run build` du bureau (Electron, modèles voix) n'a pas été lancé.

```
RAPPORT DE VÉRIFICATION
Lancement : non exécuté (build Electron non lancé)
Types     : OK (0 erreur) sur les deux branches
Style     : OK (0 avertissement) sur les deux branches
Tests     : OK (0 échec ; voir le tableau)
Secrets   : OK (0 vraie valeur ; seulement des clés factices de tests déjà dans le dépôt)
Fichiers modifiés : partie 2 sur cursor/spotify-voix-appareil (réglage spotifyAskDevice, question 60 s, en-tête Continue) ; partie 1 sur cursor/enceinte-ecran-pc (phrase courte, showInactive, image non bloquante)
Prêt à fusionner : NON
À corriger : rejouer npm run build sur le PC Windows ; essayer avec la vraie enceinte (voir ci-dessous). Pas de fusion demandée.
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```

À essayer soi-même, enceinte allumée, réglage « Me demander où jouer la musique » activé :

1. « Jarvis, mets Daft Punk. » → « Sur la Devialet ou sur le PC ? », le micro reste ouvert. « La Devialet » → lecture sur la Devialet.
2. « Jarvis, génère une image d'un chat. » → tout de suite « Je la prépare sur le PC, ça prend environ une minute. » Le micro se referme. La fenêtre du PC montre la discussion du salon, sans passer devant ce que vous tapez ailleurs. L'image s'ouvre sur le PC ; l'enceinte ne redit pas la fin.
3. « Pause » pendant la question Spotify → pause tout de suite, pas une nouvelle question.

## Correction de relecture

Branche `cursor/enceinte-ecran-pc` seulement. Pendant qu'une image lancée depuis l'enceinte tourne encore :

- après « Je la prépare sur le PC, ça prend environ une minute. », `X-Jarvis-Continue` vaut **0** : le micro se referme, il faut redire « Jarvis » ;
- une nouvelle phrase (« mets de la musique ») part dans **une autre session** et une **nouvelle** discussion « Salon · … ». Elle n'entre pas dans la session de l'image, donc elle ne l'annule pas ;
- la musique est dite normalement. L'image continue et s'affiche sur le PC quand elle est prête ;
- ensuite l'enceinte redevient normale : la phrase suivante, si elle arrive dans les 10 minutes, reprend la discussion de l'image.

Test : phrase « mets de la musique » pendant une image → l'image n'est pas annulée et s'affiche ; la réponse musique arrive ; `X-Jarvis-Continue` est 0 après la phrase d'attente.

### Commandes de la correction (10 novembre 2026, `cursor/enceinte-ecran-pc`)

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | OK, 0 erreur |
| `npm test` | OK, 0 échec. Bureau 699 réussis, 6 ignorés (705). `chat-unchanged`, `ollama-unchanged`, `orchestra-session` verts, `__golden__` non régénérés. |
| `npm run lint` | OK, 0 erreur, 0 avertissement |

`dotnet` absent : les contrôles `.exe` ne lancent pas le vrai SDK et ne font pas échouer la suite. `parseSettings({})` ne gagne aucune clé. **Non testé avec la vraie enceinte.**

```
RAPPORT DE VÉRIFICATION
Lancement : non exécuté (build Electron non lancé)
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : OK (bureau 699/705 réussis, 6 ignorés, 0 échec)
Secrets   : OK (0 vraie valeur ajoutée)
Fichiers modifiés : apps/desktop/src/main/speaker/server.ts, apps/desktop/src/main/speaker/server.test.ts, AGENTS-COORDINATION.md, rapports/2026-11-10-enceinte-oreilles-bouche.md
Prêt à fusionner : NON
À corriger : rejouer npm run build sur le PC Windows ; essayer avec la vraie enceinte. Pas de fusion demandée.
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```

À essayer : « Jarvis, génère une image d'un chat », puis, une fois le micro refermé, « Jarvis, mets de la musique ». La musique répond. L'image apparaît ensuite sur le PC, sans avoir été coupée. Une phrase dans les 10 minutes d'après reprend la discussion de l'image.
