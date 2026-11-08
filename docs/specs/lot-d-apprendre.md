# Lot D — Jarvis apprend tout seul : labo de nuit, corrections à relire, propositions du dimanche, PC de service (Nightblade)

Lire d'abord `docs/specs/regles-communes-lots.md`, et dans `CLAUDE.md` les sections 5.0.55 à 5.0.61 (générateur, catalogue d'examen), 5.0.65 (entraînement), 5.0.68 (trieur), 0.5.5 (mission « Améliorer »). Branche `cursor/lot-d-apprendre`.

## D1. Labo de nuit automatique

- Réglages → Code et projets → « Labo de nuit » (réglage facultatif `nightLab` : activé, plage horaire, quoi : exercices de code ou phrases du trieur, nombre par nuit, professeur parmi les modèles installés). Exige une copie de travail valide (`developer.repoPath`) et le dossier de données.
- Dans la plage, si le PC est **inactif** (aucun tour de chat, aucune mission, aucune autre génération, Jarvis pas en train de parler), Jarvis lance lui-même `lab:generate` (ou `trieur:generer`) par le lanceur sûr (`runner.ts`, tri `classifyCommand`), décharge d'abord le modèle du chat (`keep_alive: 0`) et **arrête proprement** (fin de l'exercice en cours, comme Ctrl+C) au premier signe d'activité ou à la fin de la plage. Respecte la réservation de la carte graphique.
- Le matin : résumé (acceptés, refus par cause, total du cahier) dans le briefing (lot B) ou la discussion.
- **Jamais d'entraînement automatique** et jamais de location : entraîner reste un choix de l'utilisateur. Quand le cahier gagne 300 exercices depuis le dernier entraînement, Jarvis le signale (« Il y a 300 nouveaux exercices : un entraînement coûterait environ 1 $ »).

## D2. Corrections à relire pour l'entraînement

- Les corrections et préférences apprises (`classifyUtterance` : « Non, c'est faux… ») sont déjà gardées. Ajouter une page « Corrections » (dans « Ce que Jarvis sait de moi », lot A, sinon Réglages → Moi) : chaque correction avec sa question d'origine, et deux boutons « Garder pour l'entraînement » / « Écarter ».
- **Règle des données** (règle commune 8) : une correction ne peut servir à l'entraînement que si l'utilisateur coche « Je l'ai écrite moi-même » — un texte recopié depuis Claude ou un autre assistant ne doit jamais entrer dans les données. Par défaut : rien n'est gardé.
- Export `npm run corrections:exporter --workspace @jarvis/core -- --dir <jarvis-data>` → `corrections/corrections.jsonl` (format conversation, réponse = la correction de l'utilisateur), avec contrôle de contamination de l'examen (comme `labTrainPrep`). Pas encore branché à l'entraînement : outillage et relecture seulement.

## D3. Jarvis propose ses améliorations chaque semaine

- Réglage facultatif « Propositions du dimanche » : chaque semaine, le PC inactif, Jarvis lance la mission « Améliorer » existante sur Jarvis (lecture seule, preuves relues par `verifyProposals`).
- Le lundi : une carte dans la discussion, « 3 idées pour m'améliorer cette semaine », avec pour chacune le gain, le risque et la preuve, et les boutons « Oui » / « Non ». « Oui » crée une **carte de mission** (chemin 5.0.68 : rien ne démarre sans « Lancer »).
- Un petit journal « ce que j'ai appris cette semaine » (missions réussies, corrections gardées, scores du labo), lisible dans la discussion.

## D4. PC de service (MSI Nightblade) pour les petits modèles

- L'utilisateur a un second PC (GTX 1050, 8 Go) qu'il veut laisser allumé pour les petits modèles. Dans le chef d'orchestre, chaque équipe et le trieur gagnent un emplacement « Sur un autre PC » avec une adresse Ollama du **réseau local seulement** (contrôle de type `checkRoverBaseUrl`) ; réglage facultatif, sans défaut Zod. Les équipes réglées comme avant envoient exactement les mêmes requêtes qu'avant (tests figés).
- Autre PC injoignable : repli sur le cerveau local pour ce tour, pastille « autre PC injoignable », et le bilan de santé (lot A) le signale.
- Guide `docs/pc-de-service.md` en français simple : installer Ollama sur le Nightblade, l'ouvrir au réseau local seulement (`OLLAMA_HOST`, pare-feu Windows limité au réseau privé), télécharger les petits modèles, régler Jarvis, tester. Chaque réglage d'Ollama est vérifié sur la documentation officielle, avec les liens.

## Tests

Labo de nuit (lancement dans la plage seulement, arrêt à l'activité, commande passée par `classifyCommand`, résumé, aucun entraînement), corrections (rien gardé par défaut, case « écrite moi-même » obligatoire, export, contamination de l'examen écartée), propositions (lecture seule, preuves non vérifiées jamais montrées, « Oui » = carte et pas lancement), autre PC (adresse non locale refusée, requêtes identiques pour les équipes d'avant, repli sur le cerveau).
