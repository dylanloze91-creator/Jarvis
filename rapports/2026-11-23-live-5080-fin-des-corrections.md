# Live 5.0.80 : fin des corrections (23 novembre 2026)

Tu as arrêté les corrections le 23 novembre au soir. Branche `claude/corrections-5080-suite` (elle contient `claude/live-5080`). **Rien n'est fusionné dans `main`, rien n'est publié.** Les essais et leurs passages sont détaillés dans `rapports/2026-11-19-live-5080-a-verifier.md`, §§ 7 et 9 ; les numéros E1 à E17 sont ceux de son § 4.

Après les essais, la fenêtre de développement est fermée et Jarvis Live 5.0.79 est relancé ; le pont des enceintes répond de nouveau.

## 1. Bilan des essais

| # | Essai | Résultat final |
| --- | --- | --- |
| E1 | Fenêtre active, discussion neuve, au clavier | bon (20 nov.) |
| E2 | Fenêtre active à l'enceinte | bon, 3 sur 3 à ta voix (23 nov.), après la règle express `fenetre-active` |
| E3 | Informations du PC sans modèle | bon |
| E4 | Fenêtre active juste après | bon |
| E5 | « Pourquoi mon PC est lent en ce moment ? » | bon : plus d'Internet (23 nov.) |
| E6 | Informations du PC à l'enceinte | bon au 2e passage, après la correction de « ou » / « où » |
| E7 | « Non merci, pas maintenant » rangé « candidate » | bon |
| E8 | Vraie correction, sans toucher une autre fiche | bon (23 nov.) |
| E9 | Anciennes fiches en « non » gardées, plus rappelées | bon |
| E10 | « Stop la musique » sans lecture | bon |
| E11 | pause, reprise, suivant, précédent | pause, suivant, précédent bons ; **reprise (« play ») encore fragile à la voix**, voir § 3 |
| E12 | Liste des processus | bon |
| E13 | YouTube sans lien | bon : Jarvis demande le lien |
| E14 | Heure, bourse, calcul sans modèle | bon |
| E15 | Question à l'enceinte, Ctrl+Espace | bon |
| E16 | Pas de rechargement du 7B entre fenêtre et enceinte | bon |
| E17 | Pas de second rechargement après une image | bon (`-c 8192` partout) |

## 2. Ce qui est corrigé dans la 5.0.80

Corrections du 19 novembre (`rapports/2026-11-19-corrections-5080.md`) : mémoire apprise, règle express « informations sur mon PC », pause Spotify sans lecture, `list_processes`, lien YouTube inventé.

Suite du 20 novembre (`rapports/2026-11-20-corrections-5080-suite.md`) : fenêtre active à la voix (E2), correction qui rejetait une fiche sans rapport (E8), messages Spotify en français et morceau relu après suivant / précédent (E11), « en ce moment » qui partait sur Internet (E5), options Ollama alignées (E16, E17).

Corrections du 23 novembre, pendant les essais avec toi (commits `7675b3d`, `5a96ccf`, `ef33185`, `f174fba`, `f29a6ea`) :

1. **« ou » ne bloque plus les informations du PC** (E6, `agent/expressRules.ts`) : seules les vraies questions de lieu (« où est », « par où »…) vont au modèle.
2. **Pause sans modèle** (E11, `media/playIntent.ts`) : « mets pause », « mes pauses », « pose sur Spotify », « ok, juste pause »… ne cherchent plus de morceau. Un vrai titre (« Pause Café de … ») reste un titre.
3. **Reprise sans modèle** (E11) : « mets play », « mes play », « m'éplay », « juste play », « mets en lecture », « reprends la musique » reprennent la lecture. Méthode finale : les mots de remplissage et « Spotify » (même déformé : spotifie, potifie, spotifaille) sont retirés ; s'il reste exactement « pause / pose » ou « play / lecture », c'est le geste. « Pose une question à Spotify » et « Mets une pause de cinq minutes » n'en sont pas.
4. **Pendant la question « Sur la Phantom ou sur le PC ? »** (E11, `agent/agent.ts`) : pause, reprise, suivant et précédent passent avant et effacent la question au lieu de la reposer.
5. **Plus de texte technique lu par l'enceinte** (E11, `tools/spotify.ts`) : « Lecture vérifiée : is_playing=true… » est retiré.

Essais automatiques : `packages/core/src/essais-5080-23nov.test.ts` (phrases écrites pour l'essai), `agent.test.ts`, `tools/spotify.test.ts`.

## 3. Ce qui reste

- **« Spotify » entendu « ce pays »** (E11) : « Mes play sur ce pays » part au modèle, qui ne fait rien. Pas corrigé : « ce pays » est une vraie phrase française, l'accepter comme « Spotify » ferait des faux gestes. Conseil : dire « reprends la musique » plutôt que « play ».
- **Whisper invente d'autres fautes sur les mots anglais courts** (E11) : la méthode du 5e passage en couvre la plupart, mais une transcription très abîmée peut encore lancer un morceau. Le 5e passage n'a pas été réessayé à la voix.
- **Playlist ou album** (« mets la playlist … ») : Jarvis ne joue que des morceaux. C'est une nouveauté : d'abord dans Jarvis Test.
- **Volume de l'enceinte refusé par le modèle** (vu au 2e passage) alors que `spotify_set_volume` existe. À décider.
- **« Elle en est où, l'image ? »** : réponse inventée (« en cours »). À décider.
- **Longueur de la réponse E6 à l'oreille** et **vouvoiement du caractère « majordome »** : ton avis.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npm run build ; electron-vite dev relancé après chaque passage)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : OK au 5e passage (cœur 219 fichiers ; bureau 163 fichiers, 4 ignorés par leur propre condition ; aucun __golden__ régénéré)
Secrets   : OK (aucune clé ; phrases d'essai écrites par Claude, aucune des tiennes)
Fichiers modifiés le 23 : agent/expressRules.ts, agent/agent.ts, media/playIntent.ts, tools/spotify.ts, essais-5080-23nov.test.ts, agent.test.ts, spotify.test.ts, rapports
Prêt à fusionner : OUI pour la Live après ton « publie »
Testé en vrai (à la voix, sur le PC) : FAIT avec ta voix à la vraie enceinte, sauf le 5e passage (pause / play après retrait des mots de remplissage), non réessayé
```
