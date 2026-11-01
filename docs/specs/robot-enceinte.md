# Cahier des charges — Le robot comme enceinte Jarvis (5.0.66)

Rédigé par Claude pour Cursor, le 2 novembre 2026. Demande de l'utilisateur : « le robot pourra agir comme l'enceinte ». Travail fait **en parallèle** de l'enceinte (`enceinte-jarvis.md`, branche `cursor/enceinte-5064`) : **le protocole décrit dans `enceinte-jarvis.md` (section Phase 1 → Serveur) est le contrat commun**. Ce chantier écrit le côté robot de ce contrat ; il ne touche pas au pont du PC (c'est l'autre agent).

Lire `CLAUDE.md` en entier, en particulier la section « Robot Jarvis Rover » et la ligne « Robot » de « Ce qu'il ne faut pas casser ».

## Principe

Le robot (Raspberry Pi 5 + ESP32) devient une enceinte Jarvis comme les autres : il entend « Jarvis » sur place, envoie la phrase au PC par `POST /api/speaker/turn`, et joue la réponse. Pour le PC, c'est une enceinte nommée « Robot », reliée avec un jeton comme les autres (Réglages → Enceintes).

## Matériel

- Le Pi 5 n'a pas de prise audio : **haut-parleur-micro USB de conférence** (micro + haut-parleur + annulation d'écho intégrés, un seul câble), solution conseillée ; ou carte son USB + micro + petit haut-parleur. Tout périphérique ALSA doit marcher (choix par nom dans la configuration).
- Recommandation d'achat dans le guide, avec la raison (annulation d'écho : le robot ne doit pas s'entendre parler) ; prix à vérifier, pas de mémoire.

## À livrer (dossier `robot/voix/` à la racine du dépôt Jarvis)

Le service de pilotage du robot (`jarvis_rover`) vit hors de ce dépôt et **ne doit pas être modifié**. La voix est un **programme séparé** qui tourne à côté sur le Pi, pour ne pas mettre en danger le pilotage.

1. **Client vocal Python** (`robot/voix/jarvis_robot_voix/`) :
   - mot de réveil local « Hey Jarvis » / « Jarvis » (openWakeWord, modèle `hey_jarvis`, sur le processeur du Pi ; vérifier la licence et l'installation sur Pi 5 dans la documentation officielle) ; rien n'est envoyé au PC avant lui ;
   - fin de parole, envoi WAV 16 kHz mono 16 bits au PC, lecture de la réponse, écoute de suivi `X-Jarvis-Follow-Up` pendant `followUpMs`, micro coupé pendant que le robot parle : **exactement** le contrat de `enceinte-jarvis.md` ;
   - **« stop » local** : si, après le mot de réveil, la phrase est un arrêt (« stop », « arrête », « arrête-toi », « stop robot »), le client appelle **directement** `POST /api/stop` du service du robot sur le Pi (127.0.0.1, avec son jeton), **avant** et **sans** attendre le PC. Reconnaissance locale de ces quelques mots (grammaire fermée Vosk français, petit modèle, comme le réveil de Jarvis sur PC) ; si ce n'est pas faisable proprement cette nuit, le dire dans le rapport. Le bouton d'arrêt d'urgence physique reste la vraie sécurité ;
   - configuration dans `config.toml` (adresse du PC, port, jeton de l'enceinte, jeton du service robot, périphérique audio, sensibilité) ; `config.example.toml` commité, `config.toml` dans `.gitignore` ; aucun secret dans le dépôt ;
   - service systemd (`jarvis-robot-voix.service`) avec redémarrage automatique, et script d'installation `installer.sh` (environnement Python à part, dépendances épinglées dans `requirements.txt`).
2. **Mouvements à la voix** : le pont du PC refuse les actions qui demandent une confirmation venant d'une enceinte (règle de `enceinte-jarvis.md`). Donc « avance de 50 cm » dit au robot sera refusé : **ne pas changer cette règle**. Écrire à la place, dans le rapport, une **proposition** de confirmation vocale (« Je vais avancer de 50 cm, tu confirmes ? » → « oui ») avec ses risques, pour que l'utilisateur décide.
3. **Tests** (pytest, sans matériel) : faux micro (fichiers WAV synthétiques générés par les tests, jamais de vraie voix commitée), faux PC (petit serveur HTTP qui suit le contrat), faux service robot : réveil → envoi → lecture ; `204` ; suivi ; « stop » local appelle `/api/stop` avant le PC ; PC injoignable = son d'erreur, pas de blocage ; micro coupé pendant la lecture.
4. **Guide** `robot/voix/README.md` en français simple : achat, branchement, installation sur le Pi (commandes à copier), ajout de l'enceinte « Robot » dans Jarvis, premier essai, dépannage.

## Règles de livraison

- Branche `cursor/robot-voix-5066` à partir de `origin/main`, inscrite dans `AGENTS-COORDINATION.md`. Deux autres agents travaillent en même temps : enceinte (`cursor/enceinte-5064` : `apps/desktop/src/main/speaker/`, `packages/core/src/speaker/`, `firmware/`) et entraînement (`cursor/entrainement-5065` : `training/`, `packages/core/src/developer/labTrainPrep.ts`). Ne touche à aucun de leurs fichiers ; dans `CLAUDE.md` et `AGENTS-COORDINATION.md`, ajoute seulement tes lignes.
- Ce chantier ne modifie pas l'application Jarvis (TypeScript) : seulement `robot/voix/`, `CLAUDE.md` (section « 5.0.66 — le robot comme enceinte », au même format) et la coordination. `npm run typecheck`, `npm test`, `npm run lint` restent verts (5 échecs dotnet attendus).
- Pas de fusion dans `main`, pas de publication. Rapport `rapports/2026-11-02-robot-voix-5066.md` : fait, testé, non testé (rien sur un vrai Pi), choix, proposition de confirmation vocale, questions pour l'utilisateur.
