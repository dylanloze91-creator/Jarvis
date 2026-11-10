# Jarvis Réflexe — 10 novembre 2026

Cahier : `docs/specs/enceinte-reflexe.md` (branche `claude/specs-enceinte-reflexe`). Branche `cursor/enceinte-reflexe`, partie de `origin/main`, puis fusion de `cursor/spotify-voix-appareil` et `cursor/enceinte-ecran-pc`. Version de l’application **inchangée** (5.0.73 dans `package.json`). Pas de fusion dans `main`, pas de publication.

**Non testé avec la vraie enceinte.** Le programme de la carte (`firmware/jarvis-speaker/`) n’a pas été lu ni modifié. Le chantier images n’a pas été repris : la garde « une demande d’image n’est jamais un morceau » de `main` est restée, avec le suffixe d’appareil Spotify.

## Fait

0. **Base.** Les deux branches déjà relues sont dans celle-ci. `playIntent.ts` garde la garde image et le suffixe « sur la Devialet ».
1. **Chrono.** Chaque phrase d’enceinte note des durées (audio, transcription, choix, premier texte, texte à dire, voix, envoi, total) et le chemin `reflexe` / `express` / `trieur` / `cerveau`. L’en-tête `X-Jarvis-Capture-Ms` est lu s’il est un nombre, sinon ignoré. 50 mesures en mémoire, fichier `userData/logs/enceinte-chrono.jsonl`. Réglages → Enceintes → Vitesse : médianes des 20 dernières, barre, étape la plus lente, bouton « Remettre à zéro ». Le chrono ne change pas les réponses.
2. **Parler dès que la partie dite est prête.** Trois phrases terminées, ou 300 caractères : l’enceinte reçoit tout de suite ce début, et « Le détail est sur le PC. » si la suite continue. La génération continue dans la discussion de l’enceinte. Une nouvelle phrase ne l’annule pas. Une réponse déjà finie avant cette limite reste celle d’aujourd’hui. Une carte de confirmation reste refusée.
3. **Phrases réflexes.** Outil Spotify déjà réussi : « C’est parti. », « En pause. », « Morceau suivant. », « Morceau précédent. », « C’est reparti. », « Volume à 40. », « Lecture aléatoire. » / « Lecture dans l’ordre. » Le titre reste le texte écrit sur le PC. Aucune règle express ajoutée. L’heure et le calcul restent leur phrase unique.
4. **Oreilles et voix.** Whisper des enceintes passe par le worker multi-thread (0.4.17). Le réglage le précharge après l’affichage de la fenêtre et le marque comme gardé (le chargeur ne le déchargeait déjà pas tout seul). Piper : un processus par voix, une ligne JSON à la fois. Processus mort → relancé une fois, puis l’ancien chemin (un processus par phrase). Arrêt à la fermeture de Jarvis. Réglage `speakerVoice` : « Piper (rapide) » seulement s’il est prêt ; absent = la voix de Jarvis.
5. **Préchauffage.** `POST /api/speaker/wake` : même jeton, même refus hors réseau privé, réponse `204` immédiate. Si le préchauffage est activé, au plus une fois toutes les 10 s : signal pour Whisper, chargement Ollama sans génération, Piper résident. « Garder Jarvis éveillé » : le modèle qui trie reste chargé (`keep_alive` négatif). La carte graphique reste occupée. Le firmware n’appelle pas encore cette adresse : Claude Code le branchera sur la vraie enceinte.
6. **Destinataire.** Si le réglage ou le mode rapide est actif, une suite venue de l’enceinte n’appelle pas de modèle. Les règles muettes = on répond. La fenêtre garde l’appel de modèle d’aujourd’hui.
7. **Mode enceinte rapide.** Interrupteur en haut de Réglages → Enceintes. Il active d’un coup Piper (s’il est prêt), Whisper gardé, préchauffage, vérification par règles, modèle éveillé. Chaque élément reste dans « Réglages avancés ».

## Documentation vérifiée

- Piper `2023.11.14-2` : [README](https://github.com/rhasspy/piper/blob/2023.11.14-2/README.md) (sortie brute `--output-raw` / `--output_raw`, entrée `--json-input`) et [src/cpp/main.cpp](https://github.com/rhasspy/piper/blob/2023.11.14-2/src/cpp/main.cpp). La sortie brute existe, mais le PCM n’a pas de marque entre deux phrases tant que le processus reste ouvert : on ne sait pas où une phrase finit. Le mode retenu est `--json-input` avec `output_file` dans la ligne : Piper écrit le WAV, affiche le chemin, puis attend la ligne suivante. Le modèle reste chargé. Le texte n’est jamais un argument.
- Ollama : [docs/api.md, Load a model](https://github.com/ollama/ollama/blob/main/docs/api.md). Un prompt vide charge le modèle, sans texte produit. `keep_alive` dit combien de temps il reste ; un nombre négatif le garde. Le déchargement (`keep_alive: 0`) n’est pas envoyé tout seul, pour ne pas retirer un modèle qui sert aussi à discuter.

## Testé

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | OK, 0 erreur |
| `npm test` | Cœur 2330/2330. Bureau 729 réussis, 6 ignorés, 1 échec (voir ci-dessous) |
| `npm run lint` | OK, 0 erreur, 0 avertissement |

Tests ajoutés : chrono (aucun texte dans la ligne, médianes), réponse anticipée (HTTP avant la fin, suite non annulée, réponse courte inchangée), phrase Spotify courte, stop après la réponse anticipée, Piper résident (un lancement, relance, repli), `/api/speaker/wake` (jeton, adresse, 204, une fois par 10 s), chargement Ollama sans génération, destinataire par règles sur l’enceinte. `chat-unchanged`, `ollama-unchanged`, `orchestra-session` verts, `__golden__` non régénérés. `parseSettings({})` ne gagne aucune des nouvelles clés.

L’échec du bureau est `windowsDesktopMissionPath.test.ts`, « Construire manuel : la carte reste obligatoire » (« typecheck n’a pas été lancé »). Le dossier `developer` n’a pas été modifié par rapport à `origin/main`. `CLAUDE.md` signale déjà ce fichier comme fragile (exclu de `release.sh` depuis la 5.0.73). Les cinq échecs `.exe` prévus sans SDK .NET ne se sont pas produits : le harnais de ce fichier simule `dotnet`, et `dotnetProject.test.ts` est vert.

`npm run build` de l’installateur (Electron, modèles de voix) n’a pas été lancé.

## Non testé

- La vraie enceinte ESP32, le micro, le haut-parleur, le Wi-Fi de la maison.
- Le temps réel sur la RTX 2060 (Whisper, Ollama, Piper). Les gains ci-dessous sont des estimations, pas des mesures.
- `npm run build` de l’installateur Windows (modèles de voix, Electron).

## Gains attendus par étape

Estimations du cahier, pas une mesure sur le PC.

| Étape | Ce que ça enlève | Ordre de grandeur |
| --- | --- | --- |
| 1. Chrono | Rien. On saura ensuite quelle étape est lente. | 0 s |
| 2. Réponse anticipée | L’attente de la fin du modèle et de la synthèse de toute la réponse. L’enceinte parle aux 3 premières phrases. | souvent 3 à 6 s de moins avant le premier mot sur une longue réponse |
| 3. Phrases réflexes | La synthèse d’une longue phrase (« Lecture de … — … »). L’action Spotify, elle, prend toujours le temps du réseau. | la voix tombe à une phrase fixe, bien sous 1 s une fois l’action faite |
| 4. Whisper et Piper prêts | Le chargement de Whisper à la première phrase (2 à 3 s) et le rechargement de Piper à chaque phrase. | 2 à 3 s la première fois, puis une fraction de seconde par phrase |
| 5. Préchauffage | Le réveil du modèle (jusqu’à 10 s s’il dormait), pendant que la personne parle encore. | jusqu’à 10 s, si le modèle était déchargé |
| 6. Destinataire par règles | L’appel de modèle des suites sans « Jarvis » (jusqu’à 10 s). | jusqu’à 10 s sur un suivi |
| 7. L’interrupteur | Active 4, 5 et 6 ensemble, plus Piper et le modèle gardé chargé. | le total visé : moins d’1 s pour un réflexe, 2 à 3 s avant le premier mot d’une vraie question — à mesurer avec la carte |

## Questions

- Le mode rapide laisse le modèle qui trie dans la carte graphique. C’est voulu, et c’est écrit dans le réglage. Il faut l’activer soi-même : rien n’est allumé par défaut.
- La carte n’appelle pas encore `/api/speaker/wake`. Tant que le firmware ne le fait pas, le préchauffage part quand on active les enceintes ou le réglage, pas au moment exact où le mot « Jarvis » est entendu sur la carte.
- Un « stop » dit pendant qu’une autre phrase est encore en transcription reçoit « une phrase à la fois » (429), comme aujourd’hui. Un « stop » dont la transcription est finie ne lance pas de modèle. Après une réponse déjà partie, le stop annule la suite.

```
RAPPORT DE VÉRIFICATION
Lancement : non exécuté (build Electron non lancé)
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : ÉCHEC (3059/3066 réussis, 6 ignorés, 1 échec : « Construire manuel » dans windowsDesktopMissionPath.test.ts, fichier déjà fragile, code developer inchangé)
Secrets   : OK (0 vraie valeur ; seulement des clés factices de tests déjà dans le dépôt)
Fichiers modifiés : cœur enceinte (chrono, phrases, préchauffage, réglages), pont desktop, Piper résident, réglages Enceintes, CLAUDE.md, ce rapport
Prêt à fusionner : NON
À corriger : mesurer avec la vraie enceinte ; npm run build sur Windows ; l’échec « Construire manuel » (hors de ce chantier)
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```
