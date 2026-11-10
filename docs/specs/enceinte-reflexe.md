# Cahier des charges — « Jarvis Réflexe » : une enceinte rapide et simple (côté PC)

Rédigé par Claude pour Cursor, le 10 novembre 2026. Priorité de l'utilisateur : « l'utilisation des enceintes : plus rapide, plus simple, moins fouillis, moins de latence ». Le chantier des images est **clos** : n'y touche pas.

Lire `CLAUDE.md` (5.0.64 Enceinte Jarvis, 5.0.62 suivi et destinataire, 5.0.60 chef d'orchestre et express, 5.0.67 Piper, 5.0.68 trieur), `docs/specs/enceinte-jarvis.md`, `docs/specs/enceinte-oreilles-bouche.md` (branche `claude/specs-enceinte-bouche`) et `docs/specs/regles-communes-lots.md` (branche `claude/specs-feuille-de-route`).

## Le trajet d'une phrase aujourd'hui (estimations, à mesurer)

Fin de parole sur l'ESP32 (~0,7 s) → envoi du WAV (~0,2 s) → Whisper dans la fenêtre (2 à 3 s) → tri par le cerveau 7B (0,5 à 1,5 s ; jusqu'à 10 s si le modèle dormait) → **réponse entière** du modèle (3 à 6 s) → **synthèse de toute la réponse** (1 à 2 s ; Piper relancé à chaque fois, ou PowerShell) → envoi et lecture. Total estimé : **8 à 14 s**. Chaque étape attend la fin complète de la précédente. Pour une phrase de suivi sans « Jarvis », la vérification du destinataire peut ajouter un appel de modèle (jusqu'à 10 s, `ADDRESSEE_DEADLINE_MS`).

Objectif : **moins d'1 s pour un réflexe** (musique, pause, volume, heure…), **2 à 3 s avant le premier mot** pour une vraie question.

## 0. Base de travail

Branche `cursor/enceinte-reflexe` depuis `origin/main`, inscrite dans `AGENTS-COORDINATION.md`. **Commence par y fusionner tes deux branches déjà relues** : `cursor/spotify-voix-appareil` (« Devialet ou PC ? ») puis `cursor/enceinte-ecran-pc` (« le détail est sur le PC »). Conflit attendu dans `packages/core/src/media/playIntent.ts` avec la 5.0.72 de `main` : **garder les deux** (la garde « une demande d'image n'est jamais un morceau » de `main` ET le suffixe d'appareil « sur la Devialet » de ta branche), tests des deux côtés verts.

## 1. Le chrono de l'enceinte (mesurer d'abord)

- Pour chaque phrase reçue d'une enceinte, mesurer en millisecondes : réception de la requête ; durée de l'audio ; **transcription** ; **décision** (chemin : réflexe / express / trieur / cerveau, et sa durée) ; **premier morceau de texte** du modèle ; **texte à dire prêt** ; **synthèse** ; **réponse envoyée** ; total côté PC. L'ESP32 pourra plus tard ajouter un en-tête facultatif `X-Jarvis-Capture-Ms` (fin de parole → début d'envoi) : le lire s'il est présent, sinon l'ignorer.
- Garder les 50 dernières mesures en mémoire et les écrire dans `userData/logs/enceinte-chrono.jsonl` (**durées et type de chemin seulement : jamais le texte dit**, jamais de clé).
- Réglages → Ce que Jarvis sait faire → Enceintes → « Vitesse » : pour les 20 dernières phrases, la médiane de chaque étape en barres simples, l'étape la plus lente mise en évidence, une phrase claire (« Le plus long : la réponse du modèle, 4,2 s en moyenne. »). Bouton « Remettre à zéro ».
- Le chrono ne change rien au comportement.

## 2. Parler dès que la partie dite est prête

L'enceinte ne dit déjà que les 2 ou 3 premières phrases (`speakerReplyForEars`), le reste va sur le PC. Donc **inutile d'attendre la fin de la réponse** :

- Pendant le tour, suivre le texte qui arrive ; dès que la partie à dire est complète (2 ou 3 phrases terminées, ou 300 caractères, selon la même règle que `speakerReplyForEars`), la synthétiser et **répondre tout de suite à l'enceinte** avec « … Le détail est sur le PC. » si la suite continue.
- La génération **continue** dans la discussion de l'enceinte sur le PC et s'y affiche à la fin (comme pour l'image en fond : fermer la réponse HTTP n'annule pas le tour ; une nouvelle phrase de l'enceinte ne l'annule pas non plus, même mécanique que la correction « une phrase pendant une image ne l'annule pas »).
- Réponse courte (finie avant d'atteindre la limite) : comportement d'aujourd'hui.
- Une carte de confirmation ou de mission qui arrive pendant la suite reste refusée / signalée comme aujourd'hui, et le PC l'affiche.

## 3. Les réflexes de l'enceinte

- Sur un tour d'enceinte résolu **sans modèle** (express Spotify, horloge, calcul, arrêt…), la phrase dite est **courte et fixe** : « C'est parti. », « En pause. », « Morceau suivant. », « Volume à 40. », l'heure en une phrase… (table de phrases dans le cœur, testée). Le détail (titre du morceau, etc.) reste écrit sur le PC.
- Les phrases d'arrêt (« stop », « pause », « tais-toi ») sont reconnues **avant** la transcription complète si possible, sinon en tout premier après elle, et n'attendent jamais une question en cours (règle existante).
- Rien de nouveau n'est rendu express : on n'ajoute pas de règles, on raccourcit seulement ce qui est dit.

## 4. Des oreilles et une voix toujours prêtes

- **Whisper** : quand les enceintes sont activées, le Whisper de la fenêtre utilisé pour les enceintes (`speaker:transcribe-request`) est **préchargé** après l'affichage de la fenêtre et **ne se décharge plus** ; il passe par le worker multi-thread (0.4.17) et non par le chargeur dans la page. Vérifier et mesurer (chrono).
- **Piper résident** : un processus Piper par voix, lancé une fois et gardé, qui lit une ligne de texte à la fois et rend l'audio, au lieu d'un processus par phrase. **Vérifier sur la documentation et le code de la release `2023.11.14-2`** les options de sortie continue (par exemple sortie brute sur la sortie standard) et citer le lien dans le rapport ; si ce mode n'existe pas ou n'est pas fiable, garder un processus par phrase et le dire. Processus mort → relancé une fois, puis repli sur l'ancien chemin. Arrêté proprement à la fermeture de Jarvis.
- **Voix des enceintes** : nouveau réglage facultatif `speakerVoice` (sans défaut Zod : absent = la voix de Jarvis comme aujourd'hui) ; choix « Piper (rapide) » proposé quand Piper est prêt, car la voix Windows des enceintes passe par un PowerShell lancé à chaque phrase.

## 5. Préchauffage au mot de réveil

- Nouveau point d'accès `POST /api/speaker/wake` (même jeton, mêmes règles d'adresse privée) : l'enceinte l'appellera dès qu'elle entend « Jarvis », **pendant** que l'utilisateur parle. Réponse `204` immédiate.
- Le PC, au plus une fois toutes les 10 s : Whisper prêt ; le modèle qui triera (trieur s'il est réglé, sinon cerveau) et le modèle de l'équipe Conversation chargés dans Ollama par une requête de **chargement seul** (aucune génération : requête vide avec `keep_alive`, à vérifier sur la documentation d'Ollama, lien dans le rapport) ; Piper résident lancé.
- Réglage facultatif « Garder Jarvis éveillé » (Enceintes) : tant que les enceintes sont activées, le modèle du tri reste chargé (`keep_alive` long) ; le dire clairement : la carte graphique reste occupée par ce modèle.
- Le micrologiciel de l'ESP32 n'est **pas** dans cette mission (Claude Code le fera avec la vraie enceinte) : le point d'accès doit exister et être testé seul.

## 6. Vérification du destinataire plus rapide sur l'enceinte

Pour une phrase de suivi venue d'une enceinte : **règles seulement** (`followUpAddressee`), sans appel de modèle ; règles muettes = oui (on répond). Le chat de la fenêtre garde son comportement d'aujourd'hui.

## 7. Un seul interrupteur : « Mode enceinte rapide »

Dans Réglages → Enceintes, en haut, un interrupteur (réglage facultatif sans défaut Zod) qui active d'un coup : Piper pour les enceintes (s'il est prêt), Whisper préchargé, préchauffage, vérification par règles, « Garder Jarvis éveillé ». Chaque élément reste visible et réglable dans « Réglages avancés ». Une phrase simple explique ce que ça change, y compris que la carte graphique reste occupée.

## Ce qui ne change pas

Règles communes (`regles-communes-lots.md`) : `chat-unchanged`, `ollama-unchanged`, `orchestra-session` verts sans régénérer les `__golden__` ; `parseSettings({})` ne gagne aucune clé ; chaque nouveau réglage a sa place dans la carte des réglages ; cartes de confirmation toujours refusées depuis une enceinte ; rien ne change pour la fenêtre, le téléphone ni le chat tapé.

## Tests

Chrono (étapes notées, aucun texte dans le journal, médianes) ; réponse anticipée (faux flux de texte : réponse HTTP envoyée avant la fin, la suite affichée sur le PC, une nouvelle phrase ne l'annule pas, réponse courte inchangée) ; phrases réflexes (express → phrase courte, détail sur le PC) ; Piper résident (faux exécutable : un seul lancement pour plusieurs phrases, relance après plantage, repli) ; `/api/speaker/wake` (jeton, adresse non privée refusée, 204, une seule fois par 10 s, aucune génération demandée à Ollama) ; destinataire par règles sur l'enceinte ; « Mode enceinte rapide » ; les tests figés.

## Livraison

Pas de fusion dans `main`, pas de publication : Claude relit, Claude Code publie après les tests sur Windows et la mesure avec la vraie enceinte. Avant de pousser : `npm run typecheck`, `npm test`, `npm run lint`. Rapport `rapports/2026-11-XX-enceinte-reflexe.md` (fait, testé, **non testé avec la vraie enceinte**, gains attendus par étape, questions), puis le RAPPORT DE VÉRIFICATION.
