# Live 5.0.80 : suite des corrections après les essais du 20 novembre

Écrit par Claude (le chat), depuis le cloud, à la demande de l'utilisateur (« fais la correction toi-même »), le 20 novembre 2026 au soir.
Branche `claude/corrections-5080-suite`, partie de `claude/live-5080`.
Corrections seulement, aucune nouveauté.
Points traités : « Ce qui coince », 1 à 4, de `rapports/2026-11-19-live-5080-a-verifier.md` § 7.

## Les corrections

| # | Défaut vu par Claude Code | Correction |
| --- | --- | --- |
| 1 | À l'enceinte, « quelle fenêtre est active » ratait 4 fois sur 6 : le modèle écrivait `{get_active_window}` au lieu d'appeler l'outil | Règle express `fenetre-active` : l'outil est appelé **sans modèle**. La réponse dite est une phrase courte (« Fenêtre active : Jarvis. »), la liste des fenêtres reste dans la bulle. En plus, filet général en mode orchestre : un nom d'outil seul entre accolades devient un vrai appel, seulement pour un outil proposé et sans paramètre obligatoire |
| 2 | « Non, la capitale de l'Australie est Canberra » rejetait une fiche sans rapport | Deux fiches se contredisent seulement si elles partagent des mots du sujet : « non », « la », « est » ne comptent plus |
| 3a | « morceau précédent » : erreur 403 en anglais | Phrase en français : un morceau lancé seul n'a pas de précédent, demande un album ou une playlist |
| 3b | « suivant » arrêtait la musique en disant « Morceau suivant. » | L'état de Spotify est relu après le changement : Jarvis dit le vrai morceau, ou que la lecture s'est arrêtée |
| 3c | « pause » déjà en pause : 403 en anglais | « Spotify était déjà en pause. » (et « Spotify joue déjà. » pour « reprends ») |
| 3d | « morceau suivant / précédent » : 17 à 33 s (petit modèle sur le processeur) | Partent **sans modèle**, comme la pause (« morceau suivant », « chanson précédente », « change de morceau »… ; « suivant » seul ne suffit pas) |
| 4 | « Pourquoi mon PC est lent en ce moment ? » partait sur Internet | « en ce moment » ou « aujourd'hui » seuls ne comptent plus quand la phrase parle de mes affaires ou de la machine. Les mots explicites (Internet, actualités, météo) gardent la main |

**Pas fait, parce que ce ne sont pas des corrections, ou parce que c'est à l'utilisateur de décider :**
- lancer un morceau dans son album, pour que « suivant » et « précédent » marchent vraiment ;
- le vouvoiement du caractère « majordome » ;
- la longueur de la réponse « informations sur mon PC » à l'enceinte (E6), en attente de l'écoute de l'utilisateur.

## Essais

Dans le cloud, npm reste bloqué, mais des copies de `zod` (3.25, qui contient l'API v4) et des types de Node étaient présentes sur la machine. J'ai monté avec elles un petit lanceur d'essais compatible avec Vitest. Ce n'est pas le vrai Vitest : les échecs dus au lanceur lui-même (modules simulés par `vi.mock`, versions de `zod`) sont identiques avant et après les corrections.

- **Cœur, tous les fichiers d'essai (217)** : 2 415 réussis avec les corrections, contre 2 399 avant. Les 16 de plus sont les nouveaux essais. Les 66 échecs sont les mêmes avant et après (limites du lanceur). **Aucune régression.**
- **Bureau, discussion réelle** :
  - `orchestra-session` 17/17, `speaker-session` 2/2, `addressee-session` 7/7, `corrections-5080-session` 6/6 (dont 2 nouveaux : la fenêtre active dite à l'enceinte, sans modèle) ;
  - `spotify-suivant-5080` (nouveau) 8/8 ;
  - Spotify de `corrections-5080` : réussis.
- **`chat-unchanged` (fichiers figés)** : sa sortie est **identique octet pour octet** avant et après les corrections. Ici, 4 essais sur 6 échouent avant comme après, à cause de la version de `zod` de la machine (format du catalogue). Le vrai `npm test` sur le PC doit le confirmer vert.
- **Types** : aucune erreur dans le code du cœur ni dans `tools/spotify.ts`.

**Pas lancés ici** : `npm run typecheck`, `npm test` et `npm run lint` officiels (npm bloqué), la fenêtre, la voix, le vrai Spotify.

## À faire par Claude Code sur le PC

1. `npm run typecheck`, `npm test`, `npm run lint` sur cette branche. `chat-unchanged`, `ollama-unchanged` et `orchestra-session` doivent rester verts sans régénération.
2. Reporter dans Jarvis Test (`claude/dev`) puis dans `claude/live-5080`.
3. Refaire E2 (fenêtre active à la fausse enceinte, 10 fois), E5 (« mon PC est lent »), E8 (correction) et E11 (Spotify avec une playlist puis un morceau seul : pause en double, suivant, précédent).
4. Garder pour l'utilisateur : une phrase à la vraie enceinte avec sa voix, et l'écoute de E6.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : PAS FAIT (npm bloqué dans le cloud)
Types     : OK pour le cœur et tools/spotify.ts avec tsc et zod 3.25/v4 de la machine ; officiel à refaire
Style     : PAS FAIT (eslint absent)
Tests     : OK avec un lanceur compatible : cœur 2415/2481 (les 66 échecs sont identiques avant et après : limites du lanceur), bureau 33 essais concernés OK, chat-unchanged identique avant/après
Secrets   : OK (aucune clé, aucune phrase de l'utilisateur ; phrases d'essai inventées)
Fichiers modifiés : agent/expressRules.ts, providers/toolCallRecovery.ts, learning/continuous.ts, media/playIntent.ts, agent/agent.ts, index.ts ; bureau tools/spotify.ts ; essais expressRules, toolCallRecovery, ollama-recover, memoire-5080, playIntent, agent, corrections-5080-session, spotify-suivant-5080 (nouveau) ; CLAUDE.md, AGENTS-COORDINATION.md, ce rapport
Prêt à fusionner : OUI dans claude/dev après les contrôles officiels sur le PC ; dans main seulement par claude/live-5080, après les essais et le « publie » de l'utilisateur
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```
