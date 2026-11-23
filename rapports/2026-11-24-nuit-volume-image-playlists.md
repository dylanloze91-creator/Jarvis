# Nuit du 23 au 24 novembre : volume, état de l'image, playlists et albums (Jarvis Test)

Branche `claude/nuit-test-1124`, partie de `claude/dev`. **Rien dans Live, rien de publié.** Phrases d'essai écrites par Claude, jamais les tiennes. Jarvis Test, Ollama et la carte graphique ont été réservés dans `AGENTS-COORDINATION.md` avant l'essai, puis libérés ; l'agent Yeux n'en avait pas besoin pendant ce temps (il prenait encore ses photos).

## 1. Volume de l'enceinte à la voix, plafond 70

Avant : « monte le volume de l'enceinte » partait au modèle, qui répondait qu'il ne pouvait pas.

- Les phrases de volume sont lues par règles, sans modèle (`packages/core/src/media/volumeIntent.ts`) : « mets le volume à 40 », « volume à cinquante », « monte le son de l'enceinte », « plus fort », « baisse un peu le son », « moins fort ».
- Le volume chiffré appelle `spotify_set_volume`. « Plus fort » et « moins fort » appellent un nouvel outil interne, `spotify_volume_step` : il relit le volume, ajoute ou retire 10, puis relit ce que Spotify a vraiment appliqué. Le modèle ne voit pas cet outil.
- **Le plafond de l'enceinte ne change pas** : c'est toujours le fournisseur Spotify qui l'applique (`spotifySpeakerMaxVolume`, 70 par défaut). Au plafond, Jarvis dit « Volume Spotify réglé à 70 % : c'est le plafond de sécurité de l'enceinte. » et ne prétend pas avoir monté. À l'enceinte, la phrase courte dit le volume réellement appliqué (« Volume à 70, c'est le maximum pour l'enceinte. »), pas le chiffre demandé.
- Ce qui n'est pas la musique reste au modèle : « baisse le volume du PC », « monte le son de la vidéo », « baisse le micro », « baisse un peu » seul (ça peut viser la lumière).

## 2. « Elle en est où, l'image ? »

Avant : le modèle répondait « en cours » sans rien savoir.

- Le service des images garde maintenant l'état réel : rien, en cours (depuis quand, dernière étape, avancement de Forge), finie (fichier), ratée (raison) (`ImagesService.jobReport`).
- La question est lue par règles (`packages/core/src/images/jobStatus.ts`), avant tout modèle, et la réponse vient seulement de cet état. Sans état connu, Jarvis le dit (« Je ne sais pas… » ou « le module images est coupé »).
- **Essai réel, cette nuit, dans Jarvis Test** (une image lancée par le panneau « Imager direct », questions tapées dans la discussion) :
  - avant : « Aucune image n'est en cours, et je n'en ai fait aucune depuis le démarrage de Jarvis. »
  - pendant le démarrage de Forge : « L'image est en cours depuis 51 s. Dernière étape : Je démarre Forge… »
  - pendant la fabrication : « … Forge en est à 38 % … »
  - après : « Aucune image en cours. La dernière est finie il y a 7 s : 002537-a-red-fox-sitting-in-fresh-snow-morning-1.png. »
- Corrigé après l'essai : à 1 %, Forge annonçait « encore 2 h 42 » (chargement du modèle), et à 38 %, « 4 min » pour une image finie une minute après. Son estimation n'est plus dite avant 10 %, et elle est présentée comme la sienne (« Forge estime encore … »).
- L'image d'essai est restée dans `C:\dev\Jarvis_images\perso\2026-11-24\` (un renard dans la neige) : tu peux l'effacer.

## 3. Playlists et albums

Avant : « mets la playlist Chill » cherchait un morceau nommé « la playlist Chill ».

- Les phrases sont lues par règles (`packages/core/src/media/collectionIntent.ts`) : « mets la playlist … », « lance ma playlist … », « joue l'album … de … », « tu peux me mettre la playlist … ». L'appareil dit en fin de phrase (« sur la Devialet ») est gardé, comme pour un morceau.
- Elles appellent un nouvel outil interne, `spotify_play_collection`, sans modèle. Pour « ma playlist », Jarvis regarde d'abord tes playlists (`/me/playlists`), sinon la recherche de Spotify.
- La lecture est vérifiée : ce contexte doit jouer sur l'appareil (`SpotifyProvider.playCollection`). Sinon, l'échec est dit, jamais « Lecture ». La réponse dit l'appareil et le morceau en cours.

## Essais faits et pas faits

| Essai | Résultat |
| --- | --- |
| État de l'image, sans image, puis avec une vraie image | bon (ci-dessus) |
| « Monte le son de l'enceinte », « Mets le volume à 90 » tapés | l'outil est bien appelé sans modèle (équipe Musique, express) ; Spotify n'est pas connecté dans Jarvis Test, donc réponse « Spotify n'est pas connecté » |
| Volume et playlists avec de la vraie musique | **pas fait** : Spotify n'est pas connecté dans Jarvis Test, et je n'ai pas voulu faire jouer de la musique la nuit |
| À la voix, à l'enceinte | **pas fait** |

Note : la fenêtre de Jarvis Test a lu à voix haute cinq réponses d'essai (synthèse Piper), alors que les questions étaient tapées.

## Ce qui demande ton accord

1. **Connecter Spotify dans Jarvis Test** (Réglages → Musique → Se connecter) : c'est un jeton à toi. Sans lui, volume et playlists ne peuvent pas être essayés pour de vrai. Ensuite, essais à la voix avec toi.
2. **Tes playlists privées** : `/me/playlists` ne rend que les playlists publiques avec les droits actuels. Pour les privées, il faut ajouter le droit `playlist-read-private`, puis te reconnecter. Pour « mets mes titres likés », il faudrait aussi `user-library-read`. Rien n'est ajouté sans ton accord.
3. **« Sur la Devialet ou sur le PC ? »** : pour une playlist ou un album, Jarvis ne pose pas cette question. Il joue sur l'appareil nommé dans la phrase, sinon sur l'appareil habituel. Faut-il la poser comme pour un morceau ?
4. **Dans la fenêtre**, une question envoyée pendant qu'une image se fait **dans la même discussion** arrête l'image. C'est le comportement de tout nouveau message. À l'enceinte, le problème ne se pose pas : l'image a sa propre session. Veux-tu que « où en est l'image ? » ne coupe jamais l'image en cours ?
5. **Les deux outils internes ne sont enregistrés que si Spotify est réglé** (`spotifyClientId`). Sans cela, ils ne servent à rien, et la liste d'outils figée d'une installation neuve (`chat-unchanged.test.ts`, `catalogue-risques`) reste identique. Je ne l'ai pas régénérée. Si tu préfères les enregistrer toujours, ce fichier figé devra être mis à jour avec ton accord.
6. **Forge a mis environ 5 minutes à démarrer cette nuit** (22 à 51 s le 20 novembre). Cela se passe hors de Jarvis ; c'est à regarder.
7. **L'installateur de Jarvis Test n'a pas été refait** : l'installé est toujours `5.1.0-test.2`, sans ces changements. Le refaire est à décider.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npm run build du cœur ; electron-vite dev en édition Test pour l'essai)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : cœur 250 fichiers verts ; bureau 180 verts, 4 ignorés, 1 en échec sous charge (platformerMissionPath.test.ts, délai de 10 s ; vert seul, et en échec aussi sans ces changements) ; aucun __golden__ régénéré
Secrets   : OK (aucune clé ; phrases d'essai écrites par Claude)
Fichiers  : media/volumeIntent.ts, media/collectionIntent.ts, images/jobStatus.ts (+ tests), agent/agent.ts, media/playIntent.ts, media/types.ts, speaker/reflex.ts, tools/spotify.ts, media/SpotifyProvider.ts, images/ImagesService.ts, session.ts, speaker/server.ts
Prêt à fusionner : OUI dans claude/dev (Jarvis Test) ; jamais dans Live
Testé en vrai (à la voix, sur le PC) : PAS FAIT à la voix ; tapé dans Jarvis Test : état de l'image avec une vraie image (bon), volume sans Spotify connecté (outil appelé, Spotify absent)
```
